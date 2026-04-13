/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console, class-methods-use-this */
import { LitElement, html, nothing } from 'da-lit';
import { executeBulkAction } from './api.js';

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
const SPINNER_ICON = html`<svg class="result-icon pending" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 1a7 7 0 1 0 7 7" stroke-linecap="round"/></svg>`;
const SUCCESS_ICON = html`<svg class="result-icon success" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,8 7,12 13,4"/></svg>`;
const ERROR_ICON = html`<svg class="result-icon error" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>`;
const EDIT_ICON = html`<svg viewBox="0 0 20 20"><path fill="currentColor" d="M18.16 15.62V4.12c0-1.24-1.01-2.25-2.25-2.25H4.41c-1.24 0-2.25 1.01-2.25 2.25v3.72c0 .41.34.75.75.75s.75-.34.75-.75v-3.72c0-.41.34-.75.75-.75h11.5c.41 0 .75.34.75.75v11.5c0 .41-.34.75-.75.75h-3.81c-.41 0-.75.34-.75.75s.34.75.75.75h3.81c1.24 0 2.25-1.01 2.25-2.25z"/><path fill="currentColor" d="M11.16 9.62v4.24c0 .41-.34.75-.75.75s-.75-.34-.75-.75v-2.43l-6.47 6.47c-.15.15-.34.22-.53.22s-.38-.07-.53-.22a.754.754 0 010-1.06l6.47-6.47H6.17c-.41 0-.75-.34-.75-.75s.34-.75.75-.75h4.24c.41 0 .75.34.75.75z"/></svg>`;

const BASE_ACTION_OPTIONS = [
  {
    heading: 'Inherited sites',
    items: [
      { value: 'preview', label: 'Preview' },
      { value: 'publish', label: 'Publish' },
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

const SAT_ACTION_OPTIONS = [
  { value: 'preview', label: 'Preview' },
  { value: 'publish', label: 'Publish' },
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

const ALL_ACTION_ITEMS = [
  ...BASE_ACTION_OPTIONS.flatMap((g) => g.items),
  ...SAT_ACTION_OPTIONS,
];

function getActionLabel(value) {
  return ALL_ACTION_ITEMS.find((i) => i.value === value)?.label || value;
}

class MsmActionPanel extends LitElement {
  static properties = {
    org: { type: String },
    role: { type: String },
    site: { type: String },
    pages: { attribute: false },
    satellites: { attribute: false },
    overrides: { attribute: false },
    isSinglePage: { type: Boolean },
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
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sl, sheet, buttons].filter(Boolean);
    this._globalAction = 'preview';
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

  get _actionOptions() {
    return this._isSatellite ? SAT_ACTION_OPTIONS : BASE_ACTION_OPTIONS;
  }

  // ── Satellite filter ──

  toggleSatFilter(satSite) {
    const next = new Set(this._selectedSats);
    if (next.has(satSite)) next.delete(satSite);
    else next.add(satSite);
    this._selectedSats = next;
  }

  toggleSingleSat(satSite) {
    const next = new Set(this._singleSelectedSats);
    if (next.has(satSite)) next.delete(satSite);
    else next.add(satSite);
    this._singleSelectedSats = next;
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

  getFilteredSatellites() {
    return Object.entries(this.satellites || {}).filter(([satSite]) => (
      this._selectedSats.has(satSite)
    )).reduce((acc, [s, info]) => { acc[s] = info; return acc; }, {});
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
    const parts = Object.entries(counts).map(
      ([a, c]) => `${getActionLabel(a)} ${c} page${c > 1 ? 's' : ''} (${ACTION_SCOPE[a]} sites only)`,
    );
    const satCount = this._selectedSats.size;
    return `${parts.join(', ')} across ${satCount} satellite${satCount !== 1 ? 's' : ''}. Satellites that don't match the action scope will be skipped. Continue?`;
  }

  cancelConfirm() {
    this._confirmAction = null;
  }

  async doExecuteAll() {
    this._confirmAction = null;
    this._executing = true;
    this._busy = true;
    this._taskStatuses = new Map();

    const actionGroups = this._activePages.reduce((acc, page) => {
      const action = this.getPageAction(page.path);
      const syncMode = action === 'sync' ? this.getPageSyncMode(page.path) : '';
      const key = syncMode ? `${action}:${syncMode}` : action;
      if (!acc.has(key)) acc.set(key, { action, syncMode, pages: [] });
      acc.get(key).pages.push(page);
      return acc;
    }, new Map());

    const statusCallback = (key, status, error) => {
      const next = new Map(this._taskStatuses);
      next.set(key, { status, error });
      this._taskStatuses = next;
    };

    const groupEntries = [...actionGroups.values()];
    const filteredSats = this.getFilteredSatellites();

    await groupEntries.reduce((chain, { action, syncMode, pages }) => chain.then(() => {
      const scope = this._isSatellite ? null : ACTION_SCOPE[action];
      return executeBulkAction({
        org: this.org,
        baseSite: this.site,
        pages,
        satellites: filteredSats,
        action,
        syncMode: syncMode || undefined,
        scope,
        overrides: this.overrides,
        onPageStatus: statusCallback,
      });
    }), Promise.resolve());

    this._busy = false;
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

    this.doExecuteSingle(page, action);
  }

  async doExecuteSingle(page, action, satSet, syncMode) {
    this._confirmAction = null;
    this._executing = true;
    this._busy = true;
    this._taskStatuses = new Map();

    const activeSats = satSet || this._singleSelectedSats;
    const sats = Object.entries(this.satellites || {})
      .filter(([s]) => activeSats.has(s))
      .reduce((acc, [s, info]) => { acc[s] = info; return acc; }, {});

    const resolvedSyncMode = syncMode || this._globalSyncMode;
    const scope = this._isSatellite ? null : ACTION_SCOPE[action];

    await executeBulkAction({
      org: this.org,
      baseSite: this.site,
      pages: [page],
      satellites: sats,
      action,
      syncMode: action === 'sync' || action === 'sync-from-base'
        ? resolvedSyncMode : undefined,
      scope,
      overrides: this.overrides,
      onPageStatus: (key, status, error) => {
        const next = new Map(this._taskStatuses);
        next.set(key, { status, error });
        this._taskStatuses = next;
      },
    });

    this._busy = false;
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
    this.doExecuteSingle(page, action, this._selectedSats, syncMode);
  }

  // ── Status icon helper ──

  statusIcon(status) {
    if (status === 'pending') return SPINNER_ICON;
    if (status === 'success') return SUCCESS_ICON;
    if (status === 'error') return ERROR_ICON;
    return nothing;
  }

  // ── Progress stats ──

  get _progressStats() {
    return [...this._taskStatuses.values()].reduce((acc, { status }) => {
      acc.total += 1;
      if (status === 'success') { acc.done += 1; acc.success += 1; }
      if (status === 'error') { acc.done += 1; acc.error += 1; }
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
                    ${group.items.map((opt) => html`
                      <li class="picker-item ${opt.value === value ? 'selected' : ''}"
                        @click=${() => this.selectPickerOption(name, opt.value, setter)}>
                        ${CHECK_ICON}
                        ${opt.label}
                      </li>
                    `)}
                  `;
    }
    return html`
                  <li class="picker-item ${group.value === value ? 'selected' : ''}"
                    @click=${() => this.selectPickerOption(name, group.value, setter)}>
                    ${CHECK_ICON}
                    ${group.label}
                  </li>
                `;
  })}
            </ul>
          ` : nothing}
        </div>
      </div>
    `;
  }

  // ──────────────────────────────────────
  // Render: Confirm dialog
  // ──────────────────────────────────────

  renderConfirm() {
    if (!this._confirmAction) return nothing;
    return html`
      <div class="alert-dialog" role="alertdialog">
        <h2 class="alert-dialog-heading">Confirm action</h2>
        <p class="alert-dialog-content">${this._confirmAction.message}</p>
        <div class="alert-dialog-buttons">
          <button class="s2-btn s2-btn-outline" @click=${() => this.cancelConfirm()}>Cancel</button>
          <button class="s2-btn s2-btn-negative" @click=${() => this._confirmAction.onConfirm()}>Confirm</button>
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
    const inherited = overrides.filter((o) => !o.hasOverride);
    const custom = overrides.filter((o) => o.hasOverride);

    return html`
      <div class="panel">
        <div class="panel-header">
          <h3 class="panel-title">${page.name}</h3>
        </div>
        <div class="panel-body">
          <div class="action-row">
            ${this.renderPicker(
    'action',
    'Action',
    this._globalAction,
    this._actionOptions,
    (v) => { this._globalAction = v; },
  )}
            ${this._globalAction === 'sync' ? this.renderPicker(
    'syncMode',
    'Sync mode',
    this._globalSyncMode,
    SYNC_OPTIONS,
    (v) => { this._globalSyncMode = v; },
  ) : nothing}
          </div>
          ${this._isSatellite ? nothing : this.renderSatelliteGrid(inherited, custom)}
          ${this.renderConfirm()}
          ${this._executing ? this.renderProgress() : nothing}

          <div class="form-actions">
            <sl-button variant="primary"
              @click=${() => this.executeSinglePage()}
              ?disabled=${this._busy || this._singleSelectedSats.size === 0
    || !this.hasApplicableSats(this.pages[0]?.path, this._globalAction)}>
              Apply
            </sl-button>
          </div>
        </div>
      </div>
    `;
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
    return html`
      <li class="sat-row ${outOfScope ? 'out-of-scope' : ''}">
        <label>
          <input type="checkbox"
            .checked=${this._singleSelectedSats.has(sat.site)}
            ?disabled=${outOfScope || this._busy}
            @change=${() => this.toggleSingleSat(sat.site)} />
          <span>${sat.label}</span>
        </label>
        ${statusEntry ? this.statusIcon(statusEntry.status) : nothing}
        ${showEdit ? html`
          <a class="edit-link" href="https://da.live/edit#/${this.org}/${sat.site}${this.pages[0]?.path?.replace('.html', '')}" target="_blank" title="Open in editor">
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
          ${this._isSatellite ? nothing : this.renderSatelliteFilter()}
          ${this.renderGlobalActionBar()}
          ${this._executing ? this.renderProgress() : this.renderPageTable()}
          ${this.renderConfirm()}
          <div class="form-actions">
            <sl-button variant="primary"
              @click=${() => this.executeAll()}
              ?disabled=${this._busy || this._selectedSats.size === 0 || this._includedPages.size === 0}>
              Apply All
            </sl-button>
          </div>
        </div>
      </div>
    `;
  }

  renderSatelliteFilter() {
    const sats = Object.entries(this.satellites || {});
    if (sats.length <= 1) return nothing;

    return html`
      <div class="satellite-filter">
        <span class="satellite-filter-label">Satellites</span>
        ${sats.map(([satSite, info]) => html`
          <label class="sat-tag ${this._selectedSats.has(satSite) ? 'active' : ''}">
            <input type="checkbox"
              .checked=${this._selectedSats.has(satSite)}
              @change=${() => this.toggleSatFilter(satSite)} />
            ${info.label || satSite}
          </label>
        `)}
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
    },
  )}
        ${this._globalAction === 'sync' ? this.renderPicker(
    'globalSyncMode',
    'Sync mode',
    this._globalSyncMode,
    SYNC_OPTIONS,
    (v) => { this._globalSyncMode = v; },
  ) : nothing}
      </div>
    `;
  }

  renderPageTable() {
    const allChecked = this._includedPages.size === this.pages.length;
    const someChecked = this._includedPages.size > 0 && !allChecked;
    return html`
      <table class="page-table">
        <colgroup>
          <col style="width:36px">
          <col style="width:30%">
          ${this._isSatellite ? nothing : html`<col style="width:100px">`}
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
            ${this._isSatellite ? nothing : html`<th>Overrides</th>`}
            <th>Action</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${this.pages.map((page) => this.renderPageRow(page))}
        </tbody>
      </table>
    `;
  }

  renderPageRow(page) {
    const isExpanded = this._expandedRows.has(page.path);
    const summary = this.getOverrideSummary(page.path);
    const action = this.getPageAction(page.path);
    const hasCustomAction = this._pageActions.has(page.path);

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
            ${this._isSatellite ? nothing : html`
              <svg class="expand-toggle ${isExpanded ? 'expanded' : ''}"
                viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5">
                <polyline points="3,1 7,5 3,9"/>
              </svg>
            `}
          </div>
        </td>
        ${this._isSatellite ? nothing : html`
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
        `}
        <td class="cell-action">
          <div class="page-action-pickers">
            ${this.renderPicker(
    `page-${page.path}`,
    '',
    action,
    this._actionOptions,
    (v) => this.setPageAction(page.path, v),
  )}
            <div class="sync-picker-slot ${action !== 'sync' ? 'hidden' : ''}">
              ${this.renderPicker(
    `page-sync-${page.path}`,
    '',
    this.getPageSyncMode(page.path),
    SYNC_OPTIONS,
    (v) => this.setPageSyncMode(page.path, v),
  )}
            </div>
          </div>
          ${hasCustomAction ? html`<span style="font-size:11px;color:var(--s2-orange-700)">custom</span>` : nothing}
        </td>
        <td class="cell-apply">
          <div class="row-actions">
            <sl-button @click=${() => this.executeRow(page)}
              ?disabled=${this._busy || !this.hasApplicableSats(page.path, action)}>Apply</sl-button>
          </div>
        </td>
      </tr>
      ${isExpanded ? this.renderExpandedRow(page) : nothing}
    `;
  }

  renderExpandedRow(page) {
    const overrides = this.getPageOverrides(page.path)
      .filter((o) => this._selectedSats.has(o.site));
    const inherited = overrides.filter((o) => !o.hasOverride);
    const custom = overrides.filter((o) => o.hasOverride);

    return html`
      <tr class="expand-row">
        <td colspan="${this._isSatellite ? 4 : 5}">
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
                      <a class="edit-link" href="https://da.live/edit#/${this.org}/${sat.site}${page.path.replace('.html', '')}" target="_blank" title="Open in editor">
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
    const pageName = pagePath.split('/').pop().replace('.html', '');
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
