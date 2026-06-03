/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console, class-methods-use-this */
import { LitElement, html, nothing } from 'da-lit';
import {
  getSiteRoles,
  getPageTimestamp,
  getPageStatus,
  getStatusConfig,
  executeBulkAction,
  PUBLISH_LAG_MS,
} from './api.js';
import { icon } from '../core/icons.js';
import {
  cellKey,
  findNode,
  subtreeSites,
  parentMap,
  flattenAll,
  flattenVisible,
  columnState,
  toggleTarget,
  effectiveSource,
  deriveCategory,
  isOutOfSync,
  scopedCells,
  scopedPagesUp,
  downGroups,
  upGroups,
  planSelectionLoad,
} from './action-panel.model.js';

const NX = 'https://da.live/nx';
let sl;
let sheet;
try {
  const { default: getStyle } = await import(`${NX}/utils/styles.js`);
  [sl, sheet] = await Promise.all([
    getStyle(`${NX}/public/sl/styles.css`),
    getStyle(import.meta.url),
  ]);
} catch (e) {
  console.warn('Failed to load action-panel styles:', e);
}

// How many status probes to run at once when filling the matrix / table.
const CELL_CONCURRENCY = 6;

const sanitizeId = (s) => s.replace(/[^a-zA-Z0-9]/g, '-');

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
    _tab: { state: true },
    _confirm: { state: true },
    _busy: { state: true },
    _taskStatus: { state: true },
    _success: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sl, sheet].filter(Boolean);
    this._cells = new Map();
    this._rows = new Map();
    this._includedTargets = new Set();
    this._expandedCols = new Set();
    this._tab = 'satellites';
    this._confirm = null;
    this._busy = false;
    this._taskStatus = new Map();
    this._success = null;
    this._loadGen = 0;
    this._contextKey = '';
    this._selKey = '';
    // Pages we've already dispatched loads for, per view — the basis for
    // loading only newly-added pages on a selection change.
    this._loadedDownPaths = new Set();
    this._loadedUpPaths = new Set();
    this._busyTotal = 0;
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
    return flattenVisible(this._columnTree, this.site, this._expandedCols);
  }

  // Every column in the subtree regardless of expansion — the basis for data
  // loading, target inclusion, and action scope (collapsed levels still count).
  get _allColumns() {
    return flattenAll(this._columnTree, this.site);
  }

  _subtreeSites(site) {
    return subtreeSites(this._columnTree, site);
  }

  _columnState(site) {
    return columnState(this._columnTree, site, this._includedTargets);
  }

  _parentMap() {
    return parentMap(this._columnTree, this.site);
  }

  _findNode(site) {
    return findNode(this._columnTree, site);
  }

  _labelFor(sat) {
    return this._findNode(sat)?.label || sat;
  }

  _targetLabel(view, target) {
    return view === 'satellites' ? this._labelFor(target) : this._siteTitle(target);
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
  _effectiveSource(page, sat, pm) {
    return effectiveSource(page, sat, pm, this._cells, this.site);
  }

  // ── Selection lifecycle ─────────────────────────────────────────────────

  // A context change (different org/site — always a full reset, since selection
  // is single-site) wipes and reloads everything. A selection change within the
  // same context keeps loaded rows and fetches only the newly-added pages;
  // removed pages just stop rendering. Column include/expand state is preserved
  // across selection changes — it's about satellites, not pages.
  _resetForSelection() {
    const contextKey = `${this.org}|${this.site}`;
    const selKey = this._pages.map((p) => p.path).sort().join(',');
    const plan = planSelectionLoad({
      prevContextKey: this._contextKey,
      prevSelKey: this._selKey,
      contextKey,
      selKey,
      pages: this._pages,
      loadedDownPaths: this._loadedDownPaths,
      loadedUpPaths: this._loadedUpPaths,
      hasBase: !!this._roles.asBase,
      hasSatellite: !!this._roles.asSatellite,
    });
    if (plan.kind === 'noop') return;
    this._contextKey = contextKey;
    this._selKey = selKey;

    if (plan.kind === 'reset') {
      this._loadGen += 1;
      this._cells = new Map();
      this._rows = new Map();
      this._loadedDownPaths = new Set();
      this._loadedUpPaths = new Set();
      this._includedTargets = new Set(this._allColumns.map((c) => c.site));
      this._expandedCols = new Set();
      this._tab = 'satellites';
      this._taskStatus = new Map();
      this._confirm = null;
      this._success = null;
    } else {
      // Selection changed within the context: a pending confirm's scope is stale.
      this._confirm = null;
    }

    if (plan.downPages.length) this._loadAll(plan.downPages);
    if (plan.upPages.length) this._loadRows(plan.upPages);
  }

  // ── Downward matrix data ──────────────────────────────────────────────────

  _setCell(key, data) {
    const next = new Map(this._cells);
    next.set(key, data);
    this._cells = next;
  }

  async _loadCellsFor(sites, pages = this._pages) {
    const gen = this._loadGen;
    const pm = this._parentMap();
    const tasks = [];
    pages.forEach((page) => {
      const ext = page.ext || 'html';
      sites.forEach((sat) => {
        tasks.push(async () => {
          if (gen !== this._loadGen) return;
          try {
            const ts = await getPageTimestamp(this.org, sat, page.path, ext);
            const hasOverride = ts.exists;
            const src = this._effectiveSource(page, sat, pm);
            const editLM = hasOverride ? ts.lastModified : src.lm;
            const status = await getPageStatus(this.org, sat, page.path, editLM, ext);
            const outOfSync = hasOverride && isOutOfSync(src.lm, ts.lastModified, PUBLISH_LAG_MS);
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

  // Probe the given pages across the entire subtree, shallow→deep so each
  // level's source resolves against freshly-loaded ancestors. Defaults to the
  // whole selection; callers pass a subset to load only added or acted pages.
  async _loadAll(pages = this._pages) {
    pages.forEach((p) => this._loadedDownPaths.add(p.path));
    const byDepth = new Map();
    this._allColumns.forEach((c) => {
      if (!byDepth.has(c.depth)) byDepth.set(c.depth, []);
      byDepth.get(c.depth).push(c.site);
    });
    const depths = [...byDepth.keys()].sort((a, b) => a - b);
    /* eslint-disable no-restricted-syntax, no-await-in-loop */
    for (const d of depths) await this._loadCellsFor(byDepth.get(d), pages);
    /* eslint-enable no-restricted-syntax, no-await-in-loop */
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
    const probes = await Promise.all(
      nearestFirst.map((node) => getPageTimestamp(this.org, node.site, page.path, ext)
        .then((ts) => ({ node, ts }))
        .catch(() => ({ node, ts: { exists: false } }))),
    );
    const hit = probes.find((r) => r.ts.exists);
    if (hit) return { site: hit.node.site, lm: hit.ts.lastModified, exists: true };
    return { site: this._roles.asSatellite?.base, lm: null, exists: false };
  }

  async _loadRows(pages = this._pages) {
    pages.forEach((p) => this._loadedUpPaths.add(p.path));
    const gen = this._loadGen;
    const tasks = pages.map((page) => async () => {
      if (gen !== this._loadGen) return;
      const ext = page.ext || 'html';
      try {
        const [selfTs, src] = await Promise.all([
          getPageTimestamp(this.org, this.site, page.path, ext),
          this._resolveUpwardSource(page),
        ]);
        const hasOverride = selfTs.exists;
        const category = deriveCategory({ hasOverride, sourceExists: src.exists });
        const editLM = hasOverride ? selfTs.lastModified : src.lm;
        const status = await getPageStatus(this.org, this.site, page.path, editLM, ext);
        const outOfSync = category === 'override'
          && isOutOfSync(src.lm, selfTs.lastModified, PUBLISH_LAG_MS);
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
    this._includedTargets = toggleTarget(this._columnTree, this._includedTargets, site, this.site);
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
    return scopedCells(this._allColumns, this._pages, this._includedTargets, this._cells, scope);
  }

  // Source-view (upward) pages matching a scope, by inheritance category.
  // scope: 'inherited' (roll out / cancel) | 'override' (sync / re-enable)
  _scopedPagesUp(scope) {
    return scopedPagesUp(this._pages, this._rows, scope);
  }

  _countFor(view, scope) {
    if (view === 'satellites') return this._scopedCells(scope).length;
    return this._scopedPagesUp(scope).length;
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  _requestAction(def) {
    this._confirm = { ...def, count: this._countFor(def.view, def.scope) };
    this._success = null;
  }

  _dismissConfirm() {
    this._confirm = null;
  }

  // Group in-scope work into valid executeBulkAction calls — one target per
  // call, the pages that share its source — so sync / cancel pull from the
  // right base at any tree depth (source can differ per page).
  _downGroups(scope) {
    return downGroups({
      tree: this._columnTree,
      pages: this._pages,
      allColumns: this._allColumns,
      included: this._includedTargets,
      cells: this._cells,
      rootSite: this.site,
      scope,
    });
  }

  // Source view: target is always this site; source is each page's resolved
  // nearest ancestor with content (already computed in `_rows`).
  _upGroups(scope) {
    return upGroups({
      pages: this._pages,
      rows: this._rows,
      scope,
      base: this._roles.asSatellite?.base,
      target: this.site,
    });
  }

  async _execute() {
    if (this._busy || !this._confirm) return;
    const {
      view, exec, scope, syncMode, label,
    } = this._confirm;
    this._confirm = null;
    this._busy = true;
    this._taskStatus = new Map();

    const onPageStatus = (key, status, error) => {
      const next = new Map(this._taskStatus);
      next.set(key, { status, error });
      this._taskStatus = next;
    };

    const groups = view === 'satellites' ? this._downGroups(scope) : this._upGroups(scope);
    this._busyTotal = groups.reduce((n, g) => n + g.pages.length, 0);
    const succeeded = [];
    const errors = [];
    /* eslint-disable no-restricted-syntax, no-await-in-loop */
    for (const g of groups) {
      const results = await executeBulkAction({
        org: this.org,
        baseSite: g.source,
        pages: g.pages,
        satellites: { [g.target]: { label: this._targetLabel(view, g.target) } },
        action: exec,
        syncMode,
        onPageStatus,
      });
      results.forEach((r) => {
        if (r.status === 'fulfilled' && r.value?.status === 'success') {
          succeeded.push(r.value.key);
        } else {
          const v = r.status === 'fulfilled' ? r.value : null;
          errors.push({ key: v?.key || null, error: v?.error || r.reason?.message || 'Failed' });
        }
      });
    }
    /* eslint-enable no-restricted-syntax, no-await-in-loop */

    // Recompute only the pages we acted on. Reloading them across the whole
    // column tree (depth-ordered) also captures descendants whose effective
    // source shifted — e.g. a new local copy becomes the source for its subtree.
    const actedPaths = new Set(groups.flatMap((g) => g.pages.map((p) => p.path)));
    const actedPages = this._pages.filter((p) => actedPaths.has(p.path));
    if (view === 'satellites') await this._loadAll(actedPages);
    else await this._loadRows(actedPages);
    this._taskStatus = new Map();
    this._busy = false;
    this._success = {
      label, action: exec, ok: succeeded.length, failed: errors.length, results: succeeded, errors,
    };
  }

  // Re-select the same pages at another site (an ancestor via the breadcrumb,
  // or a satellite via a column header) so the panel re-renders in that site's
  // context. The column browser resolves which of the paths exist there.
  _navigateTo(site, paths) {
    if (!site || !paths.length) return;
    this.dispatchEvent(new CustomEvent('navigate-pages', {
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
    const body = html`
      <span class="cell-pair">
        <span class="cell-inherit" title=${inh.tip}>${icon(inh.name, '0 0 20 20', 13, 13)}</span>
        ${this._statusIcon(cell)}
      </span>`;
    // A local copy is editable on that satellite — link the cell to its doc.
    if (cell.hasOverride && (page.ext || 'html') === 'html') {
      return html`<a class="cell-link" href=${this._editUrl(satSite, page.path)}
        target="_blank" rel="noopener"
        title="Open ${this._siteTitle(satSite)} copy of ${page.path} in editor">${body}</a>`;
    }
    return body;
  }

  renderTargetHeader(col) {
    const state = this._columnState(col.site);
    const expanded = this._expandedCols.has(col.site);
    return html`
      <th class="target ${state === 'unchecked' ? 'off' : ''} ${col.depth > 0 ? 'nested' : ''}"
          id="mat-col-${sanitizeId(col.site)}">
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
          </label>
          <button class="target-label target-jump" ?disabled=${this._busy}
            title="Manage ${col.label}'s pages here"
            @click=${() => this._navigateTo(col.site, this._pages.map((p) => p.path))}>${col.label}</button>
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
              <th class="corner" id="mat-page-hdr">Page</th>
              ${columns.map((col) => this.renderTargetHeader(col))}
            </tr>
          </thead>
          <tbody>
            ${this._pages.map((page) => html`
              <tr>
                <th class="page" scope="row" id="mat-row-${sanitizeId(page.path)}">
                  ${this.renderPageCell(page)}
                </th>
                ${columns.map((col) => html`
                  <td class="cell ${col.depth > 0 ? 'nested' : ''} ${this._includedTargets.has(col.site) ? '' : 'dim'}"
                      headers="mat-row-${sanitizeId(page.path)} mat-col-${sanitizeId(col.site)}">
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
    const rid = `up-row-${sanitizeId(page.path)}`;
    return html`
      <tr>
        <th class="page" scope="row" id=${rid}>
          ${this.renderPageCell(page)}
        </th>
        <td class="up-state" headers="${rid} up-inherit-hdr">${this.renderInheritChip(row)}</td>
        <td class="cell" headers="${rid} up-status-hdr">
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
              <th class="corner" id="up-page-hdr">Page</th>
              <th class="up-col" id="up-inherit-hdr">Inheritance</th>
              <th class="up-col" id="up-status-hdr">Status</th>
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
    const unit = c.view === 'satellites' ? 'cell' : 'page';
    const msg = `${c.label}: ${c.count} ${unit}${c.count === 1 ? '' : 's'}. Continue?`;
    return html`
      <div class="confirm-row ${c.destructive ? 'destructive' : ''}">
        <div class="confirm-msg">${msg}</div>
        <div class="confirm-actions">
          <button class="s2-btn s2-btn-confirm" ?disabled=${c.count === 0} @click=${() => this._execute()}>Confirm</button>
          <button class="s2-btn s2-btn-outline" @click=${() => this._dismissConfirm()}>Cancel</button>
        </div>
      </div>`;
  }

  // One bar, scoped to the active view. Satellites view acts on matrix cells
  // (inherited vs local-copy); Source view acts on this site's pages vs base.
  renderActionBar(view) {
    const down = view === 'satellites';
    const localScope = down ? 'custom' : 'override';
    const rollout = this._countFor(view, 'inherited');
    const local = this._countFor(view, localScope);
    const off = this._busy || (down && this._includedTargets.size === 0);

    return html`
      <div class="action-bar">
        <div class="action-group">
          <span class="action-label">Roll out</span>
          <sl-button ?disabled=${off || rollout === 0}
            @click=${() => this._requestAction({
    view, exec: 'publish', scope: 'inherited', label: 'Roll out to live',
  })}>Live</sl-button>
          <sl-button class="primary outline" ?disabled=${off || rollout === 0}
            @click=${() => this._requestAction({
    view, exec: 'preview', scope: 'inherited', label: 'Roll out to preview',
  })}>Preview</sl-button>
        </div>
        <div class="action-group">
          <span class="action-label">Sync</span>
          <sl-button ?disabled=${off || local === 0}
            @click=${() => this._requestAction({
    view, exec: 'sync', scope: localScope, syncMode: 'merge', label: 'Sync (merge)',
  })}>Merge</sl-button>
          <sl-button class="primary outline" ?disabled=${off || local === 0}
            @click=${() => this._requestAction({
    view, exec: 'sync', scope: localScope, syncMode: 'override', label: 'Sync (override)', destructive: true,
  })}>Override</sl-button>
        </div>
        <div class="action-group">
          <span class="action-label">Inheritance</span>
          <sl-button ?disabled=${off || local === 0}
            @click=${() => this._requestAction({
    view, exec: 'resume-inheritance', scope: localScope, label: 'Re-enable inheritance (remove local copy)', destructive: true,
  })}>Re-enable</sl-button>
          <sl-button class="primary outline" ?disabled=${off || rollout === 0}
            @click=${() => this._requestAction({
    view, exec: 'cancel-inheritance', scope: 'inherited', label: 'Cancel inheritance (create local copy)', destructive: true,
  })}>Cancel</sl-button>
        </div>
      </div>`;
  }

  // Where to open a succeeded (page, satellite) result. Rollouts open the
  // published page (preview → aem.page, live → aem.live); sync/cancel open the
  // editor for the now-local copy. Re-enable removed the copy, so no link.
  _resultUrl(action, pagePath, site) {
    const clean = pagePath.replace(/\.html$/, '');
    if (action === 'preview' || action === 'publish') {
      const host = action === 'publish' ? 'aem.live' : 'aem.page';
      return `https://main--${site}--${this.org}.${host}${clean}`;
    }
    if (action === 'resume-inheritance') return null;
    return `https://da.live/edit#/${this.org}/${site}${clean}`;
  }

  _editUrl(site, pagePath) {
    return `https://da.live/edit#/${this.org}/${site}${pagePath.replace(/\.html$/, '')}`;
  }

  // Editor URL for a page's actual content doc: this site when it has a local
  // copy (or is the base), else the ancestor it inherits from. Only docs (html)
  // have an editor; assets return null.
  _editUrlForPage(page) {
    if ((page.ext || 'html') !== 'html') return null;
    const row = this._rows.get(page.path);
    const site = row && row.category === 'inherited' ? row.source : this.site;
    if (!site) return null;
    return this._editUrl(site, page.path);
  }

  renderPageName(page) {
    const url = this._editUrlForPage(page);
    if (!url) return html`<span class="page-name" title=${page.path}>${page.path}</span>`;
    return html`<a class="page-name page-link" href=${url} target="_blank" rel="noopener"
      title="Open ${page.path} in editor">${page.path}</a>`;
  }

  // Drop a page from the selection (the column browser owns it).
  _emitDeselect(page) {
    this.dispatchEvent(new CustomEvent('deselect-page', {
      detail: { site: this.site, path: page.path }, bubbles: true, composed: true,
    }));
  }

  renderRemove(page) {
    return html`<button class="row-remove" aria-label="Remove ${page.path} from selection"
      title="Remove from selection" ?disabled=${this._busy}
      @click=${() => this._emitDeselect(page)}>×</button>`;
  }

  // Flex wrapper kept inside the <th> so the cell still lays out as a table cell.
  renderPageCell(page) {
    return html`<div class="page-cell">${this.renderPageName(page)}${this.renderRemove(page)}</div>`;
  }

  // Short "{site} · {page}" label for a `${path}:${site}` result key.
  _resultLabel(key) {
    const ci = key.lastIndexOf(':');
    const leaf = key.slice(0, ci).split('/').pop().replace(/\.[^/.]+$/, '');
    return `${this._siteTitle(key.slice(ci + 1))} · ${leaf}`;
  }

  renderBusy() {
    const done = [...this._taskStatus.values()]
      .filter((t) => t.status === 'success' || t.status === 'error').length;
    const total = this._busyTotal || this._taskStatus.size;
    const progress = total ? ` ${done}/${total}` : '';
    return html`
      <div class="busy-banner">
        <span class="busy-spinner"></span>
        <span>Working…${progress}</span>
      </div>`;
  }

  renderSuccess() {
    const s = this._success;
    if (!s) return nothing;
    const links = (s.results || []).map((key) => {
      const ci = key.lastIndexOf(':');
      const url = this._resultUrl(s.action, key.slice(0, ci), key.slice(ci + 1));
      return url ? { url, label: this._resultLabel(key) } : null;
    }).filter(Boolean);
    const shown = links.slice(0, 10);
    const extra = links.length - shown.length;

    const errs = (s.errors || []).slice(0, 8).map((e) => (
      e.key ? `${this._resultLabel(e.key)}: ${e.error}` : e.error
    ));
    const moreErr = (s.errors?.length || 0) - errs.length;
    const allFailed = s.failed > 0 && s.ok === 0;

    return html`
      <div class="success-banner ${s.failed ? 'has-errors' : ''}">
        <div class="success-head">
          <span class="success-title">${icon(allFailed ? 'S2_Icon_AlertDiamond_20_N' : 'S2_Icon_CheckmarkCircle_20_N')}
            ${s.label} — ${s.ok} succeeded${s.failed ? `, ${s.failed} failed` : ''}</span>
          <button class="success-dismiss" @click=${() => { this._success = null; }}>Dismiss</button>
        </div>
        ${shown.length ? html`
          <div class="success-links">
            ${shown.map((l) => html`<a class="success-link" href=${l.url} target="_blank" rel="noopener">${l.label} ↗</a>`)}
            ${extra > 0 ? html`<span class="success-more">+${extra} more</span>` : nothing}
          </div>` : nothing}
        ${errs.length ? html`
          <ul class="error-list">
            ${errs.map((m) => html`<li>${m}</li>`)}
            ${moreErr > 0 ? html`<li>+${moreErr} more</li>` : nothing}
          </ul>` : nothing}
      </div>`;
  }

  // ── Render: sections ────────────────────────────────────────────────────

  renderDownSection(tabbed) {
    return html`
      <div class="section">
        ${tabbed ? nothing : html`<div class="section-head"><span class="section-label">Satellites for ${this._siteTitle(this.site)}</span></div>`}
        ${this._targets.length
    ? html`
            ${this.renderMatrix()}
            ${this.renderConfirm()}
            ${this.renderActionBar('satellites')}`
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
              @click=${() => this._navigateTo(node.site, paths)}>${node.label}</button>`}
      `)}
    </span>`;
  }

  renderUpSection(tabbed) {
    return html`
      <div class="section">
        ${tabbed ? nothing : html`<div class="section-head"><span class="section-label">Source</span></div>`}
        ${this.renderUpTable()}
        ${this.renderConfirm()}
        ${this.renderActionBar('source')}
      </div>`;
  }

  // The view in effect: a dual site picks via tabs; otherwise it's forced.
  get _activeView() {
    const roles = this._roles;
    if (roles.asBase && roles.asSatellite) return this._tab;
    if (roles.asBase) return 'satellites';
    if (roles.asSatellite) return 'source';
    return null;
  }

  _setTab(tab) {
    if (this._tab === tab) return;
    this._tab = tab;
    this._confirm = null;
  }

  renderTabs() {
    const tab = this._tab;
    return html`
      <div class="tabs" role="tablist">
        <button class="tab ${tab === 'satellites' ? 'active' : ''}" role="tab"
          aria-selected=${tab === 'satellites' ? 'true' : 'false'}
          @click=${() => this._setTab('satellites')}>Satellites</button>
        <button class="tab ${tab === 'source' ? 'active' : ''}" role="tab"
          aria-selected=${tab === 'source' ? 'true' : 'false'}
          @click=${() => this._setTab('source')}>Source</button>
      </div>`;
  }

  render() {
    if (!this._pages.length) {
      return html`<div class="panel-empty">Select pages in the browser to act on them.</div>`;
    }
    const dual = !!(this._roles.asBase && this._roles.asSatellite);
    const view = this._activeView;

    return html`
      <div class="panel">
        <div class="panel-header">
          ${this.renderChain()}
          <span class="panel-sub">${this._pages.length} page${this._pages.length === 1 ? '' : 's'} selected</span>
        </div>
        ${this._busy ? this.renderBusy() : this.renderSuccess()}
        ${dual ? this.renderTabs() : nothing}
        ${view === 'satellites' ? this.renderDownSection(dual) : nothing}
        ${view === 'source' ? this.renderUpSection(dual) : nothing}
        ${!view ? html`<div class="panel-empty">No MSM relationships configured for this site.</div>` : nothing}
      </div>`;
  }
}

customElements.define('msm-action-panel', MsmActionPanel);
