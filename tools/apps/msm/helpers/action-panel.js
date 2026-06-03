/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console, class-methods-use-this */
import { LitElement, html, nothing } from 'da-lit';
import {
  getSiteRoles,
  getPageTimestamp,
  getPageStatus,
  getStatusConfig,
  executeBulkAction,
} from './api.js';
import { icon } from '../core/icons.js';

const NX = 'https://da.live/nx';
let sl;
let sheet;
let buttons;
try {
  const { default: getStyle } = await import(`${NX}/utils/styles.js`);
  [sl, sheet, buttons] = await Promise.all([
    getStyle(`${NX}/public/sl/styles.css`),
    getStyle(import.meta.url),
    getStyle(`${NX}/styles/buttons.css`),
  ]);
} catch (e) {
  console.warn('Failed to load action-panel styles:', e);
}

// Publishing bumps lastModified slightly after the publish timestamp is
// recorded, producing a spurious "out of sync" signal. This absorbs the lag.
const PUBLISH_LAG_MS = 5000;

// How many status probes to run at once when filling the matrix / table.
const CELL_CONCURRENCY = 6;

const cellKey = (pagePath, satSite) => `${pagePath}:${satSite}`;
const cleanPath = (p) => p.replace(/\.[^/.]+$/, '');

/* eslint-disable no-restricted-syntax, no-await-in-loop */
async function runPool(makeTasks, limit) {
  const executing = new Set();
  for (const task of makeTasks) {
    const p = task().then(() => executing.delete(p));
    executing.add(p);
    if (executing.size >= limit) await Promise.race(executing);
  }
  await Promise.all(executing);
}
/* eslint-enable no-restricted-syntax, no-await-in-loop */

class MsmActionPanel extends LitElement {
  static properties = {
    org: { type: String },
    site: { type: String },
    msmConfig: { attribute: false },
    pages: { attribute: false },
    _cells: { state: true },
    _rows: { state: true },
    _includedTargets: { state: true },
    _expandedCols: { state: true },
    _confirm: { state: true },
    _busy: { state: true },
    _taskStatus: { state: true },
    _success: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sl, sheet, buttons].filter(Boolean);
    this._cells = new Map();
    this._rows = new Map();
    this._includedTargets = new Set();
    this._expandedCols = new Set();
    this._confirm = null;
    this._busy = false;
    this._taskStatus = new Map();
    this._success = null;
    this._loadGen = 0;
    this._lastKey = '';
  }

  updated(changed) {
    if (changed.has('pages') || changed.has('site') || changed.has('msmConfig')) {
      this._resetForSelection();
    }
  }

  // ── Derived shape ─────────────────────────────────────────────────────────

  get _roles() {
    if (!this.msmConfig || !this.site) return {};
    return getSiteRoles(this.msmConfig, this.site);
  }

  // Selected pages confined to the active site (selection is single-site, but
  // guard anyway so a stale multi-site set never renders against this site).
  get _pages() {
    return (this.pages || []).filter((p) => (p.site || this.site) === this.site);
  }

  get _activePages() {
    return this._pages;
  }

  // Direct satellites of this site as [satSite, { label, descendantCount, descendants }].
  get _targets() {
    return Object.entries(this._roles.asBase?.satellites || {});
  }

  // The full satellite subtree as column nodes: { site, label, children }.
  get _columnTree() {
    return this._targets.map(([site, info]) => ({
      site, label: info.label || site, children: info.descendants || [],
    }));
  }

  // Flattened, depth-first list of *visible* columns (children shown only when
  // the parent is expanded).
  get _columns() {
    const out = [];
    const walk = (nodes, depth, parentSite) => {
      nodes.forEach((n) => {
        const childCount = n.children?.length || 0;
        out.push({
          site: n.site, label: n.label, depth, parentSite, childCount,
        });
        if (childCount && this._expandedCols.has(n.site)) walk(n.children, depth + 1, n.site);
      });
    };
    walk(this._columnTree, 0, this.site);
    return out;
  }

  // Every column in the subtree regardless of expansion — the basis for data
  // loading, target inclusion, and action scope (collapsed levels still count).
  get _allColumns() {
    const out = [];
    const walk = (nodes, depth, parentSite) => nodes.forEach((n) => {
      out.push({
        site: n.site, label: n.label, depth, parentSite, childCount: n.children?.length || 0,
      });
      if (n.children?.length) walk(n.children, depth + 1, n.site);
    });
    walk(this._columnTree, 0, this.site);
    return out;
  }

  _subtreeSites(site) {
    const node = this._findNode(site);
    if (!node) return [site];
    const out = [];
    const collect = (n) => { out.push(n.site); (n.children || []).forEach(collect); };
    collect(node);
    return out;
  }

  _columnState(site) {
    const sub = this._subtreeSites(site);
    const inc = sub.filter((s) => this._includedTargets.has(s)).length;
    if (inc === 0) return 'unchecked';
    if (inc === sub.length) return 'checked';
    return 'indeterminate';
  }

  _parentMap() {
    const m = new Map();
    const walk = (nodes, parent) => nodes.forEach((n) => {
      m.set(n.site, parent);
      if (n.children?.length) walk(n.children, n.site);
    });
    walk(this._columnTree, this.site);
    return m;
  }

  _findNode(site) {
    const find = (nodes) => nodes.reduce((acc, n) => {
      if (acc) return acc;
      if (n.site === site) return n;
      return find(n.children || []);
    }, null);
    return find(this._columnTree);
  }

  _labelFor(sat) {
    return this._findNode(sat)?.label || sat;
  }

  // Human title for a site id, from the MSM config rows (base or satellite
  // row's title). Falls back to the id when no title is configured.
  _siteTitle(site) {
    const rows = this.msmConfig?.rows || [];
    const baseRow = rows.find((r) => r.base === site && !r.satellite);
    if (baseRow?.title) return baseRow.title;
    const satRow = rows.find((r) => r.satellite === site);
    return satRow?.title || site;
  }

  // The source a satellite pulls from for a given page: the nearest ancestor
  // that holds a local copy of the page, else the base site. Resolves from
  // already-loaded cells (ancestors load before descendants).
  _effectiveSource(page, sat, parentMap) {
    let cur = parentMap.get(sat);
    while (cur && cur !== this.site) {
      const cell = this._cells.get(cellKey(page.path, cur));
      if (cell?.hasOverride) return { site: cur, lm: cell.lastModified };
      cur = parentMap.get(cur);
    }
    return { site: this.site, lm: page.lastModified };
  }

  // ── Selection lifecycle ─────────────────────────────────────────────────

  _resetForSelection() {
    const key = `${this.org}|${this.site}|${this._pages.map((p) => p.path).sort().join(',')}`;
    if (key === this._lastKey) return;
    this._lastKey = key;
    this._loadGen += 1;
    this._cells = new Map();
    this._rows = new Map();
    this._includedTargets = new Set(this._allColumns.map((c) => c.site));
    this._expandedCols = new Set();
    this._taskStatus = new Map();
    this._confirm = null;
    this._success = null;
    if (this._roles.asBase) this._loadAll();
    if (this._roles.asSatellite) this._loadRows();
  }

  // ── Downward matrix data ──────────────────────────────────────────────────

  _setCell(key, data) {
    const next = new Map(this._cells);
    next.set(key, data);
    this._cells = next;
  }

  async _loadCellsFor(sites) {
    const gen = this._loadGen;
    const parentMap = this._parentMap();
    const tasks = [];
    this._pages.forEach((page) => {
      const ext = page.ext || 'html';
      const path = cleanPath(page.path);
      sites.forEach((sat) => {
        tasks.push(async () => {
          if (gen !== this._loadGen) return;
          try {
            const ts = await getPageTimestamp(this.org, sat, path, ext);
            const hasOverride = ts.exists;
            const src = this._effectiveSource(page, sat, parentMap);
            const editLM = hasOverride ? ts.lastModified : src.lm;
            const status = await getPageStatus(this.org, sat, path, editLM, ext);
            const outOfSync = !!(hasOverride && src.lm && ts.lastModified
              && new Date(src.lm).getTime()
                > new Date(ts.lastModified).getTime() + PUBLISH_LAG_MS);
            if (gen !== this._loadGen) return;
            this._setCell(cellKey(page.path, sat), {
              hasOverride,
              outOfSync,
              previewState: status.previewState,
              liveState: status.liveState,
              lastModified: ts.lastModified,
              sourceSite: src.site,
            });
          } catch {
            if (gen !== this._loadGen) return;
            this._setCell(cellKey(page.path, sat), {
              hasOverride: false,
              outOfSync: false,
              previewState: 'not-rolled-out',
              liveState: 'not-rolled-out',
              lastModified: null,
              sourceSite: this.site,
            });
          }
        });
      });
    });
    await runPool(tasks, CELL_CONCURRENCY);
  }

  // Probe the entire subtree, shallow→deep so each level's source resolves
  // against freshly-loaded ancestors.
  async _loadAll() {
    const byDepth = new Map();
    this._allColumns.forEach((c) => {
      if (!byDepth.has(c.depth)) byDepth.set(c.depth, []);
      byDepth.get(c.depth).push(c.site);
    });
    const depths = [...byDepth.keys()].sort((a, b) => a - b);
    await depths.reduce(
      (chain, d) => chain.then(() => this._loadCellsFor(byDepth.get(d))),
      Promise.resolve(),
    );
  }

  // ── Upward (satellite) row data ───────────────────────────────────────────

  _setRow(path, data) {
    const next = new Map(this._rows);
    next.set(path, data);
    this._rows = next;
  }

  // Nearest ancestor (incl. base) that actually holds the page — the site to
  // pull from / copy from. Probes the inheritance chain in parallel.
  async _resolveUpwardSource(page) {
    const chain = this._roles.asSatellite?.chain || [];
    const nearestFirst = [...chain].reverse();
    const ext = page.ext || 'html';
    const path = cleanPath(page.path);
    const probes = await Promise.all(
      nearestFirst.map((node) => getPageTimestamp(this.org, node.site, path, ext)
        .then((ts) => ({ node, ts }))
        .catch(() => ({ node, ts: { exists: false } }))),
    );
    const hit = probes.find((r) => r.ts.exists);
    if (hit) return { site: hit.node.site, lm: hit.ts.lastModified, exists: true };
    return { site: this._roles.asSatellite?.base, lm: null, exists: false };
  }

  async _loadRows() {
    const gen = this._loadGen;
    const tasks = this._pages.map((page) => async () => {
      if (gen !== this._loadGen) return;
      const ext = page.ext || 'html';
      const path = cleanPath(page.path);
      try {
        const [selfTs, src] = await Promise.all([
          getPageTimestamp(this.org, this.site, path, ext),
          this._resolveUpwardSource(page),
        ]);
        const hasOverride = selfTs.exists;
        let category = 'inherited';
        if (hasOverride) category = src.exists ? 'override' : 'local';
        const editLM = hasOverride ? selfTs.lastModified : src.lm;
        const status = await getPageStatus(this.org, this.site, path, editLM, ext);
        const outOfSync = !!(category === 'override' && src.lm && selfTs.lastModified
          && new Date(src.lm).getTime()
            > new Date(selfTs.lastModified).getTime() + PUBLISH_LAG_MS);
        if (gen !== this._loadGen) return;
        this._setRow(page.path, {
          category,
          hasOverride,
          outOfSync,
          previewState: status.previewState,
          liveState: status.liveState,
          source: src.site,
        });
      } catch {
        if (gen !== this._loadGen) return;
        this._setRow(page.path, {
          category: 'inherited',
          hasOverride: false,
          outOfSync: false,
          previewState: 'not-rolled-out',
          liveState: 'not-rolled-out',
          source: this._roles.asSatellite?.base,
        });
      }
    });
    await runPool(tasks, CELL_CONCURRENCY);
  }

  // ── Include / expand toggles ──────────────────────────────────────────────

  // Cascades like the dialog's scope chips: unchecking a column removes it and
  // its whole subtree; checking it adds the subtree and re-enables ancestors.
  _toggleTarget(site) {
    const next = new Set(this._includedTargets);
    const sub = this._subtreeSites(site);
    if (next.has(site)) {
      sub.forEach((s) => next.delete(s));
    } else {
      sub.forEach((s) => next.add(s));
      const parentMap = this._parentMap();
      let p = parentMap.get(site);
      while (p && p !== this.site) { next.add(p); p = parentMap.get(p); }
    }
    this._includedTargets = next;
  }

  // Expansion is display-only — all subtree data is already loaded.
  _toggleColumnExpand(sat) {
    const next = new Set(this._expandedCols);
    if (next.has(sat)) next.delete(sat); else next.add(sat);
    this._expandedCols = next;
  }

  // ── Scope ─────────────────────────────────────────────────────────────────

  // Included (page, satellite) downward cells matching a scope.
  // scope: 'inherited' (rollout / cancel) | 'custom' (sync / re-enable)
  _scopedCells(scope) {
    const out = [];
    const targets = this._allColumns.filter((c) => this._includedTargets.has(c.site));
    this._activePages.forEach((page) => {
      targets.forEach((col) => {
        const cell = this._cells.get(cellKey(page.path, col.site));
        if (!cell) return;
        const match = scope === 'custom' ? cell.hasOverride : !cell.hasOverride;
        if (match) out.push({ page, satSite: col.site });
      });
    });
    return out;
  }

  // ── Execution (downward only — the satellite view is read-only) ───────────

  _requestAction(def) {
    this._confirm = { ...def, count: this._scopedCells(def.scope).length };
    this._success = null;
  }

  _dismissConfirm() {
    this._confirm = null;
  }

  // Group in-scope work into valid executeBulkAction calls — one satellite per
  // call, the pages that share its source — so sync / cancel pull from the
  // right base at any tree depth (source can differ per page).
  _downGroups(scope) {
    const parentMap = this._parentMap();
    const groups = new Map();
    this._scopedCells(scope).forEach(({ page, satSite }) => {
      const source = this._effectiveSource(page, satSite, parentMap).site;
      const key = `${satSite}|${source}`;
      if (!groups.has(key)) groups.set(key, { target: satSite, source, pages: [] });
      groups.get(key).pages.push(page);
    });
    return [...groups.values()];
  }

  async _execute() {
    if (this._busy || !this._confirm) return;
    const {
      exec, scope, syncMode, label,
    } = this._confirm;
    this._confirm = null;
    this._busy = true;
    this._taskStatus = new Map();

    const onPageStatus = (key, status, error) => {
      const next = new Map(this._taskStatus);
      next.set(key, { status, error });
      this._taskStatus = next;
    };

    let ok = 0;
    let failed = 0;
    await this._downGroups(scope).reduce((chain, g) => chain.then(async () => {
      const results = await executeBulkAction({
        org: this.org,
        baseSite: g.source,
        pages: g.pages,
        satellites: { [g.target]: { label: this._labelFor(g.target) } },
        action: exec,
        syncMode,
        onPageStatus,
      });
      results.forEach((r) => {
        if (r.status !== 'fulfilled') return;
        if (r.value?.status === 'success') ok += 1;
        else if (r.value?.status === 'error') failed += 1;
      });
    }), Promise.resolve());

    await this._loadAll();
    this._taskStatus = new Map();
    this._busy = false;
    this._success = { label, ok, failed };
  }

  // Hand the satellite's selected pages off to its base, where the matrix can
  // act on them. Local-only pages have no base counterpart and are excluded.
  _emitManageInBase(site, paths) {
    if (!site || !paths.length) return;
    this.dispatchEvent(new CustomEvent('manage-in-base', {
      detail: { site, paths }, bubbles: true, composed: true,
    }));
  }

  // ── Shared status rendering ─────────────────────────────────────────────

  _taskOverlay(key) {
    const task = this._taskStatus.get(key);
    if (!task) return null;
    if (task.status === 'pending' || task.status === 'queued') {
      return html`<span class="cell-icon cell-loading"></span>`;
    }
    if (task.status === 'success') {
      return html`<span class="cell-icon" style="color:var(--s2-green-700,#0ba45d)" title="Done">
        ${icon('S2_Icon_CheckmarkCircle_20_N')}</span>`;
    }
    if (task.status === 'error') {
      return html`<span class="cell-icon" style="color:var(--s2-red-700,#ff513d)" title=${task.error || 'Failed'}>
        ${icon('S2_Icon_AlertDiamond_20_N')}</span>`;
    }
    return null;
  }

  _statusIcon(data) {
    const cfg = getStatusConfig(data);
    return html`<span class="cell-icon" style="color:${cfg.color}" title=${cfg.tip}>${icon(cfg.name)}</span>`;
  }

  // ── Render: downward matrix ───────────────────────────────────────────────

  renderCell(page, satSite) {
    const overlay = this._taskOverlay(cellKey(page.path, satSite));
    if (overlay) return overlay;
    const cell = this._cells.get(cellKey(page.path, satSite));
    if (!cell) return html`<span class="cell-icon cell-loading"></span>`;
    const inh = cell.hasOverride
      ? { name: 'S2_Icon_UnLink_20_N', tip: 'Local copy (inheritance broken)' }
      : { name: 'S2_Icon_LinkApplied_20_N', tip: `Inheriting from ${this._siteTitle(cell.sourceSite)}` };
    return html`
      <span class="cell-pair">
        <span class="cell-inherit" title=${inh.tip}>${icon(inh.name, '0 0 20 20', 13, 13)}</span>
        ${this._statusIcon(cell)}
      </span>`;
  }

  renderTargetHeader(col) {
    const state = this._columnState(col.site);
    const expanded = this._expandedCols.has(col.site);
    return html`
      <th class="target ${state === 'unchecked' ? 'off' : ''} ${col.depth > 0 ? 'nested' : ''}">
        <div class="target-head">
          ${col.childCount ? html`
            <button class="col-toggle ${expanded ? 'open' : ''}" ?disabled=${this._busy}
              title="${expanded ? 'Collapse' : 'Expand'} ${col.childCount} nested"
              @click=${() => this._toggleColumnExpand(col.site)}>
              ${icon('S2_Icon_ChevronRight_20_N', '0 0 20 20', 12, 12)}
              ${expanded ? nothing : html`<span class="col-count">${col.childCount}</span>`}
            </button>` : nothing}
          <label class="cb">
            <input type="checkbox" .checked=${state === 'checked'} .indeterminate=${state === 'indeterminate'}
              ?disabled=${this._busy} @change=${() => this._toggleTarget(col.site)} />
            <span class="target-label" title=${col.site}>${col.label}</span>
          </label>
        </div>
      </th>`;
  }

  renderMatrix() {
    const columns = this._columns;
    return html`
      <div class="matrix-scroll">
        <table class="matrix">
          <thead>
            <tr>
              <th class="corner">Page</th>
              ${columns.map((col) => this.renderTargetHeader(col))}
            </tr>
          </thead>
          <tbody>
            ${this._pages.map((page) => html`
              <tr>
                <th class="page" scope="row">
                  <span class="page-name" title=${page.path}>${page.path}</span>
                </th>
                ${columns.map((col) => html`
                  <td class="cell ${col.depth > 0 ? 'nested' : ''} ${this._includedTargets.has(col.site) ? '' : 'dim'}">
                    ${this.renderCell(page, col.site)}
                  </td>`)}
              </tr>`)}
          </tbody>
        </table>
      </div>`;
  }

  // ── Render: upward table ──────────────────────────────────────────────────

  renderInheritChip(row) {
    if (!row) return html`<span class="cell-icon cell-loading"></span>`;
    let name = 'S2_Icon_UnLink_20_N';
    let text = 'Local only — no base';
    if (row.category === 'inherited') {
      name = 'S2_Icon_LinkApplied_20_N';
      text = `Inheriting from ${this._siteTitle(row.source)}`;
    } else if (row.category === 'override') {
      text = 'Local copy';
    }
    return html`<span class="inherit-chip">
      <span class="cell-inherit">${icon(name, '0 0 20 20', 13, 13)}</span>${text}</span>`;
  }

  renderUpRow(page) {
    const row = this._rows.get(page.path);
    return html`
      <tr>
        <th class="page" scope="row">
          <span class="page-name" title=${page.path}>${page.path}</span>
        </th>
        <td class="up-state">${this.renderInheritChip(row)}</td>
        <td class="cell">
          ${row ? this._statusIcon(row) : html`<span class="cell-icon cell-loading"></span>`}
        </td>
      </tr>`;
  }

  renderUpTable() {
    return html`
      <div class="matrix-scroll">
        <table class="matrix up-table">
          <thead>
            <tr>
              <th class="corner">Page</th>
              <th class="up-col">Inheritance</th>
              <th class="up-col">Status</th>
            </tr>
          </thead>
          <tbody>
            ${this._pages.map((page) => this.renderUpRow(page))}
          </tbody>
        </table>
      </div>`;
  }

  // ── Render: action bar + confirm + success ────────────────────────────────

  renderConfirm() {
    const c = this._confirm;
    if (!c) return nothing;
    const msg = `${c.label}: ${c.count} cell${c.count === 1 ? '' : 's'}. Continue?`;
    return html`
      <div class="confirm-row ${c.destructive ? 'destructive' : ''}">
        <div class="confirm-msg">${msg}</div>
        <div class="confirm-actions">
          <button class="s2-btn s2-btn-confirm" ?disabled=${c.count === 0} @click=${() => this._execute()}>Confirm</button>
          <button class="s2-btn s2-btn-outline" @click=${() => this._dismissConfirm()}>Cancel</button>
        </div>
      </div>`;
  }

  renderActionBar() {
    // Roll out / Cancel act on inherited cells; Sync / Re-enable on local copies.
    const inherited = this._scopedCells('inherited').length;
    const custom = this._scopedCells('custom').length;
    const off = this._busy || this._includedTargets.size === 0;

    return html`
      <div class="action-bar">
        <div class="action-group">
          <span class="action-label">Roll out</span>
          <sl-button ?disabled=${off || inherited === 0}
            @click=${() => this._requestAction({ exec: 'preview', scope: 'inherited', label: 'Roll out to preview' })}>Preview</sl-button>
          <sl-button variant="primary" ?disabled=${off || inherited === 0}
            @click=${() => this._requestAction({ exec: 'publish', scope: 'inherited', label: 'Roll out to live' })}>Live</sl-button>
        </div>
        <div class="action-group">
          <span class="action-label">Sync</span>
          <sl-button ?disabled=${off || custom === 0}
            @click=${() => this._requestAction({
    exec: 'sync', scope: 'custom', syncMode: 'merge', label: 'Sync (merge)',
  })}>Merge</sl-button>
          <sl-button ?disabled=${off || custom === 0}
            @click=${() => this._requestAction({
    exec: 'sync', scope: 'custom', syncMode: 'override', label: 'Sync (override)', destructive: true,
  })}>Override</sl-button>
        </div>
        <div class="action-group">
          <span class="action-label">Inheritance</span>
          <sl-button ?disabled=${off || inherited === 0}
            @click=${() => this._requestAction({
    exec: 'cancel-inheritance', scope: 'inherited', label: 'Cancel inheritance (create local copy)', destructive: true,
  })}>Cancel</sl-button>
          <sl-button ?disabled=${off || custom === 0}
            @click=${() => this._requestAction({
    exec: 'resume-inheritance', scope: 'custom', label: 'Re-enable inheritance (remove local copy)', destructive: true,
  })}>Re-enable</sl-button>
        </div>
      </div>`;
  }

  renderSuccess() {
    const s = this._success;
    if (!s) return nothing;
    return html`
      <div class="success-banner">
        <span class="success-title">${icon('S2_Icon_CheckmarkCircle_20_N')}
          ${s.label} — ${s.ok} succeeded${s.failed ? `, ${s.failed} failed` : ''}</span>
        <button class="success-dismiss" @click=${() => { this._success = null; }}>Dismiss</button>
      </div>`;
  }

  // ── Render: sections ────────────────────────────────────────────────────

  renderDownSection() {
    return html`
      <div class="section">
        <div class="section-head"><span class="section-label">Satellites for ${this._siteTitle(this.site)}</span></div>
        ${this._targets.length
    ? html`
            ${this.renderMatrix()}
            ${this.renderConfirm()}
            ${this.renderActionBar()}`
    : html`<div class="panel-empty">No satellites configured for this site.</div>`}
      </div>`;
  }

  // Breadcrumb of the inheritance chain (root → current). Ancestor segments are
  // clickable: each re-selects the same pages at that base so its matrix can act
  // on them. The current site isn't a link. Local-only pages (no base
  // counterpart) are left out of the hand-off.
  renderChain() {
    const ancestors = (this._roles.asSatellite?.chain || [])
      .map((c) => ({ site: c.site, label: this._siteTitle(c.site) }));
    const current = { site: this.site, label: this._siteTitle(this.site), current: true };
    const nodes = [...ancestors, current];
    const paths = this._pages
      .filter((p) => this._rows.get(p.path)?.category !== 'local')
      .map((p) => p.path);
    return html`<span class="chain" aria-label="Inheritance chain">
      ${nodes.map((node, i) => html`
        ${i > 0 ? html`<span class="chain-sep" aria-hidden="true">›</span>` : nothing}
        ${node.current
    ? html`<span class="chain-node current">${node.label}</span>`
    : html`<button class="chain-node chain-link" ?disabled=${this._busy || !paths.length}
              title="Manage these pages in ${node.label}"
              @click=${() => this._emitManageInBase(node.site, paths)}>${node.label}</button>`}
      `)}
    </span>`;
  }

  renderUpSection() {
    return html`
      <div class="section">
        <div class="section-head"><span class="section-label">Inheritance</span></div>
        ${this.renderUpTable()}
      </div>`;
  }

  render() {
    if (!this._pages.length) {
      return html`<div class="panel-empty">Select pages in the browser to act on them.</div>`;
    }
    const roles = this._roles;

    return html`
      <div class="panel">
        <div class="panel-header">
          ${this.renderChain()}
          <span class="panel-sub">${this._pages.length} page${this._pages.length === 1 ? '' : 's'} selected${this._busy ? ' · working…' : ''}</span>
        </div>
        ${this.renderSuccess()}
        ${roles.asSatellite ? this.renderUpSection() : nothing}
        ${roles.asBase ? this.renderDownSection() : nothing}
        ${!roles.asBase && !roles.asSatellite
    ? html`<div class="panel-empty">No MSM relationships configured for this site.</div>`
    : nothing}
      </div>`;
  }
}

customElements.define('msm-action-panel', MsmActionPanel);
