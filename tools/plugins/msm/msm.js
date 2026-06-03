/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console */
/* eslint-disable class-methods-use-this */
import { LitElement, html, nothing } from 'da-lit';
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import {
  getSiteConfig,
  getLinkedTree,
  getPageTimestamp,
  setSdkFetch as setConfigSdkFetch,
} from './config.js';
import {
  previewPage,
  publishPage,
  copyFromSource,
  deleteCopy,
  mergeFromSource,
  getPageStatus,
  getStatusConfig,
  setSdkFetch as setUtilsSdkFetch,
  setEditUrlOrigin,
} from './utils.js';
import { icon } from '../../apps/msm/core/icons.js';

const MSM_APP_URL = 'https://da.live/app/aemsites/da-blog-tools/tools/apps/msm/msm';
const NX = 'https://da.live/nx';

// Publishing a page bumps its lastModified date after the publish timestamp is
// recorded, producing a spurious "behind source" signal. This tolerance absorbs that lag.
const PUBLISH_LAG_MS = 5000;

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

class DaMsm extends LitElement {
  static properties = {
    details: { attribute: false },
    _loading: { state: true },
    _busy: { state: true },
    _asSource: { state: true },
    _asLinked: { state: true },
    _isDetached: { state: true },
    _tree: { state: true },
    _linkedData: { state: true },
    _collapsed: { state: true },
    _pendingConfirm: { state: true },
    _fullConfirmScope: { state: true },
    _confirmScope: { state: true },
    _successData: { state: true },
    _menuSiteId: { state: true },
    _menuPos: { state: true },
    _effectiveSource: { state: true },
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
    this._linkedData = new Map();
    this._collapsed = new Set();
    this._pendingConfirm = null;
    this._fullConfirmScope = [];
    this._confirmScope = [];
    this._successData = null;
    this._menuSiteId = null;
    this._menuPos = null;
    this._sourceLastModified = null;
    this._effectiveSource = null;
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
      getLinkedTree(org, site),
    ]);

    if (!config) {
      this._loading = undefined;
      return;
    }

    this._asSource = config.asSource;
    this._asLinked = config.asLinked;
    this._tree = tree;

    // Seed linkedData with labels so tree renders names immediately
    const initial = new Map();
    const seed = (nodes) => nodes.forEach(({ siteId, label, children }) => {
      initial.set(siteId, { label });
      if (children?.length) seed(children);
    });
    seed(tree);
    this._linkedData = initial;

    // Auto-collapse mid-tier nodes (those with children)
    const collapsed = new Set();
    const markCollapsed = (nodes) => nodes.forEach(({ siteId, children }) => {
      if (children?.length) { collapsed.add(siteId); markCollapsed(children); }
    });
    markCollapsed(tree);
    this._collapsed = collapsed;

    // Load upward detached status; resolve effective source if direct parent has no copy
    if (this._asLinked) {
      const sourceSite = this._asLinked.source;
      const [siteTs, sourceTs] = await Promise.all([
        getPageTimestamp(org, site, path),
        getPageTimestamp(org, sourceSite, path),
      ]);
      this._isDetached = siteTs.exists;

      let effectiveTs = sourceTs;
      if (!sourceTs.exists) {
        const chain = this._asLinked.chain || [];
        const ancestors = chain.slice(0, chain.length - 1);
        if (ancestors.length > 0) {
          const checks = await Promise.all(
            ancestors.map((a) => getPageTimestamp(org, a.site, path)
              .then((ts) => ({ ...a, hasContent: ts.exists, lastModified: ts.lastModified }))),
          );
          const nearest = [...checks].reverse().find((a) => a.hasContent);
          const resolved = nearest || checks[0];
          this._effectiveSource = resolved;
          effectiveTs = resolved
            ? { exists: resolved.hasContent, lastModified: resolved.lastModified }
            : null;
        }
      }

      if (siteTs.exists && siteTs.lastModified && effectiveTs?.lastModified) {
        this._sourceOutOfSync = new Date(effectiveTs.lastModified) > new Date(siteTs.lastModified);
      }

      // Load publish status for this site's page (for the source row's status icon)
      getPageStatus(org, site, path, siteTs.lastModified).then((status) => {
        this._sitePageStatus = status;
      });
    }

    this._loading = undefined;

    // Top-level nodes load eagerly; deeper nodes load lazily when their parent is expanded
    if (this._asSource) {
      const sourceSiteTs = await getPageTimestamp(org, site, path);
      this._sourceLastModified = sourceSiteTs.lastModified;
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

  _linkedInSubtree(rootSiteId) {
    const find = (nodes) => nodes.reduce((acc, n) => {
      if (acc) return acc;
      if (n.siteId === rootSiteId) return n;
      return find(n.children || []);
    }, null);
    const node = find(this._tree);
    if (!node) return this._linkedData.get(rootSiteId)?.isDetached === false ? [rootSiteId] : [];
    const ids = [];
    const collect = (n) => {
      if (this._linkedData.get(n.siteId)?.isDetached !== false) return;
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

  _effectiveSourceLM(siteId) {
    const ancestors = this._ancestorChain(siteId);
    const nearest = ancestors.find((id) => this._linkedData.get(id)?.isDetached === true);
    return nearest
      ? (this._linkedData.get(nearest)?.lastModified || null)
      : this._sourceLastModified;
  }

  async _loadNodes(siteIds) {
    const { org, path } = this.details;
    const timestamps = await Promise.all(
      siteIds.map((id) => getPageTimestamp(org, id, path).then((ts) => ({ id, ...ts }))),
    );

    const update = new Map(this._linkedData);
    timestamps.forEach(({ id, exists, lastModified }) => {
      const siteTime = lastModified ? new Date(lastModified).getTime() : null;
      let outOfSync = false;
      if (exists) {
        const refLM = this._effectiveSourceLM(id);
        const refTime = refLM ? new Date(refLM).getTime() : null;
        outOfSync = refTime !== null && siteTime !== null && siteTime + PUBLISH_LAG_MS < refTime;
      }
      update.set(id, {
        ...update.get(id), isDetached: exists, outOfSync, lastModified,
      });
    });
    this._linkedData = update;

    siteIds.forEach((id) => {
      const d = this._linkedData.get(id);
      const editLM = d?.isDetached ? d.lastModified : this._effectiveSourceLM(id);
      getPageStatus(org, id, path, editLM).then((status) => {
        const m = new Map(this._linkedData);
        m.set(id, { ...m.get(id), ...status });
        this._linkedData = m;
      });
    });
  }

  // ── Action execution ──────────────────────────────────────────────────────

  _setLinkedField(siteId, fields) {
    const next = new Map(this._linkedData);
    next.set(siteId, { ...next.get(siteId), ...fields });
    this._linkedData = next;
  }

  async _publish(siteIds, level) {
    this._busy = true;
    const { org, path } = this.details;

    siteIds.forEach((id) => this._setLinkedField(id, { actionStatus: 'pending' }));
    const results = await Promise.allSettled(siteIds.map(async (id) => {
      const previewResult = await previewPage(org, id, path);
      if (previewResult?.error) return previewResult;
      if (level === 'live') return publishPage(org, id, path);
      return previewResult;
    }));

    const succeeded = [];
    results.forEach((r, idx) => {
      const ok = r.status === 'fulfilled' && !r.value?.error;
      this._setLinkedField(siteIds[idx], { actionStatus: ok ? 'success' : 'error' });
      if (ok) succeeded.push(siteIds[idx]);
    });

    if (succeeded.length) {
      succeeded.forEach((id) => {
        this._setLinkedField(id, {
          previewState: 'current',
          ...(level === 'live' ? { liveState: 'current' } : {}),
        });
      });
      this._successData = { targets: succeeded, action: 'publish', level };
    }
    this._busy = false;
  }

  async _detach(siteId) {
    this._busy = true;
    const { org, site, path } = this.details;
    const result = await copyFromSource(org, site, siteId, path);
    if (!result.error) {
      this._setLinkedField(siteId, { isDetached: true, outOfSync: false });
      this._successData = { targets: [siteId], action: 'detach' };
    }
    this._busy = false;
  }

  async _reconnect(siteId) {
    if (this._busy) return;
    this._busy = true;
    const { org, path } = this.details;
    const pageStatus = await getPageStatus(org, siteId, path);
    const result = await deleteCopy(org, siteId, path);
    if (!result?.error) {
      if (pageStatus.liveState !== 'not-published') {
        await previewPage(org, siteId, path);
        await publishPage(org, siteId, path);
      } else if (pageStatus.previewState !== 'not-published') {
        await previewPage(org, siteId, path);
      }
      if (siteId === this.details.site) {
        this._isDetached = false;
      } else {
        this._setLinkedField(siteId, { isDetached: false, outOfSync: false });
      }
      this._successData = { targets: [siteId], action: 'reconnect' };
    }
    this._busy = false;
  }

  async _sync(siteId, mode) {
    this._busy = true;
    const { org, site, path } = this.details;
    const result = mode === 'merge'
      ? await mergeFromSource(org, site, siteId, path)
      : await copyFromSource(org, site, siteId, path);
    if (!result?.error) {
      this._setLinkedField(siteId, {
        outOfSync: false,
        ...(result.editUrl ? { editUrl: result.editUrl } : {}),
      });
      this._successData = { targets: [siteId], action: `sync-${mode}` };
    }
    this._busy = false;
  }

  async _pullFromSource(mode = 'replace') {
    if (this._busy) return;
    this._busy = true;
    this._sourceError = null;
    const { org, site, path } = this.details;
    const sourceSite = this._effectiveSource?.site || this._asLinked?.source;
    const result = mode === 'merge'
      ? await mergeFromSource(org, sourceSite, site, path)
      : await copyFromSource(org, sourceSite, site, path);
    if (result?.error) {
      this._sourceError = result.error;
    } else {
      this._isDetached = true;
      this._sourceOutOfSync = false;
      this._successData = { targets: [site], action: 'pull-from-source' };
    }
    this._busy = false;
  }

  // ── Confirm / scope chip helpers ──────────────────────────────────────────

  _openConfirm(siteId, type, message = null) {
    const full = type === 'publish' ? this._linkedInSubtree(siteId) : [];
    this._fullConfirmScope = full;
    this._confirmScope = [...full];
    this._pendingConfirm = { siteId, type, message };
    this._closeMenu();
  }

  async _openPublishAllConfirm() {
    const allSiteIds = [];
    const collect = (nodes) => nodes.forEach((n) => {
      allSiteIds.push(n.siteId);
      if (n.children?.length) collect(n.children);
    });
    collect(this._tree);

    const unloaded = allSiteIds.filter((id) => this._linkedData.get(id)?.isDetached === undefined);
    if (unloaded.length) {
      this._busy = true;
      await this._loadNodes(unloaded);
      this._busy = false;
    }

    const allLinked = [];
    this._tree.forEach((n) => allLinked.push(...this._linkedInSubtree(n.siteId)));
    const full = [...new Set(allLinked)];
    this._fullConfirmScope = full;
    this._confirmScope = [...full];
    this._pendingConfirm = { siteId: '__all__', type: 'publish' };
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

  // Display label for a site id (the current site, or a linked site).
  _siteLabel(siteId) {
    if (siteId === this.details.site) return this._asSource?.sourceLabel || this.details.site;
    return this._linkedData.get(siteId)?.label || siteId;
  }

  // The source a linked site resolves to: nearest detached ancestor, else the
  // current (root) site — mirrors the app's effectiveSource.
  _effectiveSourceSite(siteId) {
    const nearest = this._ancestorChain(siteId)
      .find((id) => this._linkedData.get(id)?.isDetached === true);
    return nearest || this.details.site;
  }

  // Label of the upstream source this page links to (Source-section context).
  _upstreamLabel() {
    return this._effectiveSource?.label
      || this._asLinked?.sourceLabel || this._asLinked?.source || 'source';
  }

  // Confirm sentence (+ optional clarifier note), aligned with the MSM app's
  // locked phrasing. Publish names the source and defers the target list to the
  // scope chips; the copy actions name source/target inline.
  _confirmText() {
    const c = this._pendingConfirm;
    if (!c) return {};
    const { type, siteId } = c;
    if (type === 'publish') {
      return { message: `Publish this page from ${this._siteLabel(this.details.site)} to these linked sites:` };
    }
    // Source-section sync acts on this page's own link to its upstream source;
    // linked-row actions act on a linked site relative to its source.
    const sourceContext = type === 'sync-source';
    const target = sourceContext ? this._siteLabel(this.details.site) : this._siteLabel(siteId);
    const source = sourceContext
      ? this._upstreamLabel() : this._siteLabel(this._effectiveSourceSite(siteId));
    if (type === 'detach') {
      return {
        message: `Detach this page in ${target} from ${source}?`,
        note: 'Creates an independent copy, breaking the link to the source.',
      };
    }
    if (type === 'reconnect') {
      return {
        message: `Reconnect this page in ${target} to ${source}?`,
        note: 'Removes the independent copy and restores the link to the source.',
      };
    }
    if (type === 'sync' || type === 'sync-source') {
      return {
        message: `Sync this page in ${target} from ${source}?`,
        note: 'Merge keeps your edits; Replace overwrites them with the source.',
      };
    }
    return { message: c.message || null };
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

  // Gray icon: shows link state only — no urgency implied.
  _renderLinkIcon(siteId, parentLabel) {
    const d = this._linkedData.get(siteId);
    if (!d || d.isDetached === undefined) return nothing;
    if (!d.isDetached) {
      const tip = parentLabel ? `Linked to ${parentLabel}` : 'Linked to source';
      return html`<span class="row-icon row-icon-inherit" title="${tip}">${icon('S2_Icon_LinkApplied_20_N', '0 0 20 20')}</span>`;
    }
    return html`<span class="row-icon row-icon-inherit" title="Detached (independent copy)">${icon('S2_Icon_UnLink_20_N', '0 0 20 20')}</span>`;
  }

  // Color-coded: green=all good, amber=preview only, orange=behind-source+live, red=needs action.
  _renderStatusIcon(siteId) {
    const d = this._linkedData.get(siteId);
    if (!d || d.isDetached === undefined) return nothing;
    if (d.previewState === undefined) {
      return html`<span class="row-icon row-icon-loading"></span>`;
    }
    const cfg = getStatusConfig(d);
    return html`<span class="row-icon" style="color:${cfg.color}" title=${cfg.tip}>${icon(cfg.name, '0 0 18 18')}</span>`;
  }

  renderSiteRow(node, depth = 0, parentLabel = '') {
    const { siteId, label, children } = node;
    const d = this._linkedData.get(siteId) || {};
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
            .filter((c) => this._linkedData.get(c.siteId)?.isDetached === undefined)
            .map((c) => c.siteId);
          if (unloaded.length) this._loadNodes(unloaded);
        } else {
          next.add(siteId);
        }
        this._collapsed = next;
      }
      : null;

    let actionBtn = nothing;
    if (depth === 0 && d.isDetached === false) {
      actionBtn = html`<button class="btn-row" ?disabled=${this._busy}
        @click=${(e) => { e.stopPropagation(); this._openConfirm(siteId, 'publish'); }}>Publish</button>`;
    } else if (depth === 0 && d.isDetached === true) {
      actionBtn = html`<button class="btn-row" ?disabled=${this._busy}
        @click=${(e) => { e.stopPropagation(); this._openConfirm(siteId, 'sync'); }}>Sync</button>`;
    }

    // eslint-disable-next-line no-nested-ternary
    const toggleClass = !hasKids ? 'leaf' : isCollapsed ? 'closed' : 'open';

    return html`
      <div class="linked-row" style="padding-left:${14 + depth * 22}px"
        @click=${onToggle || nothing}>
        <button class="row-toggle ${toggleClass}" tabindex="-1" aria-hidden="true">
          ${hasKids ? icon('S2_Icon_ChevronDown_20_N', '0 0 20 20', 10, 10) : nothing}
        </button>
        ${this._renderLinkIcon(siteId, parentLabel)}
        <div class="row-name-group">
          <span class="row-name">${label}</span>
          ${hasKids && isCollapsed ? html`<span class="region-count">${children.length}</span>` : nothing}
        </div>
        ${this._renderStatusIcon(siteId)}
        ${actionBtn}
        <button class="btn-more" title="More actions"
          @click=${(e) => { e.stopPropagation(); this._openMenu(siteId, e.currentTarget); }}>
        </button>
      </div>
      ${showConfirm ? this.renderConfirmRow() : nothing}
      ${hasKids && !isCollapsed ? children.map((child) => this.renderSiteRow(child, depth + 1, label)) : nothing}`;
  }

  renderConfirmRow() {
    const c = this._pendingConfirm;
    if (!c) return nothing;
    const isDestructive = ['sync', 'sync-source', 'detach', 'reconnect'].includes(c.type);

    let scopeChips = nothing;
    if (c.type === 'publish' && this._fullConfirmScope.length > 0) {
      scopeChips = html`
        <div class="confirm-scope">
          ${this._fullConfirmScope.map((id) => {
    const label = this._linkedData.get(id)?.label || id;
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
    if (c.type === 'publish') {
      const targets = [...this._confirmScope];
      const noTargets = targets.length === 0;
      actions = html`
        <button class="btn btn-primary" ?disabled=${noTargets} @click=${() => { this._dismissConfirm(); this._publish(targets, 'live'); }}>Publish</button>
        <button class="btn btn-secondary" ?disabled=${noTargets} @click=${() => { this._dismissConfirm(); this._publish(targets, 'preview'); }}>Preview</button>
        <button class="btn btn-secondary" @click=${() => this._dismissConfirm()}>Cancel</button>`;
    } else if (c.type === 'sync') {
      actions = html`
        <button class="btn btn-secondary" @click=${() => { this._dismissConfirm(); this._sync(c.siteId, 'merge'); }}>Merge</button>
        <button class="btn btn-danger" @click=${() => { this._dismissConfirm(); this._sync(c.siteId, 'replace'); }}>Replace</button>
        <button class="btn btn-secondary" @click=${() => this._dismissConfirm()}>Cancel</button>`;
    } else if (c.type === 'sync-source') {
      actions = html`
        <button class="btn btn-secondary" @click=${() => { this._dismissConfirm(); this._pullFromSource('merge'); }}>Merge</button>
        <button class="btn btn-danger" @click=${() => { this._dismissConfirm(); this._pullFromSource('replace'); }}>Replace</button>
        <button class="btn btn-secondary" @click=${() => this._dismissConfirm()}>Cancel</button>`;
    } else if (c.type === 'detach') {
      actions = html`
        <button class="btn btn-danger" @click=${() => { this._dismissConfirm(); this._detach(c.siteId); }}>Detach</button>
        <button class="btn btn-secondary" @click=${() => this._dismissConfirm()}>Cancel</button>`;
    } else if (c.type === 'reconnect') {
      actions = html`
        <button class="btn btn-danger" @click=${() => { this._dismissConfirm(); this._reconnect(c.siteId); }}>Reconnect</button>
        <button class="btn btn-secondary" @click=${() => this._dismissConfirm()}>Cancel</button>`;
    }

    const { message, note } = this._confirmText();
    return html`
      <div class="confirm-row ${isDestructive ? 'destructive' : ''}">
        ${message ? html`<div class="confirm-text">
          <div class="confirm-msg">${message}</div>
          ${note ? html`<div class="confirm-note">${note}</div>` : nothing}
        </div>` : nothing}
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
      const effectiveSite = this._effectiveSource?.site || this._asLinked?.source;
      const pageUrl = `https://da.live/edit#/${org}/${effectiveSite}${path}`;
      // No Reconnect here: in the source context it would delete the current
      // page's own content (the page being edited). That destructive cleanup
      // lives in the MSM app, not the in-editor plugin.
      items = [
        { label: 'Open source page ↗', action: () => { window.open(pageUrl, '_blank', 'noopener'); this._closeMenu(); } },
        { sep: true },
        manageApp,
      ];
    } else {
      const d = this._linkedData.get(siteId) || {};
      const pageUrl = `https://da.live/edit#/${org}/${siteId}${this.details.path}`;
      const openPage = { label: 'Open page ↗', action: () => { window.open(pageUrl, '_blank', 'noopener'); this._closeMenu(); } };

      items = d.isDetached === false
        ? [
          {
            label: 'Detach',
            danger: true,
            action: () => this._openConfirm(siteId, 'detach'),
          },
          { sep: true },
          manageApp,
        ]
        : [
          {
            label: 'Reconnect',
            danger: true,
            action: () => this._openConfirm(siteId, 'reconnect'),
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
    if (action === 'publish') {
      title = `${level === 'live' ? 'Live' : 'Preview'} updated for ${targets.length} site${targets.length === 1 ? '' : 's'}`;
    } else if (action === 'detach') {
      title = `${this._linkedData.get(targets[0])?.label || targets[0]} detached`;
    } else if (action === 'reconnect') {
      const label = this._linkedData.get(targets[0])?.label;
      title = label ? `${label} reconnected to source` : 'Reconnected to source';
    } else if (action === 'sync-merge') {
      title = `${this._linkedData.get(targets[0])?.label || targets[0]} merged from source`;
    } else if (action === 'sync-replace') {
      title = `${this._linkedData.get(targets[0])?.label || targets[0]} replaced from source`;
    } else if (action === 'pull-from-source') {
      title = 'Page updated from source';
    }

    const { org, path } = this.details;
    const pagePath = path.replace('.html', '');

    const successLink = (id) => {
      if (action === 'reconnect') return nothing;
      const label = this._linkedData.get(id)?.label || id;
      const url = action === 'publish'
        ? `https://main--${id}--${org}.${level === 'live' ? 'aem.live' : 'aem.page'}${pagePath}`
        : `https://da.live/edit#/${org}/${id}${path}`;
      return html`<button class="success-link-btn"
        @click=${() => window.open(url, '_blank', 'noopener')}>
        Open ${label} ↗
      </button>`;
    };

    return html`
      <div class="success-banner">
        <div class="success-title">${icon('S2_Icon_CheckmarkCircle_20_N', '0 0 18 18')}${title}</div>
        <div class="success-links">
          ${targets.map((id) => successLink(id))}
          <button class="success-dismiss" @click=${() => { this._successData = null; }}>Dismiss</button>
        </div>
      </div>`;
  }

  renderSourceSection() {
    if (!this._asLinked) return nothing;
    const parentLabel = this._asLinked.sourceLabel || this._asLinked.source;
    const sourceLabel = this._effectiveSource?.label || parentLabel;
    const linkTip = this._isDetached
      ? 'Detached (independent copy)'
      : `Linked to ${sourceLabel}`;
    const linkIcon = this._isDetached === undefined ? nothing
      : html`<span class="row-icon row-icon-inherit" title=${linkTip}>
          ${icon(this._isDetached ? 'S2_Icon_UnLink_20_N' : 'S2_Icon_LinkApplied_20_N', '0 0 20 20')}
        </span>`;

    let statusIcon;
    if (!this._sitePageStatus) {
      statusIcon = html`<span class="row-icon row-icon-loading"></span>`;
    } else {
      const cfg = getStatusConfig({
        isDetached: this._isDetached,
        outOfSync: this._sourceOutOfSync,
        previewState: this._sitePageStatus.previewState,
        liveState: this._sitePageStatus.liveState,
      });
      statusIcon = html`<span class="row-icon" style="color:${cfg.color}" title=${cfg.tip}>${icon(cfg.name, '0 0 18 18')}</span>`;
    }

    const viaNote = this._effectiveSource
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
        <div class="linked-list">
          <div class="linked-row" style="padding-left:14px">
            <span class="row-toggle leaf"></span>
            ${linkIcon}
            <div class="row-name-group">
              <span class="row-name">${sourceLabel}</span>
            </div>
            ${statusIcon}
            <div class="source-actions">
              ${this._isDetached
    ? html`<button class="btn-row" ?disabled=${this._busy}
                  @click=${(e) => { e.stopPropagation(); this._openConfirm('__source__', 'sync-source'); }}>
                  Sync
                </button>`
    : html`<button class="btn-row" ?disabled=${this._busy}
                  @click=${() => this._pullFromSource()}>
                  Get from source
                </button>`}
            </div>
            <button class="btn-more" title="More actions"
              @click=${(e) => { e.stopPropagation(); this._openMenu('__source__', e.currentTarget); }}>
            </button>
          </div>
          ${this._pendingConfirm?.siteId === '__source__' ? this.renderConfirmRow() : nothing}
          ${viaNote}
          ${errorNote}
        </div>
      </div>`;
  }

  renderLinkedSection() {
    if (!this._asSource || !this._tree.length) return nothing;
    const hasLinked = this._tree.some((n) => this._linkedData.get(n.siteId)?.isDetached === false);

    return html`
      <div class="plugin-section">
        <div class="section-header">
          <span class="section-label">Linked sites</span>
          ${hasLinked ? html`
            <button class="btn-publish-all" ?disabled=${this._busy}
              @click=${() => this._openPublishAllConfirm()}>Publish all</button>` : nothing}
        </div>
        ${this._pendingConfirm?.siteId === '__all__' ? this.renderConfirmRow() : nothing}
        <div class="linked-list">
          ${this._tree.map((node) => this.renderSiteRow(node, 0, this._asSource?.sourceLabel))}
        </div>
      </div>`;
  }

  render() {
    if (this._loading) {
      return html`<p class="loading">${this._loading}</p>`;
    }

    if (!this._asSource && !this._asLinked) {
      return html`<p class="no-linked">No linked sites configured.</p>`;
    }

    const { org, site, path } = this.details;

    return html`
      <div class="plugin-meta">${org}/${site} · ${path}</div>
      <hr class="plugin-hr">
      ${this._busy
    ? html`<div class="busy-banner"><span class="busy-spinner"></span>Working…</div>`
    : this.renderSuccessBanner()}
      ${this.renderSourceSection()}
      ${this.renderLinkedSection()}
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
