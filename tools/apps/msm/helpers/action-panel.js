/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console, class-methods-use-this */
import { LitElement, html, nothing } from 'da-lit';
import {
  executeBulkAction,
  previewSatellite,
  publishSatellite,
  createOverride,
  deleteOverride,
  mergeFromBase,
  getSatellitePageStatus,
} from './api.js';

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

// ── Inline SVG icons ──────────────────────────────────────────────────────────

const icon = (path, viewBox = '0 0 14 14') => html`<svg width="14" height="14" viewBox="${viewBox}" fill="none" stroke="currentColor">${path}</svg>`;

const ICON_DOC_CHECK = icon(html`
  <path d="M2.5 1.5h6l3 3v8.5h-9V1.5z" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M8.5 1.5v3h3" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M4.5 7.5l1.8 1.8 3-3" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`);

const ICON_DOC_X = icon(html`
  <path d="M2.5 1.5h6l3 3v8.5h-9V1.5z" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M8.5 1.5v3h3" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M5 6.8l4 4M9 6.8l-4 4" stroke-width="1.6" stroke-linecap="round"/>`);

const ICON_DOC_ALERT = icon(html`
  <path d="M2.5 1.5h6l3 3v8.5h-9V1.5z" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M8.5 1.5v3h3" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M7 6.5v3" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="7" cy="11.4" r="0.85" fill="currentColor" stroke="none"/>`);

const ICON_CIRCLE_CHECK = icon(html`
  <circle cx="7" cy="7" r="5.5" stroke-width="1.5"/>
  <path d="M4.5 7l2 2 3.5-3.5" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`);

const ICON_CIRCLE_ALERT = icon(html`
  <circle cx="7" cy="7" r="5.5" stroke-width="1.5"/>
  <path d="M7 4v3.5" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="7" cy="9.8" r="0.85" fill="currentColor" stroke="none"/>`);

const ICON_TRI_ALERT = icon(html`
  <path d="M7 1.5L12.5 11.5H1.5L7 1.5z" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M7 5.5v3" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="7" cy="10" r="0.9" fill="currentColor" stroke="none"/>`);

const ICON_CHEVRON = icon(html`<path d="M2 3.5l3 3 3-3" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`, '0 0 10 10');

const ICON_MORE = html`<svg width="14" height="4" viewBox="0 0 14 4" fill="currentColor">
  <circle cx="2" cy="2" r="1.5"/><circle cx="7" cy="2" r="1.5"/><circle cx="12" cy="2" r="1.5"/>
</svg>`;

const ICON_OPEN = html`<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
  <path d="M5 2H2v8h8V7" stroke-linecap="round"/>
  <path d="M7 2h3v3M10 2L6 6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// ── Result status icons ───────────────────────────────────────────────────────

const QUEUED_ICON = html`<svg class="result-icon queued" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" opacity="0.4"><circle cx="8" cy="8" r="6"/></svg>`;
const SPINNER_ICON = html`<svg class="result-icon pending" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 1a7 7 0 1 0 7 7" stroke-linecap="round"/></svg>`;
const SUCCESS_ICON = html`<svg class="result-icon success" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,8 7,12 13,4"/></svg>`;
const ERROR_ICON = html`<svg class="result-icon error" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>`;

// ── Publish-state config ──────────────────────────────────────────────────────

const ICON2_MAP = {
  'not-rolled-out': { icon: ICON_CIRCLE_ALERT, color: 'var(--s2-red-700,#ff513d)', tip: 'Not yet previewed or published' },
  'preview-current': { icon: ICON_TRI_ALERT, color: 'var(--s2-orange-600,#fc7d00)', tip: 'Previewed — not yet published to live' },
  'preview-behind': { icon: ICON_CIRCLE_ALERT, color: 'var(--s2-red-700,#ff513d)', tip: 'Preview is out of date' },
  'preview-current-live-behind': { icon: ICON_TRI_ALERT, color: 'var(--s2-orange-600,#fc7d00)', tip: 'Preview current — published content is out of date' },
  'live-current': { icon: ICON_CIRCLE_CHECK, color: 'var(--s2-green-700,#0ba45d)', tip: 'Preview and published are current' },
  'live-behind': { icon: ICON_CIRCLE_ALERT, color: 'var(--s2-red-700,#ff513d)', tip: 'WIP has changed — re-publish needed' },
};

function getStatusKey({ previewState, liveState }) {
  if (liveState === 'current') return 'live-current';
  if (liveState === 'behind') return previewState === 'current' ? 'preview-current-live-behind' : 'live-behind';
  if (previewState === 'current') return 'preview-current';
  if (previewState === 'behind') return 'preview-behind';
  return 'not-rolled-out';
}

function stripExt(filePath) {
  return filePath.replace(/\.[^/.]+$/, '');
}

function formatDate(iso) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

class MsmActionPanel extends LitElement {
  static properties = {
    org: { type: String },
    role: { type: String },
    site: { type: String },
    parentBase: { type: String },
    parentChain: { attribute: false },
    pages: { attribute: false },
    satellites: { attribute: false },
    overrides: { attribute: false },
    isSinglePage: { type: Boolean },
    hasDescendants: { type: Boolean },
    msmConfig: { attribute: false },
    _satData: { state: true },
    _collapsed: { state: true },
    _pendingConfirm: { state: true },
    _confirmScope: { state: true },
    _successData: { state: true },
    _executing: { state: true },
    _taskStatuses: { state: true },
    _busy: { state: true },
    _bulkAction: { state: true },
    _bulkSatFilter: { state: true },
    _bulkSyncMode: { state: true },
    _menuSiteId: { state: true },
    _menuPos: { state: true },
    _sourceError: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sl, sheet, buttons].filter(Boolean);
    this._satData = new Map();
    this._collapsed = new Set();
    this._pendingConfirm = null;
    this._confirmScope = [];
    this._successData = null;
    this._executing = false;
    this._taskStatuses = new Map();
    this._busy = false;
    this._bulkAction = null;
    this._bulkSatFilter = null;
    this._bulkSyncMode = 'merge';
    this._menuSiteId = null;
    this._menuPos = null;
    this._sourceError = null;
    this._handleOutsideClick = this._handleOutsideClick.bind(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._handleOutsideClick);
  }

  updated(changed) {
    if (changed.has('pages') || changed.has('satellites')) {
      this._satData = new Map();
      this._pendingConfirm = null;
      this._confirmScope = [];
      this._successData = null;
      this._executing = false;
      this._taskStatuses = new Map();
      this._busy = false;
      this._sourceError = null;

      // Auto-collapse sites that have descendants
      const initialCollapsed = new Set();
      Object.entries(this.satellites || {}).forEach(([siteId, info]) => {
        if ((info.descendants || []).length > 0) initialCollapsed.add(siteId);
      });
      this._collapsed = initialCollapsed;

      if (this.isSinglePage) this._loadSatStatus();
    }
    if (changed.has('satellites')) {
      this._bulkSatFilter = null;
      if (!this._bulkAction) this._bulkAction = this._defaultBulkAction();
    }
    if (changed.has('overrides') && this.isSinglePage) {
      this._syncOverridesToSatData();
    }
  }

  _defaultBulkAction() {
    if (this.role === 'satellite') return 'pull';
    return 'preview';
  }

  _syncOverridesToSatData() {
    if (!this.pages?.length) return;
    const page = this.pages[0];
    const pageOverrides = this.overrides?.get(page.path) || [];
    const next = new Map(this._satData);
    pageOverrides
      .filter((o) => o.site !== this.site)
      .forEach((o) => {
        next.set(o.site, { ...(next.get(o.site) || {}), hasOverride: o.hasOverride });
      });
    this._satData = next;
  }

  async _loadSatStatus() {
    if (!this.pages?.length || !this.org) return;
    const page = this.pages[0];
    const cleanPath = stripExt(page.path);
    const siteIds = this._collectSiteIds();
    siteIds.forEach(async (siteId) => {
      const status = await getSatellitePageStatus(this.org, siteId, cleanPath);
      const next = new Map(this._satData);
      next.set(siteId, { ...(next.get(siteId) || {}), ...status });
      this._satData = next;
    });
  }

  _collectSiteIds() {
    const ids = new Set();
    const walk = (siteId, descendants) => {
      ids.add(siteId);
      (descendants || []).forEach((d) => walk(d.site, d.children));
    };
    Object.entries(this.satellites || {}).forEach(([siteId, info]) => {
      walk(siteId, info.descendants || []);
    });
    return [...ids];
  }

  _hasOverrideForSite(siteId) {
    return this._satData.get(siteId)?.hasOverride;
  }

  _setSatData(siteId, fields) {
    const next = new Map(this._satData);
    next.set(siteId, { ...(next.get(siteId) || {}), ...fields });
    this._satData = next;
  }

  _setStatus(key, status, error) {
    const next = new Map(this._taskStatuses);
    next.set(key, { status, error });
    this._taskStatuses = next;
  }

  _emitActionComplete() {
    this.dispatchEvent(new CustomEvent('action-complete', { bubbles: true, composed: true }));
  }

  // ── Overflow menu ─────────────────────────────────────────────────────────

  _openMenu(siteId, anchor) {
    if (this._menuSiteId === siteId) { this._closeMenu(); return; }
    const rect = anchor.getBoundingClientRect();
    this._menuPos = { top: rect.bottom + 4, right: window.innerWidth - rect.right };
    this._menuSiteId = siteId;
    this._closeMenuHandler = () => this._closeMenu();
    setTimeout(() => document.addEventListener('click', this._closeMenuHandler, { once: true }), 0);
  }

  _closeMenu() {
    this._menuSiteId = null;
    this._menuPos = null;
  }

  _handleOutsideClick() {
    this._closeMenu();
  }

  // ── Confirm helpers ───────────────────────────────────────────────────────

  _subtreeIds(siteId) {
    const ids = [siteId];
    const sat = this.satellites?.[siteId];
    const walk = (descendants) => descendants.forEach((d) => {
      ids.push(d.site);
      walk(d.children || []);
    });
    if (sat) walk(sat.descendants || []);
    return ids;
  }

  _openRolloutConfirm(siteId) {
    const scope = this._subtreeIds(siteId);
    this._confirmScope = scope;
    this._pendingConfirm = { siteId, type: 'rollout' };
  }

  _openSyncConfirm(siteId) {
    this._confirmScope = [siteId];
    this._pendingConfirm = { siteId, type: 'sync' };
  }

  _openRolloutAllConfirm() {
    const allIds = [];
    Object.keys(this.satellites || {}).forEach((siteId) => {
      if (this._hasOverrideForSite(siteId) === false) {
        allIds.push(...this._subtreeIds(siteId));
      }
    });
    const unique = [...new Set(allIds)];
    this._confirmScope = unique;
    this._pendingConfirm = { siteId: '__all__', type: 'rollout' };
  }

  _toggleScope(id) {
    if (this._confirmScope.includes(id)) {
      const remove = new Set(this._subtreeIds(id));
      this._confirmScope = this._confirmScope.filter((x) => !remove.has(x));
    } else {
      const add = this._subtreeIds(id);
      this._confirmScope = [...new Set([...this._confirmScope, ...add])];
    }
  }

  _dismissConfirm() {
    this._pendingConfirm = null;
    this._confirmScope = [];
  }

  // ── Action execution ──────────────────────────────────────────────────────

  async _executeRollout(level) {
    if (this._busy) return;
    this._busy = true;
    this._pendingConfirm = null;
    this._successData = null;
    const page = this.pages[0];
    const cleanPath = stripExt(page.path);
    const targetIds = [...this._confirmScope];
    this._taskStatuses = new Map();

    const results = await Promise.allSettled(targetIds.map(async (siteId) => {
      this._setStatus(`${page.path}:${siteId}`, 'pending');
      const previewResult = await previewSatellite(this.org, siteId, cleanPath);
      if (previewResult?.error) {
        this._setStatus(`${page.path}:${siteId}`, 'error', previewResult.error);
        return { siteId, ok: false };
      }
      if (level === 'live') {
        const liveResult = await publishSatellite(this.org, siteId, cleanPath);
        if (liveResult?.error) {
          this._setStatus(`${page.path}:${siteId}`, 'error', liveResult.error);
          return { siteId, ok: false };
        }
      }
      this._setStatus(`${page.path}:${siteId}`, 'success');
      this._setSatData(siteId, {
        previewState: 'current',
        ...(level === 'live' ? { liveState: 'current' } : {}),
      });
      return { siteId, ok: true };
    }));

    const succeeded = results
      .filter((r) => r.status === 'fulfilled' && r.value?.ok)
      .map((r) => r.value.siteId);

    if (succeeded.length) {
      this._successData = { targets: succeeded, action: 'rollout', level };
    }
    this._executing = true;
    this._busy = false;
    this._emitActionComplete();
  }

  async _executeSync(siteId, mode) {
    if (this._busy) return;
    this._busy = true;
    this._pendingConfirm = null;
    this._executing = true;
    const page = this.pages[0];
    const cleanPath = stripExt(page.path);
    this._setStatus(`${page.path}:${siteId}`, 'pending');
    const result = mode === 'merge'
      ? await mergeFromBase(this.org, this.site, siteId, cleanPath)
      : await createOverride(this.org, this.site, siteId, cleanPath);
    if (result?.error) {
      this._setStatus(`${page.path}:${siteId}`, 'error', result.error);
    } else {
      this._setStatus(`${page.path}:${siteId}`, 'success');
      this._setSatData(siteId, { outOfSync: false });
      this._successData = { targets: [siteId], action: `sync-${mode}` };
    }
    this._busy = false;
    this._emitActionComplete();
  }

  async _executeCancelInheritance(siteId) {
    if (this._busy) return;
    this._busy = true;
    this._pendingConfirm = null;
    this._executing = true;
    const page = this.pages[0];
    const cleanPath = stripExt(page.path);
    this._setStatus(`${page.path}:${siteId}`, 'pending');
    const result = await createOverride(this.org, this.site, siteId, cleanPath);
    if (result?.error) {
      this._setStatus(`${page.path}:${siteId}`, 'error', result.error);
    } else {
      this._setStatus(`${page.path}:${siteId}`, 'success');
      this._setSatData(siteId, { hasOverride: true, outOfSync: false });
      this._successData = { targets: [siteId], action: 'cancel-inheritance' };
    }
    this._busy = false;
    this._emitActionComplete();
  }

  async _executeResumeInheritance(siteId) {
    if (this._busy) return;
    this._busy = true;
    this._pendingConfirm = null;
    this._executing = true;
    const page = this.pages[0];
    const cleanPath = stripExt(page.path);
    this._setStatus(`${page.path}:${siteId}`, 'pending');
    const pageStatus = await getSatellitePageStatus(this.org, siteId, cleanPath);
    const result = await deleteOverride(this.org, siteId, cleanPath);
    if (result?.error) {
      this._setStatus(`${page.path}:${siteId}`, 'error', result.error);
    } else {
      if (pageStatus.liveState !== 'not-rolled-out') {
        await previewSatellite(this.org, siteId, cleanPath);
        await publishSatellite(this.org, siteId, cleanPath);
      } else if (pageStatus.previewState !== 'not-rolled-out') {
        await previewSatellite(this.org, siteId, cleanPath);
      }
      this._setStatus(`${page.path}:${siteId}`, 'success');
      this._setSatData(siteId, { hasOverride: false, outOfSync: false });
      this._successData = { targets: [siteId], action: 'resume-inheritance' };
    }
    this._busy = false;
    this._emitActionComplete();
  }

  async _executePullFromBase(mode) {
    if (this._busy) return;
    this._busy = true;
    this._sourceError = null;
    this._executing = true;
    const page = this.pages[0];
    const cleanPath = stripExt(page.path);
    const baseSite = this.parentBase;
    const result = mode === 'merge'
      ? await mergeFromBase(this.org, baseSite, this.site, cleanPath)
      : await createOverride(this.org, baseSite, this.site, cleanPath);
    if (result?.error) {
      this._sourceError = result.error;
    } else {
      this._successData = { targets: [this.site], action: 'pull-from-base' };
    }
    this._busy = false;
    this._emitActionComplete();
  }

  async _executeRevertToBase() {
    if (this._busy) return;
    this._busy = true;
    this._executing = true;
    const page = this.pages[0];
    const cleanPath = stripExt(page.path);
    const pageStatus = await getSatellitePageStatus(this.org, this.site, cleanPath);
    const result = await deleteOverride(this.org, this.site, cleanPath);
    if (!result?.error) {
      if (pageStatus.liveState !== 'not-rolled-out') {
        await previewSatellite(this.org, this.site, cleanPath);
        await publishSatellite(this.org, this.site, cleanPath);
      } else if (pageStatus.previewState !== 'not-rolled-out') {
        await previewSatellite(this.org, this.site, cleanPath);
      }
      this._successData = { targets: [this.site], action: 'revert-to-base' };
    }
    this._busy = false;
    this._emitActionComplete();
  }

  async _executeBulk() {
    if (this._busy) return;
    this._busy = true;
    this._executing = true;
    this._taskStatuses = new Map();

    const action = this._bulkAction;
    const satFilter = this._bulkSatFilter;
    const satellites = Object.entries(this.satellites || {})
      .filter(([s]) => !satFilter || satFilter.has(s))
      .reduce((acc, [s, info]) => { acc[s] = info; return acc; }, {});

    const isUpward = action === 'pull' || action === 'revert';
    const targetSats = isUpward ? { [this.site]: { label: this.site } } : satellites;

    let apiAction = action;
    if (action === 'pull') apiAction = 'sync-from-base';
    if (action === 'revert') apiAction = 'resume-inheritance';
    if (action === 'live') apiAction = 'publish';

    const statusCb = (key, status, error) => this._setStatus(key, status, error);

    await executeBulkAction({
      org: this.org,
      baseSite: isUpward ? this.parentBase : this.site,
      pages: this.pages,
      satellites: targetSats,
      action: apiAction,
      syncMode: action === 'sync' ? this._bulkSyncMode : undefined,
      scope: action === 'preview' || action === 'live' ? 'inherited' : null,
      overrides: this.overrides,
      onPageStatus: statusCb,
    });

    this._busy = false;
    this._emitActionComplete();
  }

  // ── Progress stats ────────────────────────────────────────────────────────

  get _progressStats() {
    return [...this._taskStatuses.values()].reduce((acc, { status }) => {
      acc.total += 1;
      if (status === 'success') { acc.done += 1; acc.success += 1; } else if (status === 'error') { acc.done += 1; acc.error += 1; }
      return acc;
    }, {
      total: 0, done: 0, success: 0, error: 0,
    });
  }

  statusIcon(status) {
    if (status === 'queued') return QUEUED_ICON;
    if (status === 'pending') return SPINNER_ICON;
    if (status === 'success') return SUCCESS_ICON;
    if (status === 'error') return ERROR_ICON;
    return nothing;
  }

  // ── Status icon renders ───────────────────────────────────────────────────

  _renderIcon1(siteId) {
    const d = this._satData.get(siteId);
    if (!d || d.hasOverride === undefined) return html`<span class="row-icon row-icon-loading"></span>`;
    if (!d.hasOverride) {
      return html`<span class="row-icon" style="color:var(--s2-green-700,#0ba45d)" title="Following base — no local copy">${ICON_DOC_CHECK}</span>`;
    }
    if (d.outOfSync) {
      return html`<span class="row-icon" style="color:var(--s2-red-700,#ff513d)" title="Local copy — source has changed, sync needed">${ICON_DOC_ALERT}</span>`;
    }
    return html`<span class="row-icon" style="color:var(--s2-orange-600,#fc7d00)" title="Local copy — in sync with source">${ICON_DOC_X}</span>`;
  }

  _renderIcon2(siteId) {
    const d = this._satData.get(siteId);
    if (!d || d.previewState === undefined) {
      return html`<span class="row-icon row-icon-loading"></span>`;
    }
    const key = getStatusKey(d);
    const cfg = ICON2_MAP[key] || ICON2_MAP['not-rolled-out'];
    return html`<span class="row-icon" style="color:${cfg.color}" title=${cfg.tip}>${cfg.icon}</span>`;
  }

  renderStatusIcons(siteId) {
    return html`<div class="row-icons">${this._renderIcon1(siteId)}${this._renderIcon2(siteId)}</div>`;
  }

  _renderTimestamps(siteId) {
    const d = this._satData.get(siteId);
    if (!d || d.previewState === undefined) return nothing;
    const p = formatDate(d.previewDate);
    const l = formatDate(d.liveDate);
    return html`<span class="sat-timestamp">${p} / ${l}</span>`;
  }

  // ── Satellite tree rendering ──────────────────────────────────────────────

  renderSatList() {
    const sats = Object.entries(this.satellites || {});
    if (!sats.length) return html`<p class="no-satellites">No satellites configured.</p>`;
    return html`
      <div class="sat-list">
        ${sats.map(([siteId, info]) => this.renderSatNode(siteId, info.label, info.descendants || [], 0))}
      </div>
    `;
  }

  renderSatNode(siteId, label, children, depth) {
    const hasKids = children.length > 0;
    const isCollapsed = this._collapsed.has(siteId);
    const showConfirm = this._pendingConfirm?.siteId === siteId;
    const d = this._satData.get(siteId) || {};
    const { hasOverride } = d;

    const onToggle = hasKids ? (e) => {
      e.stopPropagation();
      const next = new Set(this._collapsed);
      if (isCollapsed) next.delete(siteId); else next.add(siteId);
      this._collapsed = next;
    } : null;

    // eslint-disable-next-line no-nested-ternary
    const toggleClass = !hasKids ? 'leaf' : isCollapsed ? 'closed' : 'open';

    let actionBtn = nothing;
    if (hasOverride === false) {
      actionBtn = html`<button class="btn-row" ?disabled=${this._busy}
        @click=${(e) => { e.stopPropagation(); this._openRolloutConfirm(siteId); }}>Roll out</button>`;
    } else if (hasOverride === true) {
      actionBtn = html`<button class="btn-row ${d.outOfSync ? 'urgent' : ''}" ?disabled=${this._busy}
        @click=${(e) => { e.stopPropagation(); this._openSyncConfirm(siteId); }}>Sync</button>`;
    }

    const pagePath = this.pages[0]?.path ? stripExt(this.pages[0].path) : '';

    return html`
      <div class="sat-row" style="padding-left:${14 + depth * 22}px"
        @click=${onToggle || nothing}>
        <button class="row-toggle ${toggleClass}" tabindex="-1" aria-hidden="true">
          ${hasKids ? ICON_CHEVRON : nothing}
        </button>
        <div class="row-name-group">
          <span class="row-name">${label}</span>
          ${hasKids && isCollapsed ? html`<span class="region-count">${children.length}</span>` : nothing}
        </div>
        ${this.renderStatusIcons(siteId)}
        ${this._renderTimestamps(siteId)}
        ${actionBtn}
        <button class="btn-more" title="More actions"
          @click=${(e) => { e.stopPropagation(); this._openMenu(siteId, e.currentTarget); }}>
          ${ICON_MORE}
        </button>
      </div>
      ${showConfirm ? this.renderConfirmRow() : nothing}
      ${hasKids && !isCollapsed ? children.map((child) => this.renderSatNode(child.site, child.label, child.children || [], depth + 1)) : nothing}
      ${this._menuSiteId === siteId ? this.renderOverflowMenu(siteId, pagePath) : nothing}
    `;
  }

  renderConfirmRow() {
    const c = this._pendingConfirm;
    if (!c) return nothing;

    const isRollout = c.type === 'rollout';
    const isSync = c.type === 'sync';
    const isDestructive = c.type === 'cancel-inheritance' || c.type === 'resume-inheritance';

    const chipsHtml = isRollout && this._confirmScope.length > 0 ? html`
      <div class="confirm-scope">
        ${this._confirmScope.map((id) => {
    const info = this.satellites?.[id];
    const lbl = info?.label || this._satData.get(id)?.label || id;
    const isOn = this._confirmScope.includes(id);
    return html`<button class="scope-chip ${isOn ? '' : 'off'}"
            @click=${() => this._toggleScope(id)}>${lbl}</button>`;
  })}
      </div>
    ` : nothing;

    return html`
      <div class="confirm-row ${isDestructive ? 'destructive' : ''}">
        ${isRollout ? html`
          <p class="confirm-msg">Select sites to roll out to:</p>
          ${chipsHtml}
          <div class="confirm-actions">
            <button class="btn btn-secondary" @click=${() => this._dismissConfirm()}>Cancel</button>
            <button class="btn btn-primary" ?disabled=${this._confirmScope.length === 0 || this._busy}
              @click=${() => this._executeRollout('preview')}>Roll out to preview</button>
            <button class="btn btn-primary" ?disabled=${this._confirmScope.length === 0 || this._busy}
              @click=${() => this._executeRollout('live')}>Roll out to live</button>
          </div>
        ` : nothing}
        ${isSync ? html`
          <p class="confirm-msg">Sync content from base to <strong>${c.siteId}</strong>:</p>
          <div class="confirm-actions">
            <button class="btn btn-secondary" @click=${() => this._dismissConfirm()}>Cancel</button>
            <button class="btn btn-primary" ?disabled=${this._busy}
              @click=${() => this._executeSync(c.siteId, 'merge')}>Merge</button>
            <button class="btn btn-primary" ?disabled=${this._busy}
              @click=${() => this._executeSync(c.siteId, 'override')}>Override</button>
          </div>
        ` : nothing}
        ${isDestructive ? html`
          <p class="confirm-msg">${c.type === 'cancel-inheritance'
    ? html`Create a local copy of this page on <strong>${c.siteId}</strong>? This breaks inheritance from the base.`
    : html`Remove the local copy on <strong>${c.siteId}</strong> and resume inheriting from base?`
}</p>
          <div class="confirm-actions">
            <button class="btn btn-secondary" @click=${() => this._dismissConfirm()}>Cancel</button>
            <button class="btn btn-danger" ?disabled=${this._busy}
              @click=${() => (c.type === 'cancel-inheritance'
    ? this._executeCancelInheritance(c.siteId)
    : this._executeResumeInheritance(c.siteId))}>
              ${c.type === 'cancel-inheritance' ? 'Create local copy' : 'Remove local copy'}
            </button>
          </div>
        ` : nothing}
      </div>
    `;
  }

  renderOverflowMenu(siteId, pagePath) {
    if (!this._menuPos) return nothing;
    const hasOverride = this._hasOverrideForSite(siteId);
    const { top, right } = this._menuPos;
    return html`
      <div class="overflow-menu" style="top:${top}px;right:${right}px">
        ${hasOverride === false ? html`
          <button class="overflow-item danger"
            @click=${() => { this._closeMenu(); this._pendingConfirm = { siteId, type: 'cancel-inheritance' }; }}>
            Cancel inheritance
          </button>
        ` : nothing}
        ${hasOverride === true ? html`
          <button class="overflow-item danger"
            @click=${() => { this._closeMenu(); this._pendingConfirm = { siteId, type: 'resume-inheritance' }; }}>
            Resume inheritance
          </button>
        ` : nothing}
        <div class="overflow-sep"></div>
        <a class="overflow-item" href="https://da.live/edit#/${this.org}/${siteId}${pagePath}"
          target="_blank" @click=${() => this._closeMenu()}>
          Open page ${ICON_OPEN}
        </a>
      </div>
    `;
  }

  renderSuccessBanner() {
    const s = this._successData;
    if (!s) return nothing;

    const actionLabels = {
      rollout: s.level === 'live' ? 'Rolled out to live' : 'Rolled out to preview',
      'sync-merge': 'Merged from base',
      'sync-override': 'Overridden from base',
      'cancel-inheritance': 'Local copy created',
      'resume-inheritance': 'Inheritance resumed',
      'pull-from-base': 'Pulled from base',
      'revert-to-base': 'Reverted to base',
    };
    const label = actionLabels[s.action] || 'Done';
    const checkSvg = html`<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="2,7 5.5,10.5 12,4"/></svg>`;

    return html`
      <div class="success-banner">
        <div class="success-title">
          ${checkSvg} ${label}
        </div>
        ${s.targets?.length > 1 ? html`
          <div class="success-links">
            ${s.targets.map((id) => {
    const info = this.satellites?.[id];
    const lbl = info?.label || id;
    return html`<span class="success-link-label">${lbl}</span>`;
  })}
          </div>
        ` : nothing}
        <button class="success-dismiss" @click=${() => { this._successData = null; }}>Dismiss</button>
      </div>
    `;
  }

  // ── Source section (satellite/dual role) ──────────────────────────────────

  renderSourceSection() {
    const baseLabel = this.parentBase || (this.parentChain?.[0]?.label || 'base');
    const chain = this.parentChain || [];

    const selfEntry = this.pages?.length
      ? (this.overrides?.get(this.pages[0].path) || []).find((o) => o.site === this.site)
      : null;
    const hasLocalCopy = selfEntry?.hasOverride === true;

    return html`
      <div class="plugin-section">
        <div class="section-header">
          <span class="section-label">Source</span>
        </div>
        ${chain.length > 1 ? html`
          <div class="crumb-row">
            ${chain.map((node, idx) => html`
              ${idx > 0 ? html`<span class="crumb-sep">&rsaquo;</span>` : nothing}
              <span class="crumb-node">${node.label}</span>
            `)}
            <span class="crumb-sep">&rsaquo;</span>
            <span class="crumb-node current">${this.site}</span>
          </div>
        ` : nothing}
        <div class="sat-list">
          <div class="sat-row">
            <button class="row-toggle leaf" tabindex="-1" aria-hidden="true"></button>
            <div class="row-name-group">
              <span class="row-name">${baseLabel}</span>
            </div>
            <div class="source-actions">
              ${hasLocalCopy ? html`
                <button class="btn-row" ?disabled=${this._busy}
                  @click=${() => this._openSyncConfirm('__source__')}>Sync</button>
                <button class="btn-row urgent" ?disabled=${this._busy}
                  @click=${() => { this._pendingConfirm = { siteId: '__source__', type: 'resume-inheritance' }; }}>Revert</button>
              ` : html`
                <button class="btn-row" ?disabled=${this._busy}
                  @click=${() => { this._pendingConfirm = { siteId: '__source__', type: 'cancel-inheritance' }; }}>Make copy</button>
              `}
            </div>
          </div>
          ${this._pendingConfirm?.siteId === '__source__' ? this.renderSourceConfirmRow() : nothing}
        </div>
        ${this._sourceError ? html`<p class="source-note source-note-error">${this._sourceError}</p>` : nothing}
      </div>
    `;
  }

  renderSourceConfirmRow() {
    const c = this._pendingConfirm;
    if (!c) return nothing;
    const isCancelInheritance = c.type === 'cancel-inheritance';
    const isResumeInheritance = c.type === 'resume-inheritance';
    const isSync = c.type === 'sync';
    return html`
      <div class="confirm-row ${isResumeInheritance ? 'destructive' : ''}">
        ${isSync ? html`
          <p class="confirm-msg">Pull latest from <strong>${this.parentBase}</strong>:</p>
          <div class="confirm-actions">
            <button class="btn btn-secondary" @click=${() => this._dismissConfirm()}>Cancel</button>
            <button class="btn btn-primary" ?disabled=${this._busy}
              @click=${() => this._executePullFromBase('merge')}>Merge</button>
            <button class="btn btn-primary" ?disabled=${this._busy}
              @click=${() => this._executePullFromBase('override')}>Override</button>
          </div>
        ` : nothing}
        ${isCancelInheritance ? html`
          <p class="confirm-msg">Create a local copy from <strong>${this.parentBase}</strong>? This breaks inheritance.</p>
          <div class="confirm-actions">
            <button class="btn btn-secondary" @click=${() => this._dismissConfirm()}>Cancel</button>
            <button class="btn btn-danger" ?disabled=${this._busy}
              @click=${() => this._executePullFromBase('override')}>Create local copy</button>
          </div>
        ` : nothing}
        ${isResumeInheritance ? html`
          <p class="confirm-msg">Remove local copy and revert to inheriting from <strong>${this.parentBase}</strong>?</p>
          <div class="confirm-actions">
            <button class="btn btn-secondary" @click=${() => this._dismissConfirm()}>Cancel</button>
            <button class="btn btn-danger" ?disabled=${this._busy}
              @click=${() => this._executeRevertToBase()}>Remove local copy</button>
          </div>
        ` : nothing}
      </div>
    `;
  }

  // ── Satellites section ────────────────────────────────────────────────────

  renderSatellitesSection() {
    const hasAnyInherited = Object.keys(this.satellites || {}).some(
      (id) => this._hasOverrideForSite(id) === false,
    );
    return html`
      <div class="plugin-section">
        <div class="section-header">
          <span class="section-label">Satellites</span>
          <button class="btn-rollout-all" ?disabled=${this._busy || !hasAnyInherited}
            @click=${() => this._openRolloutAllConfirm()}>Roll out all</button>
        </div>
        ${this._pendingConfirm?.siteId === '__all__' ? this.renderConfirmRow() : nothing}
        ${this.renderSatList()}
      </div>
    `;
  }

  // ── Single page render ────────────────────────────────────────────────────

  renderSinglePage() {
    const page = this.pages[0];
    const isSatellite = this.role === 'satellite' || this.role === 'dual';
    const isBase = this.role === 'base' || this.role === 'dual';

    return html`
      <div class="panel">
        <div class="panel-header">
          <h3 class="panel-title">${page.name}</h3>
          <span class="panel-subtitle">${this.site}</span>
        </div>
        <div class="panel-body">
          ${this.renderSuccessBanner()}
          ${isSatellite ? this.renderSourceSection() : nothing}
          ${isBase ? this.renderSatellitesSection() : nothing}
          ${this._executing ? this.renderProgress() : nothing}
        </div>
      </div>
    `;
  }

  // ── Bulk mode render ──────────────────────────────────────────────────────

  renderBulk() {
    const sats = Object.entries(this.satellites || {});
    const isUpward = this.role === 'satellite';

    const actions = isUpward
      ? [
        { value: 'pull', label: 'Pull latest from base' },
        { value: 'revert', label: 'Revert to base' },
      ]
      : [
        { value: 'preview', label: 'Roll out to preview' },
        { value: 'live', label: 'Roll out to live' },
        { value: 'sync', label: 'Sync (push updates)' },
      ];

    const isSyncAction = this._bulkAction === 'sync';

    return html`
      <div class="panel">
        <div class="panel-header">
          <h3 class="panel-title">${this.pages.length} pages selected</h3>
          <span class="panel-subtitle">${this.site}</span>
        </div>
        <div class="panel-body">
          ${this.renderSuccessBanner()}
          <div class="bulk-action-selector">
            ${actions.map((a) => html`
              <label class="bulk-action-option">
                <input type="radio" name="bulk-action" .value=${a.value}
                  .checked=${this._bulkAction === a.value}
                  @change=${() => { this._bulkAction = a.value; }}>
                <span>${a.label}</span>
              </label>
            `)}
          </div>
          ${isSyncAction ? html`
            <div class="bulk-sync-mode">
              <label><input type="radio" name="bulk-sync" value="merge"
                .checked=${this._bulkSyncMode === 'merge'}
                @change=${() => { this._bulkSyncMode = 'merge'; }}>
                Merge (keep local edits)</label>
              <label><input type="radio" name="bulk-sync" value="override"
                .checked=${this._bulkSyncMode === 'override'}
                @change=${() => { this._bulkSyncMode = 'override'; }}>
                Override (replace with base)</label>
            </div>
          ` : nothing}
          ${!isUpward && sats.length > 1 ? html`
            <div class="bulk-sat-filter">
              <div class="section-label">Target satellites</div>
              ${sats.map(([siteId, info]) => html`
                <label class="bulk-sat-option">
                  <input type="checkbox"
                    .checked=${!this._bulkSatFilter || this._bulkSatFilter.has(siteId)}
                    @change=${(e) => {
    const next = new Set(this._bulkSatFilter || sats.map(([s]) => s));
    if (e.target.checked) next.add(siteId); else next.delete(siteId);
    this._bulkSatFilter = next.size === sats.length ? null : next;
  }}>
                  <span>${info.label || siteId}</span>
                </label>
              `)}
            </div>
          ` : nothing}
          ${this._executing ? this.renderProgress() : html`
            <div class="bulk-footer">
              <button class="btn btn-primary" ?disabled=${this._busy || !this._bulkAction}
                @click=${() => this._executeBulk()}>Apply</button>
            </div>
          `}
        </div>
      </div>
    `;
  }

  // ── Progress view ─────────────────────────────────────────────────────────

  renderProgress() {
    const stats = this._progressStats;
    const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;

    return html`
      <div class="progress-view">
        <div class="progress-bar-container">
          <div class="progress-bar" style="width:${pct}%"></div>
        </div>
        <div class="progress-summary">
          <span>${stats.done} / ${stats.total} complete</span>
          ${stats.success > 0 ? html`<span class="count-success">${stats.success} succeeded</span>` : nothing}
          ${stats.error > 0 ? html`<span class="count-error">${stats.error} failed</span>` : nothing}
        </div>
        <ul class="progress-list">
          ${[...this._taskStatuses.entries()].map(([key, { status, error }]) => {
    const lastColon = key.lastIndexOf(':');
    const pagePath = key.slice(0, lastColon);
    const satSite = key.slice(lastColon + 1);
    const pageName = pagePath.split('/').pop().replace(/\.[^/.]+$/, '') || pagePath;
    const satLabel = this.satellites?.[satSite]?.label || satSite;
    return html`
              <li class="progress-item">
                ${this.statusIcon(status)}
                <span class="page-label">${pageName}</span>
                <span class="sat-label">${satLabel}</span>
                ${error ? html`<span class="error-msg">${error}</span>` : nothing}
              </li>
            `;
  })}
        </ul>
      </div>
    `;
  }

  // ── Main render ───────────────────────────────────────────────────────────

  render() {
    if (!this.pages?.length) return nothing;
    if (this.isSinglePage) return this.renderSinglePage();
    return this.renderBulk();
  }
}

customElements.define('msm-action-panel', MsmActionPanel);
