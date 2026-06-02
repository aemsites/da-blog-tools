/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console */
/* eslint-disable class-methods-use-this */
import { LitElement, html, nothing } from 'da-lit';
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import {
  getSiteConfig,
  getSatelliteTree,
  getPageTimestamp,
  setSdkFetch as setConfigSdkFetch,
} from './config.js';
import {
  previewSatellite,
  publishSatellite,
  createOverride,
  deleteOverride,
  mergeFromBase,
  getSatellitePageStatus,
  setSdkFetch as setUtilsSdkFetch,
  setEditUrlOrigin,
} from './utils.js';

const MSM_APP_URL = 'https://da.live/app/aemsites/da-blog-tools/tools/apps/msm/msm';
const ICON_BASE = './img';
const NX = 'https://da.live/nx';

let nexter = null;
let styles = null;
try {
  const [{ default: getStyle }, { loadStyle }] = await Promise.all([
    import(`${NX}/utils/styles.js`),
    import(`${NX}/scripts/nexter.js`),
  ]);
  await loadStyle(`${NX}/styles/nexter.css`);
  [nexter, styles] = await Promise.all([
    getStyle(`${NX}/styles/nexter.css`),
    getStyle(import.meta.url),
  ]);
} catch (e) {
  console.warn('[MSM Plugin] Failed to load nexter styles:', e);
}

// ── Icon helpers — use external SVG files via <use>, color via currentColor ─

const icon = (name, viewBox = '0 0 14 14', w = 16, h = 16) => html`
  <svg width="${w}" height="${h}" viewBox="${viewBox}">
    <use href="${ICON_BASE}/${name}.svg#${name}"/>
  </svg>`;

// Publish-state key → { name, viewBox, color, tip }
const ICON2_CONFIG = {
  'not-rolled-out': { name: 'icon-circle-alert', color: 'var(--s2-red-700,#ff513d)', tip: 'Not yet previewed or published' },
  'preview-current': { name: 'icon-triangle-alert', color: 'var(--s2-orange-600,#fc7d00)', tip: 'Previewed — not yet published to live' },
  'preview-behind': { name: 'icon-circle-alert', color: 'var(--s2-red-700,#ff513d)', tip: 'WIP has changed — preview is out of date' },
  'preview-current-live-behind': { name: 'icon-triangle-alert', color: 'var(--s2-orange-600,#fc7d00)', tip: 'Preview current — published content is out of date' },
  'live-current': { name: 'icon-circle-check', color: 'var(--s2-green-700,#0ba45d)', tip: 'Preview and published are current' },
  'live-behind': { name: 'icon-circle-alert', color: 'var(--s2-red-700,#ff513d)', tip: 'WIP has changed — re-publish needed' },
};

function getStatusKey(d) {
  const { previewState, liveState } = d;
  if (liveState === 'current') return 'live-current';
  if (liveState === 'behind') return previewState === 'current' ? 'preview-current-live-behind' : 'live-behind';
  if (previewState === 'current') return 'preview-current';
  if (previewState === 'behind') return 'preview-behind';
  return 'not-rolled-out';
}

class DaMsm extends LitElement {
  static properties = {
    details: { attribute: false },
    _loading: { state: true },
    _busy: { state: true },
    _asBase: { state: true },
    _asSatellite: { state: true },
    _hasOverride: { state: true },
    _tree: { state: true },
    _satData: { state: true },
    _collapsed: { state: true },
    _pendingConfirm: { state: true },
    _fullConfirmScope: { state: true },
    _confirmScope: { state: true },
    _successData: { state: true },
    _menuSiteId: { state: true },
    _menuPos: { state: true },
    _effectiveBase: { state: true },
    _sourceOutOfSync: { state: true },
    _sitePageStatus: { state: true },
    _sourceError: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [nexter, styles].filter(Boolean);
    this._loading = 'Loading…';
    this._busy = false;
    this._tree = [];
    this._satData = new Map();
    this._collapsed = new Set();
    this._pendingConfirm = null;
    this._fullConfirmScope = [];
    this._confirmScope = [];
    this._successData = null;
    this._menuSiteId = null;
    this._menuPos = null;
    this._baseSiteLastModified = null;
    this._effectiveBase = null;
    this._sourceOutOfSync = null;
    this._sitePageStatus = null;
    this._sourceError = null;
    this.loadConfig();
  }

  async loadConfig() {
    const { org, site, path } = this.details;
    this._loading = 'Loading configuration…';

    const [config, tree] = await Promise.all([
      getSiteConfig(org, site),
      getSatelliteTree(org, site),
    ]);

    if (!config) {
      this._loading = undefined;
      return;
    }

    this._asBase = config.asBase;
    this._asSatellite = config.asSatellite;
    this._tree = tree;

    // Seed satData with labels so tree renders names immediately
    const initial = new Map();
    const seed = (nodes) => nodes.forEach(({ siteId, label, children }) => {
      initial.set(siteId, { label });
      if (children?.length) seed(children);
    });
    seed(tree);
    this._satData = initial;

    // Auto-collapse mid-tier nodes (those with children)
    const collapsed = new Set();
    const markCollapsed = (nodes) => nodes.forEach(({ siteId, children }) => {
      if (children?.length) { collapsed.add(siteId); markCollapsed(children); }
    });
    markCollapsed(tree);
    this._collapsed = collapsed;

    // Load upward override status; resolve effective source if direct parent has no local copy
    if (this._asSatellite) {
      const baseSite = this._asSatellite.base;
      const [siteTs, baseTs] = await Promise.all([
        getPageTimestamp(org, site, path),
        getPageTimestamp(org, baseSite, path),
      ]);
      this._hasOverride = siteTs.exists;

      let effectiveTs = baseTs;
      if (!baseTs.exists) {
        const chain = this._asSatellite.chain || [];
        const ancestors = chain.slice(0, chain.length - 1);
        if (ancestors.length > 0) {
          const checks = await Promise.all(
            ancestors.map((a) => getPageTimestamp(org, a.site, path)
              .then((ts) => ({ ...a, hasContent: ts.exists, lastModified: ts.lastModified }))),
          );
          const nearest = [...checks].reverse().find((a) => a.hasContent);
          const resolved = nearest || checks[0];
          this._effectiveBase = resolved;
          effectiveTs = resolved
            ? { exists: resolved.hasContent, lastModified: resolved.lastModified }
            : null;
        }
      }

      if (siteTs.exists && siteTs.lastModified && effectiveTs?.lastModified) {
        this._sourceOutOfSync = new Date(effectiveTs.lastModified) > new Date(siteTs.lastModified);
      }

      // Load publish status for this site's page (for icon2 on the source row)
      getSatellitePageStatus(org, site, path, siteTs.lastModified).then((status) => {
        this._sitePageStatus = status;
      });
    }

    this._loading = undefined;

    // Top-level nodes load eagerly; deeper nodes load lazily when their parent is expanded
    if (this._asBase) {
      const baseSiteTs = await getPageTimestamp(org, site, path);
      this._baseSiteLastModified = baseSiteTs.lastModified;
      this._loadNodes(tree.map((n) => n.siteId));
    }
  }

  _getAppDeepLink() {
    const { org, site, path } = this.details;
    const params = new URLSearchParams({ org, site, path });
    // TODO: remove ref once msm-app branch is merged to main
    params.set('ref', 'msm-app');
    return `${MSM_APP_URL}?${params.toString()}`;
  }

  // ── Tree helpers ──────────────────────────────────────────────────────────

  _subtree(siteId) {
    const find = (nodes) => nodes.reduce((acc, n) => {
      if (acc) return acc;
      if (n.siteId === siteId) return n;
      return find(n.children || []);
    }, null);
    const node = find(this._tree);
    if (!node) return [siteId];
    const ids = [];
    const collect = (n) => { ids.push(n.siteId); (n.children || []).forEach(collect); };
    collect(node);
    return ids;
  }

  _inheritedInSubtree(rootSiteId) {
    const find = (nodes) => nodes.reduce((acc, n) => {
      if (acc) return acc;
      if (n.siteId === rootSiteId) return n;
      return find(n.children || []);
    }, null);
    const node = find(this._tree);
    if (!node) return this._satData.get(rootSiteId)?.hasOverride === false ? [rootSiteId] : [];
    const ids = [];
    const collect = (n) => {
      if (this._satData.get(n.siteId)?.hasOverride !== false) return;
      ids.push(n.siteId);
      (n.children || []).forEach(collect);
    };
    collect(node);
    return ids;
  }

  _parentOf(siteId, nodes = this._tree, parent = null) {
    return nodes.reduce((found, n) => {
      if (found !== undefined) return found;
      if (n.siteId === siteId) return parent;
      return this._parentOf(siteId, n.children || [], n.siteId);
    }, undefined);
  }

  _ancestorChain(siteId) {
    const chain = [];
    let current = this._parentOf(siteId);
    while (current) {
      chain.push(current);
      current = this._parentOf(current);
    }
    return chain;
  }

  _effectiveBaseLM(siteId) {
    const ancestors = this._ancestorChain(siteId);
    const nearest = ancestors.find((id) => this._satData.get(id)?.hasOverride === true);
    return nearest
      ? (this._satData.get(nearest)?.lastModified || null)
      : this._baseSiteLastModified;
  }

  async _loadNodes(siteIds) {
    const { org, path } = this.details;
    const timestamps = await Promise.all(
      siteIds.map((id) => getPageTimestamp(org, id, path).then((ts) => ({ id, ...ts }))),
    );

    const update = new Map(this._satData);
    timestamps.forEach(({ id, exists, lastModified }) => {
      const satTime = lastModified ? new Date(lastModified).getTime() : null;
      let outOfSync = false;
      if (exists) {
        const refLM = this._effectiveBaseLM(id);
        const refTime = refLM ? new Date(refLM).getTime() : null;
        outOfSync = refTime !== null && satTime !== null && satTime < refTime;
      }
      update.set(id, {
        ...update.get(id), hasOverride: exists, outOfSync, lastModified,
      });
    });
    this._satData = update;

    siteIds.forEach((id) => {
      const d = this._satData.get(id);
      const editLM = d?.hasOverride ? d.lastModified : this._effectiveBaseLM(id);
      getSatellitePageStatus(org, id, path, editLM).then((status) => {
        const m = new Map(this._satData);
        m.set(id, { ...m.get(id), ...status });
        this._satData = m;
      });
    });
  }

  // ── Action execution ──────────────────────────────────────────────────────

  _setSatField(siteId, fields) {
    const next = new Map(this._satData);
    next.set(siteId, { ...next.get(siteId), ...fields });
    this._satData = next;
  }

  async _rollout(siteIds, level) {
    this._busy = true;
    const { org, path } = this.details;

    siteIds.forEach((id) => this._setSatField(id, { actionStatus: 'pending' }));
    const results = await Promise.allSettled(siteIds.map(async (id) => {
      const previewResult = await previewSatellite(org, id, path);
      if (previewResult?.error) return previewResult;
      if (level === 'live') return publishSatellite(org, id, path);
      return previewResult;
    }));

    const succeeded = [];
    results.forEach((r, idx) => {
      const ok = r.status === 'fulfilled' && !r.value?.error;
      this._setSatField(siteIds[idx], { actionStatus: ok ? 'success' : 'error' });
      if (ok) succeeded.push(siteIds[idx]);
    });

    if (succeeded.length) {
      succeeded.forEach((id) => {
        this._setSatField(id, {
          previewState: 'current',
          ...(level === 'live' ? { liveState: 'current' } : {}),
        });
      });
      this._successData = { targets: succeeded, action: 'rollout', level };
    }
    this._busy = false;
  }

  async _cancelInheritance(siteId) {
    this._busy = true;
    const { org, site, path } = this.details;
    const result = await createOverride(org, site, siteId, path);
    if (!result.error) {
      this._setSatField(siteId, { hasOverride: true, outOfSync: false });
      this._successData = { targets: [siteId], action: 'cancel-inheritance' };
    }
    this._busy = false;
  }

  async _resumeInheritance(siteId) {
    if (this._busy) return;
    this._busy = true;
    const { org, path } = this.details;
    const pageStatus = await getSatellitePageStatus(org, siteId, path);
    const result = await deleteOverride(org, siteId, path);
    if (!result?.error) {
      if (pageStatus.liveState !== 'not-rolled-out') {
        await previewSatellite(org, siteId, path);
        await publishSatellite(org, siteId, path);
      } else if (pageStatus.previewState !== 'not-rolled-out') {
        await previewSatellite(org, siteId, path);
      }
      if (siteId === this.details.site) {
        this._hasOverride = false;
      } else {
        this._setSatField(siteId, { hasOverride: false, outOfSync: false });
      }
      this._successData = { targets: [siteId], action: 'resume-inheritance' };
    }
    this._busy = false;
  }

  async _sync(siteId, mode) {
    this._busy = true;
    const { org, site, path } = this.details;
    const result = mode === 'merge'
      ? await mergeFromBase(org, site, siteId, path)
      : await createOverride(org, site, siteId, path);
    if (!result?.error) {
      this._setSatField(siteId, {
        outOfSync: false,
        ...(result.editUrl ? { editUrl: result.editUrl } : {}),
      });
      this._successData = { targets: [siteId], action: `sync-${mode}` };
    }
    this._busy = false;
  }

  async _pullFromBase(mode = 'override') {
    if (this._busy) return;
    this._busy = true;
    this._sourceError = null;
    const { org, site, path } = this.details;
    const baseSite = this._effectiveBase?.site || this._asSatellite?.base;
    const result = mode === 'merge'
      ? await mergeFromBase(org, baseSite, site, path)
      : await createOverride(org, baseSite, site, path);
    if (result?.error) {
      this._sourceError = result.error;
    } else {
      this._hasOverride = true;
      this._sourceOutOfSync = false;
      this._successData = { targets: [site], action: 'pull-from-base' };
    }
    this._busy = false;
  }

  // ── Confirm / scope chip helpers ──────────────────────────────────────────

  _openConfirm(siteId, type, message = null) {
    const full = type === 'rollout' ? this._inheritedInSubtree(siteId) : [];
    this._fullConfirmScope = full;
    this._confirmScope = [...full];
    this._pendingConfirm = { siteId, type, message };
    this._closeMenu();
  }

  async _openRolloutAllConfirm() {
    const allSiteIds = [];
    const collect = (nodes) => nodes.forEach((n) => {
      allSiteIds.push(n.siteId);
      if (n.children?.length) collect(n.children);
    });
    collect(this._tree);

    const unloaded = allSiteIds.filter((id) => this._satData.get(id)?.hasOverride === undefined);
    if (unloaded.length) {
      this._busy = true;
      await this._loadNodes(unloaded);
      this._busy = false;
    }

    const allInherited = [];
    this._tree.forEach((n) => allInherited.push(...this._inheritedInSubtree(n.siteId)));
    const full = [...new Set(allInherited)];
    this._fullConfirmScope = full;
    this._confirmScope = [...full];
    this._pendingConfirm = { siteId: '__all__', type: 'rollout' };
  }

  _toggleScope(id) {
    const isOn = this._confirmScope.includes(id);
    const fullSet = new Set(this._fullConfirmScope);
    if (isOn) {
      const remove = new Set(this._subtree(id).filter((x) => fullSet.has(x)));
      this._confirmScope = this._confirmScope.filter((x) => !remove.has(x));
    } else {
      const toAdd = new Set(this._subtree(id).filter((x) => fullSet.has(x)));
      // Also enable all ancestors in the full scope
      let parentId = this._parentOf(id);
      while (parentId) {
        if (fullSet.has(parentId)) toAdd.add(parentId);
        parentId = this._parentOf(parentId);
      }
      this._confirmScope = [...new Set([...this._confirmScope, ...toAdd])];
    }
  }

  _dismissConfirm() {
    this._pendingConfirm = null;
    this._fullConfirmScope = [];
    this._confirmScope = [];
  }

  // ── Overflow menu ─────────────────────────────────────────────────────────

  _openMenu(siteId, anchor) {
    if (this._menuSiteId === siteId) { this._closeMenu(); return; }
    const rect = anchor.getBoundingClientRect();
    this._menuPos = { top: rect.bottom + 4, right: window.innerWidth - rect.right };
    this._menuSiteId = siteId;
    const handler = () => this._closeMenu();
    setTimeout(() => document.addEventListener('click', handler, { once: true }), 0);
  }

  _closeMenu() {
    this._menuSiteId = null;
    this._menuPos = null;
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  _renderIcon1(siteId) {
    const d = this._satData.get(siteId);
    if (!d || d.hasOverride === undefined) return nothing;
    if (!d.hasOverride) {
      return html`<span class="row-icon" style="color:var(--s2-green-700,#0ba45d)" title="Following base — no local copy">${icon('icon-doc-check')}</span>`;
    }
    if (d.outOfSync) {
      return html`<span class="row-icon" style="color:var(--s2-red-700,#ff513d)" title="Local copy — source has changed, sync needed">${icon('icon-doc-alert')}</span>`;
    }
    return html`<span class="row-icon" style="color:var(--s2-orange-600,#fc7d00)" title="Local copy — in sync with source">${icon('icon-doc-x')}</span>`;
  }

  _renderIcon2(siteId) {
    const d = this._satData.get(siteId);
    if (!d || d.previewState === undefined) {
      return html`<span class="row-icon row-icon-loading"></span>`;
    }
    const key = getStatusKey(d);
    const cfg = ICON2_CONFIG[key] || ICON2_CONFIG['not-rolled-out'];
    return html`<span class="row-icon" style="color:${cfg.color}" title=${cfg.tip}>${icon(cfg.name)}</span>`;
  }

  renderStatusIcons(siteId) {
    return html`<div class="row-icons">${this._renderIcon1(siteId)}${this._renderIcon2(siteId)}</div>`;
  }

  renderSiteRow(node, depth = 0) {
    const { siteId, label, children } = node;
    const d = this._satData.get(siteId) || {};
    const hasKids = (children?.length || 0) > 0;
    const isCollapsed = this._collapsed.has(siteId);
    const showConfirm = this._pendingConfirm?.siteId === siteId;

    const onToggle = hasKids
      ? (e) => {
        e.stopPropagation();
        const next = new Set(this._collapsed);
        if (isCollapsed) {
          next.delete(siteId);
          const unloaded = (children || [])
            .filter((c) => this._satData.get(c.siteId)?.hasOverride === undefined)
            .map((c) => c.siteId);
          if (unloaded.length) this._loadNodes(unloaded);
        } else {
          next.add(siteId);
        }
        this._collapsed = next;
      }
      : null;

    let actionBtn = nothing;
    if (depth === 0 && d.hasOverride === false) {
      actionBtn = html`<button class="btn-row" ?disabled=${this._busy}
        @click=${(e) => { e.stopPropagation(); this._openConfirm(siteId, 'rollout'); }}>Roll out</button>`;
    } else if (depth === 0 && d.hasOverride === true) {
      actionBtn = html`<button class="btn-row ${d.outOfSync ? 'urgent' : ''}" ?disabled=${this._busy}
        @click=${(e) => { e.stopPropagation(); this._openConfirm(siteId, 'sync'); }}>Sync</button>`;
    }

    // eslint-disable-next-line no-nested-ternary
    const toggleClass = !hasKids ? 'leaf' : isCollapsed ? 'closed' : 'open';

    return html`
      <div class="sat-row" style="padding-left:${14 + depth * 22}px"
        @click=${onToggle || nothing}>
        <button class="row-toggle ${toggleClass}" tabindex="-1" aria-hidden="true">
          ${hasKids ? icon('icon-chevron-down', '0 0 10 10', 10, 10) : nothing}
        </button>
        <div class="row-name-group">
          <span class="row-name">${label}</span>
          ${hasKids && isCollapsed ? html`<span class="region-count">${children.length}</span>` : nothing}
        </div>
        ${this.renderStatusIcons(siteId)}
        ${actionBtn}
        <button class="btn-more" title="More actions"
          @click=${(e) => { e.stopPropagation(); this._openMenu(siteId, e.currentTarget); }}>
          ${icon('icon-more', '0 0 14 4', 14, 4)}
        </button>
      </div>
      ${showConfirm ? this.renderConfirmRow() : nothing}
      ${hasKids && !isCollapsed ? children.map((child) => this.renderSiteRow(child, depth + 1)) : nothing}`;
  }

  renderConfirmRow() {
    const c = this._pendingConfirm;
    if (!c) return nothing;
    const isDestructive = ['sync', 'sync-source', 'cancel-inheritance', 'resume-inheritance'].includes(c.type);

    let scopeChips = nothing;
    if (c.type === 'rollout' && this._fullConfirmScope.length > 0) {
      scopeChips = html`
        <div class="confirm-scope">
          ${this._fullConfirmScope.map((id) => {
    const label = this._satData.get(id)?.label || id;
    const isOn = this._confirmScope.includes(id);
    return html`<span class="scope-chip ${isOn ? '' : 'off'}"
            @click=${() => this._toggleScope(id)}>
            ${label}
          </span>`;
  })}
          <span class="confirm-hint">Click to include/exclude</span>
        </div>`;
    }

    let actions;
    if (c.type === 'rollout') {
      const targets = [...this._confirmScope];
      const noTargets = targets.length === 0;
      actions = html`
        <button class="btn btn-primary" ?disabled=${noTargets} @click=${() => { this._dismissConfirm(); this._rollout(targets, 'live'); }}>Roll out to live</button>
        <button class="btn btn-secondary" ?disabled=${noTargets} @click=${() => { this._dismissConfirm(); this._rollout(targets, 'preview'); }}>Roll out to preview</button>
        <button class="btn btn-secondary" @click=${() => this._dismissConfirm()}>Cancel</button>`;
    } else if (c.type === 'sync') {
      actions = html`
        <button class="btn btn-secondary" @click=${() => { this._dismissConfirm(); this._sync(c.siteId, 'merge'); }}>Merge</button>
        <button class="btn btn-danger" @click=${() => { this._dismissConfirm(); this._sync(c.siteId, 'override'); }}>Override</button>
        <button class="btn btn-secondary" @click=${() => this._dismissConfirm()}>Cancel</button>`;
    } else if (c.type === 'sync-source') {
      actions = html`
        <button class="btn btn-secondary" @click=${() => { this._dismissConfirm(); this._pullFromBase('merge'); }}>Merge</button>
        <button class="btn btn-danger" @click=${() => { this._dismissConfirm(); this._pullFromBase('override'); }}>Override</button>
        <button class="btn btn-secondary" @click=${() => this._dismissConfirm()}>Cancel</button>`;
    } else if (c.type === 'cancel-inheritance') {
      actions = html`
        <button class="btn btn-danger" @click=${() => { this._dismissConfirm(); this._cancelInheritance(c.siteId); }}>Create local copy</button>
        <button class="btn btn-secondary" @click=${() => this._dismissConfirm()}>Cancel</button>`;
    } else if (c.type === 'resume-inheritance') {
      actions = html`
        <button class="btn btn-danger" @click=${() => { this._dismissConfirm(); this._resumeInheritance(c.siteId); }}>Remove local copy</button>
        <button class="btn btn-secondary" @click=${() => this._dismissConfirm()}>Cancel</button>`;
    }

    return html`
      <div class="confirm-row ${isDestructive ? 'destructive' : ''}">
        ${c.message ? html`<div class="confirm-msg">${c.message}</div>` : nothing}
        ${scopeChips}
        <div class="confirm-actions">${actions}</div>
      </div>`;
  }

  renderOverflowMenu() {
    if (!this._menuSiteId || !this._menuPos) return nothing;
    const siteId = this._menuSiteId;
    const { top, right } = this._menuPos;
    const { org } = this.details;
    const manageApp = { label: 'Manage in MSM app ↗', action: () => { window.open(this._getAppDeepLink(), '_blank', 'noopener'); this._closeMenu(); } };

    let items;
    if (siteId === '__source__') {
      const { path } = this.details;
      const effectiveSite = this._effectiveBase?.site || this._asSatellite?.base;
      const pageUrl = `https://da.live/edit#/${org}/${effectiveSite}${path}`;
      items = [
        ...(this._hasOverride ? [{
          label: 'Resume inheritance',
          danger: true,
          action: () => {
            const base = this._asSatellite?.baseLabel || this._asSatellite?.base || 'source';
            this._openConfirm(this.details.site, 'resume-inheritance', `Remove your local copy? This page will serve ${base}'s content again. This cannot be undone.`);
          },
        }, { sep: true }] : []),
        { label: 'Open source page ↗', action: () => { window.open(pageUrl, '_blank', 'noopener'); this._closeMenu(); } },
        { sep: true },
        manageApp,
      ];
    } else {
      const d = this._satData.get(siteId) || {};
      const pageUrl = `https://da.live/edit#/${org}/${siteId}${this.details.path}`;
      const openPage = { label: 'Open page ↗', action: () => { window.open(pageUrl, '_blank', 'noopener'); this._closeMenu(); } };

      items = d.hasOverride === false
        ? [
          {
            label: 'Cancel inheritance',
            danger: true,
            action: () => this._openConfirm(siteId, 'cancel-inheritance', `Create a local copy for ${d.label || siteId}? It will need to be independently previewed and published.`),
          },
          { sep: true },
          manageApp,
        ]
        : [
          {
            label: 'Resume inheritance',
            danger: true,
            action: () => this._openConfirm(siteId, 'resume-inheritance', `Remove ${d.label || siteId}'s local copy? This page will serve source content again. This cannot be undone.`),
          },
          { sep: true },
          openPage,
          manageApp,
        ];
    }

    return html`
      <div class="overflow-menu" style="top:${top}px;right:${right}px">
        ${items.map((item) => (item.sep
    ? html`<div class="overflow-sep"></div>`
    : html`<button class="overflow-item ${item.danger ? 'danger' : ''}" @click=${item.action}>${item.label}</button>`))}
      </div>`;
  }

  renderSuccessBanner() {
    if (!this._successData) return nothing;
    const { targets, action, level } = this._successData;
    let title = 'Done';
    if (action === 'rollout') {
      title = `${level === 'live' ? 'Live' : 'Preview'} updated for ${targets.length} site${targets.length === 1 ? '' : 's'}`;
    } else if (action === 'cancel-inheritance') {
      title = `Local copy created for ${this._satData.get(targets[0])?.label || targets[0]}`;
    } else if (action === 'resume-inheritance') {
      const label = this._satData.get(targets[0])?.label;
      title = label ? `Local copy removed — ${label} now follows base` : 'Local copy removed — now follows base';
    } else if (action === 'sync-merge') {
      title = `${this._satData.get(targets[0])?.label || targets[0]} merged from source`;
    } else if (action === 'sync-override') {
      title = `${this._satData.get(targets[0])?.label || targets[0]} overwritten from source`;
    } else if (action === 'pull-from-base') {
      title = 'Page updated from base';
    }

    const { org, path } = this.details;
    const pagePath = path.replace('.html', '');

    const successLink = (id) => {
      if (action === 'resume-inheritance') return nothing;
      const label = this._satData.get(id)?.label || id;
      const url = action === 'rollout'
        ? `https://main--${id}--${org}.${level === 'live' ? 'aem.live' : 'aem.page'}${pagePath}`
        : `https://da.live/edit#/${org}/${id}${path}`;
      return html`<button class="success-link-btn"
        @click=${() => window.open(url, '_blank', 'noopener')}>
        Open ${label} ↗
      </button>`;
    };

    return html`
      <div class="success-banner">
        <div class="success-title">${icon('icon-circle-check')}${title}</div>
        <div class="success-links">
          ${targets.map((id) => successLink(id))}
          <button class="success-dismiss" @click=${() => { this._successData = null; }}>Dismiss</button>
        </div>
      </div>`;
  }

  renderSourceSection() {
    if (!this._asSatellite) return nothing;
    const parentLabel = this._asSatellite.baseLabel || this._asSatellite.base;
    const sourceLabel = this._effectiveBase?.label || parentLabel;
    let icon1;
    if (!this._hasOverride) {
      icon1 = html`<span class="row-icon" style="color:var(--s2-green-700,#0ba45d)" title="Following base — no local copy">${icon('icon-doc-check')}</span>`;
    } else if (this._sourceOutOfSync) {
      icon1 = html`<span class="row-icon" style="color:var(--s2-red-700,#ff513d)" title="Local copy — source has changed, sync needed">${icon('icon-doc-alert')}</span>`;
    } else {
      icon1 = html`<span class="row-icon" style="color:var(--s2-orange-600,#fc7d00)" title="Local copy — in sync with source">${icon('icon-doc-x')}</span>`;
    }

    let icon2;
    if (!this._sitePageStatus) {
      icon2 = html`<span class="row-icon row-icon-loading"></span>`;
    } else {
      const key = getStatusKey(this._sitePageStatus);
      const cfg = ICON2_CONFIG[key] || ICON2_CONFIG['not-rolled-out'];
      icon2 = html`<span class="row-icon" style="color:${cfg.color}" title=${cfg.tip}>${icon(cfg.name)}</span>`;
    }

    const viaNote = this._effectiveBase
      ? html`<div class="source-note">via ${parentLabel}</div>`
      : nothing;

    const errorNote = this._sourceError
      ? html`<div class="source-note source-note-error">${this._sourceError}</div>`
      : nothing;

    return html`
      <div class="plugin-section">
        <div class="section-header">
          <span class="section-label">Source</span>
        </div>
        <div class="sat-list">
          <div class="sat-row" style="padding-left:14px">
            <span class="row-toggle leaf"></span>
            <div class="row-name-group">
              <span class="row-name">${sourceLabel}</span>
            </div>
            <div class="row-icons">${icon1}${icon2}</div>
            <div class="source-actions">
              ${this._hasOverride
    ? html`<button class="btn-row" ?disabled=${this._busy}
                  @click=${(e) => { e.stopPropagation(); this._openConfirm('__source__', 'sync-source'); }}>
                  Sync
                </button>`
    : html`<button class="btn-row" ?disabled=${this._busy}
                  @click=${() => this._pullFromBase()}>
                  Get from base
                </button>`}
            </div>
            <button class="btn-more" title="More actions"
              @click=${(e) => { e.stopPropagation(); this._openMenu('__source__', e.currentTarget); }}>
              ${icon('icon-more', '0 0 14 4', 14, 4)}
            </button>
          </div>
          ${this._pendingConfirm?.siteId === '__source__' ? this.renderConfirmRow() : nothing}
          ${viaNote}
          ${errorNote}
        </div>
      </div>`;
  }

  renderSatellitesSection() {
    if (!this._asBase || !this._tree.length) return nothing;
    const hasInherited = this._tree.some((n) => this._satData.get(n.siteId)?.hasOverride === false);

    return html`
      <div class="plugin-section">
        <div class="section-header">
          <span class="section-label">Satellites</span>
          ${hasInherited ? html`
            <button class="btn-rollout-all" ?disabled=${this._busy}
              @click=${() => this._openRolloutAllConfirm()}>Roll out all</button>` : nothing}
        </div>
        ${this._pendingConfirm?.siteId === '__all__' ? this.renderConfirmRow() : nothing}
        <div class="sat-list">
          ${this._tree.map((node) => this.renderSiteRow(node, 0))}
        </div>
      </div>`;
  }

  render() {
    if (this._loading) {
      return html`<p class="loading">${this._loading}</p>`;
    }

    if (!this._asBase && !this._asSatellite) {
      return html`<p class="no-satellites">No satellite sites configured.</p>`;
    }

    const { org, site, path } = this.details;

    return html`
      <div class="plugin-meta">${org}/${site} · ${path}</div>
      <hr class="plugin-hr">
      ${this._busy
    ? html`<div class="busy-banner"><span class="busy-spinner"></span>Working…</div>`
    : this.renderSuccessBanner()}
      ${this.renderSourceSection()}
      ${this.renderSatellitesSection()}
      ${this.renderOverflowMenu()}
      <div class="plugin-footer">
        <a class="app-link" href=${this._getAppDeepLink()} target="_blank" rel="noopener">
          Manage in MSM app ↗
        </a>
      </div>`;
  }
}

customElements.define('da-msm', DaMsm);

export default function render(details) {
  const cmp = document.createElement('da-msm');
  cmp.details = details;
  return cmp;
}

(async function initAsDialog() {
  if (typeof window === 'undefined' || !document.body) return;

  try {
    const { context, actions } = await DA_SDK;
    const { org, path, ref } = context;
    const site = context.site || context.repo;
    console.log('[MSM Plugin] Init context:', {
      org, site, path, ref,
    });

    setConfigSdkFetch(actions.daFetch);
    setUtilsSdkFetch(actions.daFetch);

    if (document.referrer) {
      try {
        setEditUrlOrigin(new URL(document.referrer).origin);
      } catch {
        /* keep default */
      }
    }

    const cmp = document.createElement('da-msm');
    cmp.details = {
      org, site, path, ref,
    };
    document.body.append(cmp);
  } catch (error) {
    console.error('[MSM Plugin] Initialization error:', error);
    const pre = document.createElement('pre');
    pre.style.cssText = 'padding:12px;color:#d31510;font-family:monospace;font-size:12px;';
    pre.textContent = `Failed to initialise MSM plugin: ${error.message}`;
    document.body.append(pre);
  }
}());
