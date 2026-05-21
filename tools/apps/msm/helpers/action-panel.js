/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console, class-methods-use-this */
import { LitElement, html, nothing } from 'da-lit';
import { executeBulkAction, expandSatellitesWithSubtree } from './api.js';

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

const CHEVRON = html`<svg class="picker-chevron" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="2,3 5,7 8,3"/></svg>`;
const CHECK_ICON = html`<svg class="picker-checkmark" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="2,6 5,9 10,3"/></svg>`;
const QUEUED_ICON = html`<svg class="result-icon queued" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" opacity="0.4"><circle cx="8" cy="8" r="6"/></svg>`;
const SPINNER_ICON = html`<svg class="result-icon pending" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 1a7 7 0 1 0 7 7" stroke-linecap="round"/></svg>`;
const SUCCESS_ICON = html`<svg class="result-icon success" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,8 7,12 13,4"/></svg>`;
const ERROR_ICON = html`<svg class="result-icon error" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>`;
const EDIT_ICON = html`<svg viewBox="0 0 20 20"><path fill="currentColor" d="M18.16 15.62V4.12c0-1.24-1.01-2.25-2.25-2.25H4.41c-1.24 0-2.25 1.01-2.25 2.25v3.72c0 .41.34.75.75.75s.75-.34.75-.75v-3.72c0-.41.34-.75.75-.75h11.5c.41 0 .75.34.75.75v11.5c0 .41-.34.75-.75.75h-3.81c-.41 0-.75.34-.75.75s.34.75.75.75h3.81c1.24 0 2.25-1.01 2.25-2.25z"/><path fill="currentColor" d="M11.16 9.62v4.24c0 .41-.34.75-.75.75s-.75-.34-.75-.75v-2.43l-6.47 6.47c-.15.15-.34.22-.53.22s-.38-.07-.53-.22a.754.754 0 010-1.06l6.47-6.47H6.17c-.41 0-.75-.34-.75-.75s.34-.75.75-.75h4.24c.41 0 .75.34.75.75z"/></svg>`;

const DOWNWARD_ACTIONS = [
  {
    heading: 'Inherited sites',
    items: [
      { value: 'preview', label: 'Roll out to preview' },
      { value: 'publish', label: 'Roll out to live' },
      { value: 'break', label: 'Cancel inheritance' },
    ],
  },
  {
    heading: 'Custom sites',
    items: [
      { value: 'sync', label: 'Sync to satellite' },
      { value: 'reset', label: 'Resume inheritance' },
    ],
  },
];

// Upward action lists, scoped to the page's inheritance category. The picker
// surfaces only the actions that make sense for the selection:
//   - inherited  : the page lives on an ancestor; you can pull it down or
//                  materialize a local copy that breaks the inheritance link.
//   - overridden : the page already has a local copy that overrides the
//                  base; you can refresh from base or drop the local copy.
//   - local      : the page exists only on this site (no base counterpart);
//                  no upward operations are meaningful.
// Inherited pages have no local copy here, so 'Sync from base' would just
// materialize one — identical to 'Cancel inheritance'. Only the latter is
// offered to keep the user's intent unambiguous.
const UPWARD_ACTIONS_INHERITED = [
  {
    heading: 'From parent',
    items: [
      { value: 'cancel-inheritance', label: 'Cancel inheritance' },
    ],
  },
];

const UPWARD_ACTIONS_OVERRIDDEN = [
  {
    heading: 'From parent',
    items: [
      { value: 'sync-from-base', label: 'Sync from base' },
      { value: 'resume-inheritance', label: 'Resume inheritance' },
    ],
  },
];

const UPWARD_ACTIONS_LOCAL = [
  {
    heading: 'From parent',
    items: [],
  },
];

const SYNC_OPTIONS = [
  { value: 'merge', label: 'Merge' },
  { value: 'override', label: 'Override' },
];

const ACTION_SCOPE = {
  preview: 'inherited',
  publish: 'inherited',
  break: 'inherited',
  sync: 'custom',
  reset: 'custom',
};

const UPWARD_VALUES = new Set([
  'sync-from-base',
  'resume-inheritance',
  'cancel-inheritance',
]);
const RECURSIVE_ACTIONS = new Set(['preview', 'publish']);
const SYNC_ACTIONS = new Set(['sync', 'sync-from-base']);

const ALL_ACTION_ITEMS = [
  ...DOWNWARD_ACTIONS.flatMap((g) => g.items || [g]),
  ...UPWARD_ACTIONS_INHERITED.flatMap((g) => g.items || [g]),
  ...UPWARD_ACTIONS_OVERRIDDEN.flatMap((g) => g.items || [g]),
];

function getActionLabel(value) {
  return ALL_ACTION_ITEMS.find((i) => i.value === value)?.label || value;
}

function defaultActionForRole(role) {
  return role === 'satellite' ? 'sync-from-base' : 'preview';
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
    _globalAction: { state: true },
    _globalSyncMode: { state: true },
    _pageActions: { state: true },
    _pageSyncModes: { state: true },
    _selectedSats: { state: true },
    _singleSelectedSats: { state: true },
    _openPicker: { state: true },
    _expandedRows: { state: true },
    _confirmAction: { state: true },
    _executing: { state: true },
    _taskStatuses: { state: true },
    _busy: { state: true },
    _includedPages: { state: true },
    _includeDescendants: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sl, sheet, buttons].filter(Boolean);
    this._globalAction = defaultActionForRole(this.role);
    this._globalSyncMode = 'merge';
    this._pageActions = new Map();
    this._pageSyncModes = new Map();
    this._selectedSats = new Set(Object.keys(this.satellites || {}));
    this._singleSelectedSats = new Set(Object.keys(this.satellites || {}));
    this._openPicker = null;
    this._expandedRows = new Set();
    this._confirmAction = null;
    this._executing = false;
    this._taskStatuses = new Map();
    this._busy = false;
    this._includedPages = new Set(this.pages?.map((p) => p.path) || []);
    this._includeDescendants = false;
    this._lastPageKey = '';
    this._handleOutsideClick = this._handleOutsideClick.bind(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('pointerdown', this._handleOutsideClick);
  }

  updated(changed) {
    if (changed.has('satellites') && this.satellites) {
      this._selectedSats = new Set(Object.keys(this.satellites));
      this._singleSelectedSats = new Set(Object.keys(this.satellites));
    }
    if (changed.has('role')) {
      this._globalAction = defaultActionForRole(this.role);
      this._pageActions = new Map();
      this._resetExecution();
    }
    if (changed.has('pages') || changed.has('isSinglePage')) {
      this._executing = false;
      this._taskStatuses = new Map();
      this._pageActions = new Map();
      this._pageSyncModes = new Map();
      this._expandedRows = new Set();

      const newKey = this.pages?.map((p) => p.path).sort().join(',') || '';
      if (newKey !== this._lastPageKey) {
        this._lastPageKey = newKey;
        this._includedPages = new Set(this.pages?.map((p) => p.path) || []);
      }
    }
    if (changed.has('pages') || changed.has('overrides')) {
      this._applySyncModeDefault();
      this._validateActionForCategory();
    }
  }

  // When the selection is uniformly inherited (no local overrides at the
  // current site), default the sync mode to 'override' — there's nothing
  // local to merge against, and merge-mode would unnecessarily pull in the
  // mergeCopy machinery. Mixed selections keep 'merge' as today.
  _applySyncModeDefault() {
    if (!this.pages?.length) return;
    const allInherited = this.pages.every((p) => {
      const ov = this.overrides?.get?.(p.path)?.find((o) => o.site === this.site);
      return ov && ov.hasOverride === false;
    });
    if (allInherited && this._globalSyncMode === 'merge') {
      this._globalSyncMode = 'override';
    }
  }

  // Ensure `_globalAction` is valid for the current selection's category. If
  // the action isn't in the allowed list for the new category, fall back to
  // the first option for that category. For the 'local' category (no upward
  // actions available) we leave the action as-is and rely on Apply being
  // disabled and the empty-state message to communicate.
  _validateActionForCategory() {
    if (!this._isUpwardMode) return;
    const options = this._upwardActionsForCategory(this._selectionCategory);
    const allowed = options.flatMap((g) => g.items || [g]).map((o) => o.value);
    if (allowed.length === 0) return;
    if (allowed.includes(this._globalAction)) return;
    [this._globalAction] = allowed;
    this._pageActions = new Map();
    this._resetExecution();
  }

  _handleOutsideClick(e) {
    if (!e.composedPath().includes(this)) {
      this._openPicker = null;
      document.removeEventListener('pointerdown', this._handleOutsideClick);
    }
  }

  togglePicker(name) {
    if (this._openPicker === name) {
      this._openPicker = null;
      document.removeEventListener('pointerdown', this._handleOutsideClick);
    } else {
      this._openPicker = name;
      document.addEventListener('pointerdown', this._handleOutsideClick);
    }
  }

  selectPickerOption(name, value, setter) {
    setter(value);
    this._openPicker = null;
    document.removeEventListener('pointerdown', this._handleOutsideClick);
  }

  get _isSatellite() {
    return this.role === 'satellite';
  }

  get _hasDualRole() {
    return this.role === 'dual';
  }

  get _isUpwardMode() {
    return UPWARD_VALUES.has(this._globalAction);
  }

  get _hasDownwardActions() {
    return this.role === 'base' || this.role === 'dual';
  }

  get _hasUpwardActions() {
    return this.role === 'satellite' || this.role === 'dual';
  }

  get _actionOptions() {
    if (!this._isUpwardMode) return DOWNWARD_ACTIONS;
    return this._upwardActionsForCategory(this._selectionCategory);
  }

  _upwardActionsForCategory(category) {
    if (category === 'inherited') return UPWARD_ACTIONS_INHERITED;
    if (category === 'overridden') return UPWARD_ACTIONS_OVERRIDDEN;
    if (category === 'local') return UPWARD_ACTIONS_LOCAL;
    // 'mixed' or null: fall back to the union (overridden) so the picker
    // still renders something sensible. The column-browser mutex normally
    // prevents reaching 'mixed' in practice.
    return UPWARD_ACTIONS_OVERRIDDEN;
  }

  // Categorize a single page based on its self-entry in `overrides`:
  //   - inherited  : the page is served from an ancestor (no local copy here)
  //   - overridden : the page has a local copy AND a base counterpart
  //   - local      : the page exists only on this site
  _categorizePage(page) {
    const self = this.getPageOverrides(page.path).find((o) => o.site === this.site);
    if (!self) return 'local';
    if (self.inheritedFrom) return 'inherited';
    if (self.hasOverride === true) return 'overridden';
    return 'local';
  }

  // Returns the common category across all currently selected pages, or
  // 'mixed' when the selection spans multiple categories (rare given the
  // column-browser enforces single-category selection upstream).
  get _selectionCategory() {
    if (!this.pages?.length) return null;
    const cats = new Set(this.pages.map((p) => this._categorizePage(p)));
    if (cats.size === 1) return [...cats][0];
    return 'mixed';
  }

  // True when the sync-mode picker (merge/override) should be visible for
  // `action`. Inherited pages always use override, so the picker is hidden.
  _shouldShowSyncPicker(action) {
    if (!SYNC_ACTIONS.has(action)) return false;
    if (this._isUpwardMode && this._selectionCategory === 'inherited') return false;
    return true;
  }

  // True when the panel is in upward mode but the selection consists only of
  // local-only pages (no base counterpart). No upward action is meaningful;
  // we render an empty-state message instead of the action pickers.
  get _isLocalUpwardEmpty() {
    return this._isUpwardMode && this._selectionCategory === 'local';
  }

  renderLocalUpwardEmpty() {
    return html`
      <div class="local-upward-empty">
        These pages exist only on <strong>${this.site}</strong> and have no base counterpart.
        No upward MSM actions are available for this selection.
      </div>
    `;
  }

  _resetExecution() {
    if (this._executing) {
      this._executing = false;
      this._taskStatuses = new Map();
    }
  }

  // ── Satellite filter ──

  toggleSatFilter(satSite) {
    const next = new Set(this._selectedSats);
    if (next.has(satSite)) next.delete(satSite);
    else next.add(satSite);
    this._selectedSats = next;
    this._resetExecution();
  }

  toggleSingleSat(satSite) {
    const next = new Set(this._singleSelectedSats);
    if (next.has(satSite)) next.delete(satSite);
    else next.add(satSite);
    this._singleSelectedSats = next;
    this._resetExecution();
  }

  // ── Per-page action ──

  getPageAction(pagePath) {
    return this._pageActions.get(pagePath) || this._globalAction;
  }

  setPageAction(pagePath, value) {
    const next = new Map(this._pageActions);
    if (value === this._globalAction) {
      next.delete(pagePath);
    } else {
      next.set(pagePath, value);
    }
    this._pageActions = next;
    this._resetExecution();
  }

  getPageSyncMode(pagePath) {
    return this._pageSyncModes.get(pagePath) || this._globalSyncMode;
  }

  setPageSyncMode(pagePath, value) {
    const next = new Map(this._pageSyncModes);
    if (value === this._globalSyncMode) {
      next.delete(pagePath);
    } else {
      next.set(pagePath, value);
    }
    this._pageSyncModes = next;
  }

  // ── Expand/collapse rows ──

  toggleRow(pagePath) {
    const next = new Set(this._expandedRows);
    if (next.has(pagePath)) next.delete(pagePath);
    else next.add(pagePath);
    this._expandedRows = next;
  }

  // ── Page include/exclude ──

  togglePageInclude(pagePath) {
    const next = new Set(this._includedPages);
    if (next.has(pagePath)) next.delete(pagePath);
    else next.add(pagePath);
    this._includedPages = next;
  }

  toggleAllPages() {
    if (this._includedPages.size === this.pages.length) {
      this._includedPages = new Set();
    } else {
      this._includedPages = new Set(this.pages.map((p) => p.path));
    }
  }

  get _activePages() {
    return this.pages.filter((p) => this._includedPages.has(p.path));
  }

  // ── Override helpers ──

  getPageOverrides(pagePath) {
    return this.overrides?.get(pagePath) || [];
  }

  getOverrideSummary(pagePath) {
    const ov = this.getPageOverrides(pagePath)
      .filter((o) => this._selectedSats.has(o.site));
    if (!ov.length) return { inherited: 0, custom: 0 };
    const custom = ov.filter((o) => o.hasOverride).length;
    return { inherited: ov.length - custom, custom };
  }

  hasApplicableSats(pagePath, action) {
    if (this._isSatellite) return true;
    const scope = ACTION_SCOPE[action];
    if (!scope) return true;
    const ov = this.getPageOverrides(pagePath);
    const sats = this.isSinglePage ? this._singleSelectedSats : this._selectedSats;
    return ov
      .filter((o) => sats.has(o.site))
      .some((o) => (scope === 'custom' ? o.hasOverride : !o.hasOverride));
  }

  get _hasAnyApplicablePages() {
    return this._activePages.some((page) => this.hasApplicableSats(
      page.path,
      this.getPageAction(page.path),
    ));
  }

  getFilteredSatellites() {
    return Object.entries(this.satellites || {}).filter(([satSite]) => (
      this._selectedSats.has(satSite)
    )).reduce((acc, [s, info]) => { acc[s] = info; return acc; }, {});
  }

  get _totalDescendants() {
    return Object.values(this.satellites || {})
      .reduce((acc, info) => acc + (info.descendantCount || 0), 0);
  }

  get _showDescendantsToggle() {
    return !this._isUpwardMode
      && this._hasDownwardActions
      && this.hasDescendants
      && RECURSIVE_ACTIONS.has(this._globalAction)
      && this._totalDescendants > 0;
  }

  resolveSatellitesForAction(directSatellites, action) {
    if (!this._includeDescendants || !RECURSIVE_ACTIONS.has(action)) {
      return directSatellites;
    }
    if (!this.msmConfig) return directSatellites;
    return expandSatellitesWithSubtree(this.msmConfig, directSatellites);
  }

  // ── Execution ──

  async executeAll() {
    if (this._busy) return;

    const summary = this.buildExecutionSummary();
    this._confirmAction = {
      message: summary,
      onConfirm: () => this.doExecuteAll(),
    };
  }

  buildExecutionSummary() {
    const counts = this._activePages.reduce((acc, page) => {
      const action = this.getPageAction(page.path);
      acc[action] = (acc[action] || 0) + 1;
      return acc;
    }, {});

    if (this._isUpwardMode) {
      const parts = Object.entries(counts).map(([a, c]) => (
        `${getActionLabel(a)} ${c} page${c > 1 ? 's' : ''}`
      ));
      return `${parts.join(', ')} on ${this.site} from ${this.parentBase}. Continue?`;
    }

    const parts = Object.entries(counts).map(([a, c]) => {
      const label = `${getActionLabel(a)} ${c} page${c > 1 ? 's' : ''}`;
      const scope = ACTION_SCOPE[a];
      return scope ? `${label} (${scope} sites only)` : label;
    });
    const satCount = this._selectedSats.size;
    const satSuffix = `across ${satCount} direct satellite${satCount !== 1 ? 's' : ''}`;
    const skipNote = ' Satellites that don\'t match the action scope will be skipped.';
    const recursiveActive = this._includeDescendants
      && Object.keys(counts).some((a) => RECURSIVE_ACTIONS.has(a));
    const recursiveNote = recursiveActive
      ? ` Including ${this._totalDescendants} descendant site${this._totalDescendants !== 1 ? 's' : ''} (Preview/Publish only).`
      : '';
    return `${parts.join(', ')} ${satSuffix}.${skipNote}${recursiveNote} Continue?`;
  }

  cancelConfirm() {
    this._confirmAction = null;
  }

  async doExecuteAll() {
    this._confirmAction = null;
    this._executing = true;
    this._busy = true;
    this._taskStatuses = new Map();

    // Group pages by (action, syncMode, sourceSite) so each batch can target
    // the right base. For multi-level inheritance, different pages can
    // legitimately have different sources (e.g. some inherited from the
    // immediate parent, others from a deeper ancestor).
    const actionGroups = this._activePages.reduce((acc, page) => {
      const action = this.getPageAction(page.path);
      const isUpward = UPWARD_VALUES.has(action);
      const syncMode = this._effectiveSyncMode(page, action);
      const sourceSite = isUpward ? this._resolveSourceSite(page) : null;
      const key = [action, syncMode || '', sourceSite || ''].join('::');
      if (!acc.has(key)) {
        acc.set(key, {
          action, syncMode, sourceSite, pages: [],
        });
      }
      acc.get(key).pages.push(page);
      return acc;
    }, new Map());

    const statusCallback = (key, status, error) => {
      const next = new Map(this._taskStatuses);
      next.set(key, { status, error });
      this._taskStatuses = next;
    };

    const groupEntries = [...actionGroups.values()];

    await groupEntries.reduce((chain, {
      action, syncMode, sourceSite, pages,
    }) => chain.then(() => {
      const ctx = this._executionContext(action, sourceSite);
      return executeBulkAction({
        org: this.org,
        baseSite: ctx.baseSite,
        pages,
        satellites: ctx.satellites,
        action,
        syncMode: syncMode || undefined,
        scope: ctx.scope,
        overrides: this.overrides,
        onPageStatus: statusCallback,
      });
    }), Promise.resolve());

    this._busy = false;
    this._emitActionComplete();
  }

  // Resolves the effective base site for an upward action on `page`. Falls
  // back to `parentBase` when the page has no recorded sourceSite (e.g. the
  // page is local and has never been inherited).
  _resolveSourceSite(page) {
    const ov = this.getPageOverrides(page.path).find((o) => o.site === this.site);
    return ov?.sourceSite || this.parentBase;
  }

  // Resolves the syncMode for `page`+`action`, forcing 'override' for upward
  // sync on an inherited page (there's nothing local to merge against).
  _effectiveSyncMode(page, action) {
    if (!SYNC_ACTIONS.has(action)) return '';
    if (UPWARD_VALUES.has(action) && this._categorizePage(page) === 'inherited') {
      return 'override';
    }
    return this.getPageSyncMode(page.path);
  }

  _emitActionComplete() {
    this.dispatchEvent(new CustomEvent('action-complete', {
      bubbles: true,
      composed: true,
    }));
  }

  // ── Execution context (downward vs upward) ──

  _executionContext(action, sourceSite) {
    if (UPWARD_VALUES.has(action)) {
      // Upward: current site is the satellite, an ancestor is the base.
      return {
        baseSite: sourceSite || this.parentBase,
        satellites: { [this.site]: { label: this.site } },
        scope: null,
      };
    }
    // Downward: current site is the base, children are the satellites.
    const filteredSats = this.getFilteredSatellites();
    const sats = this.resolveSatellitesForAction(filteredSats, action);
    return {
      baseSite: this.site,
      satellites: sats,
      scope: ACTION_SCOPE[action],
    };
  }

  _executionContextForSet(action, satSet, sourceSite) {
    if (UPWARD_VALUES.has(action)) {
      return {
        baseSite: sourceSite || this.parentBase,
        satellites: { [this.site]: { label: this.site } },
        scope: null,
      };
    }
    const directSats = Object.entries(this.satellites || {})
      .filter(([s]) => satSet.has(s))
      .reduce((acc, [s, info]) => { acc[s] = info; return acc; }, {});
    const sats = this.resolveSatellitesForAction(directSats, action);
    return {
      baseSite: this.site,
      satellites: sats,
      scope: ACTION_SCOPE[action],
    };
  }

  async executeSinglePage() {
    if (this._busy) return;

    const page = this.pages[0];
    const action = this._globalAction;

    if (action === 'reset') {
      this._confirmAction = {
        message: 'Resume inheritance? This deletes local overrides for selected satellites.',
        onConfirm: () => this.doExecuteSingle(page, action),
      };
      return;
    }
    if (action === 'resume-inheritance') {
      this._confirmAction = {
        message: `Resume inheritance for ${this.site}? This deletes the local override of ${page.name} so it inherits from ${this.parentBase}.`,
        onConfirm: () => this.doExecuteSingle(page, action),
      };
      return;
    }
    if (action === 'cancel-inheritance') {
      const src = this._resolveSourceSite(page);
      this._confirmAction = {
        message: `Cancel inheritance for ${page.name} on ${this.site}? This creates a local copy from ${src}, breaking the inheritance link.`,
        onConfirm: () => this.doExecuteSingle(page, action),
      };
      return;
    }

    this.doExecuteSingle(page, action);
  }

  async doExecuteSingle(page, action, satSet, syncMode) {
    this._confirmAction = null;
    this._executing = true;
    this._busy = true;
    this._taskStatuses = new Map();

    const activeSats = satSet || this._singleSelectedSats;
    const sourceSite = UPWARD_VALUES.has(action) ? this._resolveSourceSite(page) : null;
    const ctx = this._executionContextForSet(action, activeSats, sourceSite);
    // For upward sync-from-base on an inherited page, force override (no
    // local content to merge against). Otherwise honor the chosen mode.
    let resolvedSyncMode = syncMode || this._globalSyncMode;
    if (UPWARD_VALUES.has(action) && this._categorizePage(page) === 'inherited') {
      resolvedSyncMode = 'override';
    }

    await executeBulkAction({
      org: this.org,
      baseSite: ctx.baseSite,
      pages: [page],
      satellites: ctx.satellites,
      action,
      syncMode: SYNC_ACTIONS.has(action) ? resolvedSyncMode : undefined,
      scope: ctx.scope,
      overrides: this.overrides,
      onPageStatus: (key, status, error) => {
        const next = new Map(this._taskStatuses);
        next.set(key, { status, error });
        this._taskStatuses = next;
      },
    });

    this._busy = false;
    this._emitActionComplete();
  }

  async executeRow(page) {
    if (this._busy) return;

    const action = this.getPageAction(page.path);
    const syncMode = this.getPageSyncMode(page.path);
    if (action === 'reset') {
      this._confirmAction = {
        message: `Resume inheritance for ${page.name}? This deletes local overrides.`,
        onConfirm: () => this.doExecuteSingle(page, action, this._selectedSats, syncMode),
      };
      return;
    }
    if (action === 'resume-inheritance') {
      this._confirmAction = {
        message: `Resume inheritance for ${page.name} on ${this.site}? This deletes the local override so it inherits from ${this.parentBase}.`,
        onConfirm: () => this.doExecuteSingle(page, action, this._selectedSats, syncMode),
      };
      return;
    }
    if (action === 'cancel-inheritance') {
      const src = this._resolveSourceSite(page);
      this._confirmAction = {
        message: `Cancel inheritance for ${page.name} on ${this.site}? This creates a local copy from ${src}, breaking the inheritance link.`,
        onConfirm: () => this.doExecuteSingle(page, action, this._selectedSats, syncMode),
      };
      return;
    }
    this.doExecuteSingle(page, action, this._selectedSats, syncMode);
  }

  // ── Status icon helper ──

  statusIcon(status) {
    if (status === 'queued') return QUEUED_ICON;
    if (status === 'pending') return SPINNER_ICON;
    if (status === 'success') return SUCCESS_ICON;
    if (status === 'error') return ERROR_ICON;
    return nothing;
  }

  // ── Progress stats ──

  get _progressStats() {
    return [...this._taskStatuses.values()].reduce((acc, { status }) => {
      acc.total += 1;
      if (status === 'success') { acc.done += 1; acc.success += 1; } else if (status === 'error') { acc.done += 1; acc.error += 1; }
      return acc;
    }, {
      total: 0, done: 0, success: 0, error: 0,
    });
  }

  // ──────────────────────────────────────
  // Render: Picker (reusable)
  // ──────────────────────────────────────

  renderPicker(name, label, value, options, setter) {
    const isOpen = this._openPicker === name;
    const selectedLabel = options
      .flatMap((o) => o.items || [o])
      .find((o) => o.value === value)?.label || '';

    const renderOption = (opt) => {
      const isDisabled = !!opt.disabled;
      const handler = isDisabled
        ? null
        : () => this.selectPickerOption(name, opt.value, setter);
      return html`
        <li class="picker-item ${opt.value === value ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}"
          title=${opt.disabledReason || nothing}
          @click=${handler || nothing}>
          ${CHECK_ICON}
          ${opt.label}
        </li>
      `;
    };

    return html`
      <div class="form-row">
        ${label ? html`<label>${label}</label>` : nothing}
        <div class="picker-wrapper">
          <button class="picker-trigger ${isOpen ? 'open' : ''}"
            @click=${() => this.togglePicker(name)}
            ?disabled=${this._busy}>
            <span class="picker-label">${selectedLabel}</span>
            ${CHEVRON}
          </button>
          ${isOpen ? html`
            <ul class="picker-menu">
              ${options.map((group) => {
    if (group.items) {
      return html`
                    <li class="picker-group-header">${group.heading}</li>
                    ${group.items.map(renderOption)}
                  `;
    }
    return renderOption(group);
  })}
            </ul>
          ` : nothing}
        </div>
      </div>
    `;
  }

  // Returns the per-row action options for `page`. Because the column-browser
  // enforces a single-category selection, the per-row options here mirror the
  // category that the panel is already in. We still resolve per-page so each
  // row reflects its own data if the mutex is ever bypassed.
  _actionOptionsForPage(page) {
    if (!page || !this._isUpwardMode) return this._actionOptions;
    return this._upwardActionsForCategory(this._categorizePage(page));
  }

  // ──────────────────────────────────────
  // Render: Breadcrumb (multi-level inheritance chain)
  // ──────────────────────────────────────

  renderBreadcrumb() {
    if (!this._hasUpwardActions) return nothing;
    const nodes = [
      ...(this.parentChain || []),
      { site: this.site, label: this.site, current: true },
    ];
    if (nodes.length <= 1) return nothing;
    return html`
      <div class="crumb-row" aria-label="Inheritance chain">
        <span class="crumb-label">Inherits from</span>
        ${nodes.map((node, idx) => html`
          ${idx > 0 ? html`<span class="crumb-sep" aria-hidden="true">\u203A</span>` : nothing}
          <span class="crumb-node ${node.current ? 'current' : ''}">${node.label}</span>
        `)}
      </div>
    `;
  }

  // ──────────────────────────────────────
  // Render: Direction switch (Spectrum 2 Switch)
  // ──────────────────────────────────────

  renderDirectionSwitch() {
    if (!this._hasDualRole) return nothing;
    const checked = this._isUpwardMode;
    return html`
      <label class="direction-switch">
        <input type="checkbox"
          role="switch"
          aria-label="Sync from parent"
          .checked=${checked}
          ?disabled=${this._busy}
          @change=${(e) => this.onDirectionToggle(e.target.checked)} />
        <span class="switch-track" aria-hidden="true">
          <span class="switch-knob"></span>
        </span>
        <span class="switch-label">Sync from parent</span>
      </label>
    `;
  }

  onDirectionToggle(toUpward) {
    this._globalAction = toUpward ? 'sync-from-base' : 'preview';
    this._pageActions = new Map();
    this._resetExecution();
    // Dual-role: 'sync-from-base' isn't valid for inherited selections, so
    // resolve to the first allowed upward action for the current category.
    if (toUpward) this._validateActionForCategory();
  }

  // ──────────────────────────────────────
  // Render: Upward summary (Source / Target / Local override)
  // ──────────────────────────────────────

  renderUpwardSummary() {
    if (!this._isUpwardMode) return nothing;
    if (!this._hasUpwardActions) return nothing;

    const source = this.parentBase || '\u2014';
    const target = this.site || '\u2014';

    if (this.isSinglePage) {
      const page = this.pages[0];
      const pagePath = page?.path || '';
      const overrides = this.getPageOverrides(pagePath);
      const selfEntry = overrides.find((o) => o.site === this.site);
      const hasOverride = selfEntry?.hasOverride === true;
      const inheritedFrom = selfEntry?.inheritedFrom || null;
      const effectiveSource = selfEntry?.sourceSite || this.parentBase || source;
      let overrideText = 'No';
      if (hasOverride) overrideText = 'Yes';
      else if (inheritedFrom) overrideText = `No \u2014 inherited from ${inheritedFrom}`;
      return html`
        <div class="upward-summary">
          <div class="summary-row"><span class="summary-label">Source</span><span class="summary-value">${effectiveSource}${pagePath}</span></div>
          <div class="summary-row"><span class="summary-label">Target</span><span class="summary-value">${target}${pagePath}</span></div>
          <div class="summary-row"><span class="summary-label">Local override</span><span class="summary-value">${overrideText}</span></div>
        </div>
      `;
    }

    const overriddenCount = this.pages.reduce((acc, p) => {
      const ov = this.getPageOverrides(p.path).find((o) => o.site === this.site);
      return acc + (ov?.hasOverride ? 1 : 0);
    }, 0);
    return html`
      <div class="upward-summary">
        <div class="summary-row"><span class="summary-label">Source</span><span class="summary-value">${source}</span></div>
        <div class="summary-row"><span class="summary-label">Target</span><span class="summary-value">${target}</span></div>
        <div class="summary-row"><span class="summary-label">Pages with local override</span><span class="summary-value">${overriddenCount} of ${this.pages.length}</span></div>
      </div>
    `;
  }

  // ──────────────────────────────────────
  // Render: Footer (cascade toggle + Apply)
  // ──────────────────────────────────────

  renderFooter(applyOnClick, applyDisabled) {
    return html`
      <div class="form-actions">
        ${this._showDescendantsToggle ? html`
          <label class="footer-cascade">
            <input type="checkbox"
              .checked=${this._includeDescendants}
              ?disabled=${this._busy}
              @change=${(e) => {
    this._includeDescendants = e.target.checked;
    this._resetExecution();
  }} />
            <span>Cascade to ${this._totalDescendants} nested site${this._totalDescendants !== 1 ? 's' : ''}</span>
          </label>
        ` : html`<span class="footer-spacer"></span>`}
        <sl-button variant="primary"
          @click=${applyOnClick}
          ?disabled=${applyDisabled}>
          Apply
        </sl-button>
      </div>
    `;
  }

  // ──────────────────────────────────────
  // Render: Confirm dialog
  // ──────────────────────────────────────

  renderConfirm() {
    if (!this._confirmAction) return nothing;
    return html`
      <div class="alert-dialog caution" role="alertdialog">
        <h2 class="alert-dialog-heading">
          <svg class="caution-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
            <path d="M8 2 L14.5 13 H1.5 Z" />
            <line x1="8" y1="6" x2="8" y2="9.5" />
            <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
          </svg>
          Confirm action
        </h2>
        <p class="alert-dialog-content">${this._confirmAction.message}</p>
        <div class="alert-dialog-buttons">
          <button class="s2-btn s2-btn-outline" @click=${() => this.cancelConfirm()}>Cancel</button>
          <button class="s2-btn s2-btn-confirm" @click=${() => this._confirmAction.onConfirm()}>Confirm</button>
        </div>
      </div>
    `;
  }

  // ──────────────────────────────────────
  // Render: Single-page mode
  // ──────────────────────────────────────

  renderSinglePage() {
    const page = this.pages[0];
    const overrides = this.getPageOverrides(page.path);
    // Satellite grids only show child sites; exclude the self-entry that the
    // satellite/dual upward path injects into the same overrides map.
    const satEntries = overrides.filter((o) => o.site !== this.site);
    const inherited = satEntries.filter((o) => !o.hasOverride);
    const custom = satEntries.filter((o) => o.hasOverride);

    return html`
      <div class="panel">
        <div class="panel-header">
          <h3 class="panel-title">${page.name}</h3>
        </div>
        <div class="panel-body">
          ${this.renderBreadcrumb()}
          ${this.renderDirectionSwitch()}
          ${this._isLocalUpwardEmpty ? this.renderLocalUpwardEmpty() : html`
          <div class="action-row">
            ${this.renderPicker(
    'action',
    'Action',
    this._globalAction,
    this._isUpwardMode ? this._actionOptionsForPage(page) : this._actionOptions,
    (v) => { this._globalAction = v; this._resetExecution(); },
  )}
            ${this._shouldShowSyncPicker(this._globalAction) ? this.renderPicker(
    'syncMode',
    'Sync mode',
    this._globalSyncMode,
    SYNC_OPTIONS,
    (v) => { this._globalSyncMode = v; },
  ) : html`<div class="action-row-spacer"></div>`}
          </div>
          ${this.renderUpwardSummary()}
          `}
          ${this._isUpwardMode ? nothing : this.renderSatelliteGrid(inherited, custom)}
          ${this.renderConfirm()}
          ${this._executing ? this.renderProgress() : nothing}
          ${this.renderFooter(
    () => this.executeSinglePage(),
    this._busy || this._isLocalUpwardEmpty || !this._canApplySingle(page),
  )}
        </div>
      </div>
    `;
  }

  _canApplySingle(page) {
    if (this._isUpwardMode) {
      // Upward: target is self. Some actions only apply to specific
      // categories; verify the row matches before allowing Apply.
      // For bulk per-row Apply, use the row's action; otherwise the panel-wide action.
      const action = (!this.isSinglePage && page)
        ? this.getPageAction(page.path)
        : this._globalAction;
      if (action === 'resume-inheritance') {
        const ov = this.getPageOverrides(page.path).find((o) => o.site === this.site);
        return ov?.hasOverride === true;
      }
      if (action === 'cancel-inheritance') {
        return this._categorizePage(page) === 'inherited';
      }
      return true;
    }
    return this._singleSelectedSats.size > 0
      && this.hasApplicableSats(page?.path, this._globalAction);
  }

  renderSatelliteGrid(inherited, custom) {
    const scope = ACTION_SCOPE[this._globalAction];

    return html`
      <div class="satellite-grid">
        ${inherited.length ? html`
          <div class="satellite-column">
            <div class="column-heading">Inherited</div>
            <ul class="satellite-list">
              ${inherited.map((sat) => this.renderSatRow(sat, scope !== 'inherited'))}
            </ul>
          </div>
        ` : nothing}
        ${custom.length ? html`
          <div class="satellite-column">
            <div class="column-heading">Custom</div>
            <ul class="satellite-list">
              ${custom.map((sat) => this.renderSatRow(sat, scope !== 'custom', true))}
            </ul>
          </div>
        ` : nothing}
      </div>
    `;
  }

  renderSatRow(sat, outOfScope, showEdit = false) {
    const statusEntry = this._taskStatuses.get(`${this.pages[0]?.path}:${sat.site}`);
    const info = this.satellites?.[sat.site] || {};
    const descCount = info.descendantCount || 0;
    return html`
      <li class="sat-row ${outOfScope ? 'out-of-scope' : ''}">
        <label>
          <input type="checkbox"
            .checked=${this._singleSelectedSats.has(sat.site)}
            ?disabled=${outOfScope || this._busy}
            @change=${() => this.toggleSingleSat(sat.site)} />
          <span>${sat.label}</span>
          ${descCount > 0 ? html`
            <span class="descendant-badge" title="${descCount} descendant site${descCount === 1 ? '' : 's'}">+${descCount}</span>
          ` : nothing}
        </label>
        ${statusEntry ? this.statusIcon(statusEntry.status) : nothing}
        ${showEdit ? html`
          <a class="edit-link" href="https://da.live/edit#/${this.org}/${sat.site}${this.pages[0]?.path?.replace(/\.[^/.]+$/, '')}" target="_blank" title="Open in editor">
            ${EDIT_ICON}
          </a>
        ` : nothing}
      </li>
    `;
  }

  // ──────────────────────────────────────
  // Render: Bulk mode
  // ──────────────────────────────────────

  renderBulk() {
    return html`
      <div class="panel">
        <div class="panel-header">
          <h3 class="panel-title">${this._includedPages.size} of ${this.pages.length} pages selected</h3>
          <span class="panel-subtitle">${this.site}</span>
        </div>
        <div class="panel-body">
          ${this.renderBreadcrumb()}
          ${this.renderDirectionSwitch()}
          ${this._isUpwardMode ? nothing : this.renderSatelliteFilter()}
          ${this._isLocalUpwardEmpty ? this.renderLocalUpwardEmpty() : html`
            ${this.renderGlobalActionBar()}
            ${this.renderUpwardSummary()}
            ${this._executing ? this.renderProgress() : this.renderPageTable()}
          `}
          ${this.renderConfirm()}
          ${this.renderFooter(
    () => this.executeAll(),
    this._busy
      || this._isLocalUpwardEmpty
      || this._includedPages.size === 0
      || !this._canApplyBulk(),
  )}
        </div>
      </div>
    `;
  }

  _canApplyBulk() {
    if (this._isUpwardMode) {
      // Upward bulk: each page targets self; allowed if at least one page is applicable.
      return this._activePages.some((p) => this._canApplySingle(p));
    }
    return this._selectedSats.size > 0 && this._hasAnyApplicablePages;
  }

  renderSatelliteFilter() {
    const sats = Object.entries(this.satellites || {});
    if (sats.length <= 1) return nothing;

    return html`
      <div class="satellite-filter">
        <span class="satellite-filter-label">Satellites</span>
        ${sats.map(([satSite, info]) => {
    const dc = info.descendantCount || 0;
    return html`
            <label class="sat-tag ${this._selectedSats.has(satSite) ? 'active' : ''}">
              <input type="checkbox"
                .checked=${this._selectedSats.has(satSite)}
                @change=${() => this.toggleSatFilter(satSite)} />
              ${info.label || satSite}
              ${dc > 0 ? html`<span class="descendant-badge" title="${dc} descendant site${dc === 1 ? '' : 's'}">+${dc}</span>` : nothing}
            </label>
          `;
  })}
      </div>
    `;
  }

  renderGlobalActionBar() {
    return html`
      <div class="action-row">
        ${this.renderPicker(
    'globalAction',
    'Action for all',
    this._globalAction,
    this._actionOptions,
    (v) => {
      this._globalAction = v;
      this._pageActions = new Map();
      this._pageSyncModes = new Map();
      this._resetExecution();
    },
  )}
        ${this._shouldShowSyncPicker(this._globalAction) ? this.renderPicker(
    'globalSyncMode',
    'Sync mode',
    this._globalSyncMode,
    SYNC_OPTIONS,
    (v) => { this._globalSyncMode = v; },
  ) : html`<div class="action-row-spacer"></div>`}
      </div>
    `;
  }

  renderPageTable() {
    const allChecked = this._includedPages.size === this.pages.length;
    const someChecked = this._includedPages.size > 0 && !allChecked;
    const showOverrides = !this._isUpwardMode && this._hasDownwardActions;
    return html`
      <table class="page-table">
        <colgroup>
          <col style="width:36px">
          <col style="width:30%">
          ${showOverrides ? html`<col style="width:100px">` : nothing}
          <col>
          <col style="width:80px">
        </colgroup>
        <thead>
          <tr>
            <th>
              <input type="checkbox"
                .checked=${allChecked}
                .indeterminate=${someChecked}
                @change=${() => this.toggleAllPages()} />
            </th>
            <th>Page</th>
            ${showOverrides ? html`<th>Overrides</th>` : nothing}
            <th>Action</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${this.pages.map((page) => this.renderPageRow(page, showOverrides))}
        </tbody>
      </table>
    `;
  }

  renderPageRow(page, showOverrides) {
    const isExpanded = this._expandedRows.has(page.path);
    const summary = this.getOverrideSummary(page.path);
    const action = this.getPageAction(page.path);

    return html`
      <tr>
        <td class="cell-check">
          <input type="checkbox"
            .checked=${this._includedPages.has(page.path)}
            @change=${() => this.togglePageInclude(page.path)} />
        </td>
        <td class="cell-name">
          <div class="page-name-cell"
            @click=${() => this.toggleRow(page.path)}>
            <span class="page-name">${page.name}</span>
            ${showOverrides ? html`
              <svg class="expand-toggle ${isExpanded ? 'expanded' : ''}"
                viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5">
                <polyline points="3,1 7,5 3,9"/>
              </svg>
            ` : nothing}
          </div>
        </td>
        ${showOverrides ? html`
          <td class="cell-overrides">
            <span class="override-badge">
              ${summary.inherited} inherited
            </span>
            ${summary.custom > 0 ? html`
              <span class="override-badge">
                ${summary.custom} custom
              </span>
            ` : nothing}
          </td>
        ` : nothing}
        <td class="cell-action">
          <div class="page-action-pickers">
            ${this.renderPicker(
    `page-${page.path}`,
    '',
    action,
    this._actionOptionsForPage(page),
    (v) => this.setPageAction(page.path, v),
  )}
            <div class="sync-picker-slot ${this._shouldShowSyncPicker(action) ? '' : 'hidden'}">
              ${this.renderPicker(
    `page-sync-${page.path}`,
    '',
    this.getPageSyncMode(page.path),
    SYNC_OPTIONS,
    (v) => this.setPageSyncMode(page.path, v),
  )}
            </div>
          </div>
        </td>
        <td class="cell-apply">
          <div class="row-actions">
            <sl-button @click=${() => this.executeRow(page)}
              ?disabled=${this._busy || !this._canApplySingle(page)}>Apply</sl-button>
          </div>
        </td>
      </tr>
      ${isExpanded && !this._isUpwardMode ? this.renderExpandedRow(page) : nothing}
    `;
  }

  renderExpandedRow(page) {
    const overrides = this.getPageOverrides(page.path)
      .filter((o) => this._selectedSats.has(o.site));
    const inherited = overrides.filter((o) => !o.hasOverride);
    const custom = overrides.filter((o) => o.hasOverride);
    const colCount = (!this._isUpwardMode && this._hasDownwardActions) ? 5 : 4;

    return html`
      <tr class="expand-row">
        <td colspan="${colCount}">
          <div class="expand-content">
            ${inherited.length ? html`
              <div class="expand-column">
                <div class="expand-heading">Inherited</div>
                <ul class="expand-list">
                  ${inherited.map((sat) => html`
                    <li>
                      ${this.statusIcon(this._taskStatuses.get(`${page.path}:${sat.site}`)?.status)}
                      ${sat.label}
                    </li>
                  `)}
                </ul>
              </div>
            ` : nothing}
            ${custom.length ? html`
              <div class="expand-column">
                <div class="expand-heading">Custom</div>
                <ul class="expand-list">
                  ${custom.map((sat) => html`
                    <li>
                      ${this.statusIcon(this._taskStatuses.get(`${page.path}:${sat.site}`)?.status)}
                      ${sat.label}
                      <a class="edit-link" href="https://da.live/edit#/${this.org}/${sat.site}${page.path.replace(/\.[^/.]+$/, '')}" target="_blank" title="Open in editor">
                        ${EDIT_ICON}
                      </a>
                    </li>
                  `)}
                </ul>
              </div>
            ` : nothing}
          </div>
        </td>
      </tr>
    `;
  }

  // ──────────────────────────────────────
  // Render: Progress view
  // ──────────────────────────────────────

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
    const [pagePath, satSite] = key.split(':');
    const pageName = pagePath.split('/').pop().replace(/\.[^/.]+$/, '');
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

  // ──────────────────────────────────────
  // Main render
  // ──────────────────────────────────────

  render() {
    if (!this.pages?.length) return nothing;

    if (this.isSinglePage) return this.renderSinglePage();
    return this.renderBulk();
  }
}

customElements.define('msm-action-panel', MsmActionPanel);
