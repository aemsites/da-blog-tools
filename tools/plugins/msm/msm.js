/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console */
/* eslint-disable class-methods-use-this */
import { LitElement, html, nothing } from 'da-lit';
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import {
  getSiteConfig,
  getSubtreeSatellites,
  isPageLocal,
  checkOverrides,
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

const STATUS = { pending: 'pending', success: 'success', error: 'error' };
const SYNC_MODE = { override: 'override', merge: 'merge' };

const RECURSIVE_ACTIONS = new Set(['preview', 'publish']);
const SYNC_ACTIONS = new Set(['sync', 'sync-from-base']);
const UPWARD_ACTIONS = new Set(['sync-from-base', 'resume-inheritance']);

const ACTION_SCOPE = {
  preview: 'inherited',
  publish: 'inherited',
  break: 'inherited',
  sync: 'custom',
  reset: 'custom',
};

const MSM_APP_URL = 'https://da.live/app/aemsites/da-blog-tools/tools/apps/msm/msm';
const ICON_BASE = './img';
const NX = 'https://da.live/nx';

let nexter = null;
let sl = null;
let styles = null;
let buttons = null;
try {
  const [{ default: getStyle }, { loadStyle }] = await Promise.all([
    import(`${NX}/utils/styles.js`),
    import(`${NX}/scripts/nexter.js`),
  ]);
  await Promise.all([
    loadStyle(`${NX}/styles/nexter.css`),
    loadStyle(`${NX}/public/sl/styles.css`),
  ]);
  await import(`${NX}/public/sl/components.js`);
  [nexter, sl, styles, buttons] = await Promise.all([
    getStyle(`${NX}/styles/nexter.css`),
    getStyle(`${NX}/public/sl/styles.css`),
    getStyle(import.meta.url),
    getStyle(`${NX}/styles/buttons.css`),
  ]);
} catch (e) {
  console.warn('[MSM Plugin] Failed to load sl/nexter styles:', e);
}
try {
  await import('./vendor/se/components.js');
} catch (e) {
  console.warn(`[MSM Plugin] Failed to load vendored se components: ${e.message}. `
    + 'Falling back to native <select>.');
}

class DaMsm extends LitElement {
  static properties = {
    details: { attribute: false },
    _satellites: { state: true },
    _selected: { state: true },
    _loading: { state: true },
    _busy: { state: true },
    _confirmAction: { state: true },
    _action: { state: true },
    _syncMode: { state: true },
    _asBase: { state: true },
    _asSatellite: { state: true },
    _hasOverride: { state: true },
    _satStatus: { state: true },
    _showAdvanced: { state: true },
    _includeDescendants: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [nexter, sl, buttons, styles].filter(Boolean);
    this._loading = 'Loading\u2026';
    this._selected = new Set();
    this._action = 'preview';
    this._syncMode = SYNC_MODE.merge;
    this._busy = false;
    this._showAdvanced = false;
    this._includeDescendants = true;
    this.loadConfig();
  }

  updated(changedProperties) {
    if (changedProperties.has('_showAdvanced') && this._showAdvanced) {
      requestAnimationFrame(() => {
        const panel = this.shadowRoot?.querySelector('.advanced-content');
        panel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
  }

  async loadConfig() {
    const { org, site, path } = this.details;
    this._loading = 'Loading configuration\u2026';

    const config = await getSiteConfig(org, site);

    if (!config) {
      this._satellites = [];
      this._loading = undefined;
      return;
    }

    this._asBase = config.asBase;
    this._asSatellite = config.asSatellite;

    if (this._asSatellite) {
      this._hasOverride = await isPageLocal(org, site, path);
    }

    if (this._asBase) {
      this._loading = 'Checking overrides\u2026';
      const results = await checkOverrides(org, this._asBase.satellites, path);
      this._satellites = results.map((sat) => ({ ...sat, status: undefined }));
    }

    if (!this._asBase && this._asSatellite) {
      this._action = 'sync-from-base';
    }

    this._seedSelectionForAction(this._action);

    this._loading = undefined;
  }

  get _inherited() {
    return this._satellites?.filter((s) => !s.hasOverride) || [];
  }

  get _custom() {
    return this._satellites?.filter((s) => s.hasOverride) || [];
  }

  get _directTargets() {
    const scope = ACTION_SCOPE[this._action];
    const pool = scope === 'custom' ? this._custom : this._inherited;
    return pool.filter((s) => this._selected.has(s.site));
  }

  get _isUpwardMode() {
    return UPWARD_ACTIONS.has(this._action);
  }

  get _isSyncMode() {
    return SYNC_ACTIONS.has(this._action);
  }

  get _hasDualRole() {
    return !!(this._asBase && this._asSatellite);
  }

  get _isSatelliteOnly() {
    return !!(this._asSatellite && !this._asBase);
  }

  get _showUpwardView() {
    return this._isSatelliteOnly || (this._hasDualRole && this._isUpwardMode);
  }

  get _canApplyDownward() {
    return !this._busy && this._directTargets.length > 0;
  }

  _isInScope(sat) {
    const scope = ACTION_SCOPE[this._action];
    if (!scope) return false;
    return scope === 'custom' ? !!sat.hasOverride : !sat.hasOverride;
  }

  _seedSelectionForAction(action) {
    if (!this._satellites) {
      this._selected = new Set();
      return;
    }
    const scope = ACTION_SCOPE[action];
    if (!scope) {
      this._selected = new Set();
      return;
    }
    const pool = scope === 'custom' ? this._custom : this._inherited;
    this._selected = new Set(pool.map((s) => s.site));
  }

  _toggleAdvanced() {
    const opening = !this._showAdvanced;
    if (opening) {
      if (RECURSIVE_ACTIONS.has(this._action)) {
        this.onActionChange('break');
      }
    } else if (!RECURSIVE_ACTIONS.has(this._action)) {
      this.onActionChange('preview');
    }
    this._showAdvanced = opening;
  }

  _setIncludeDescendants(value) {
    this._includeDescendants = !!value;
    this.clearStatuses();
  }

  _getAppDeepLink() {
    const {
      org, site, path,
    } = this.details;
    const params = new URLSearchParams({ org, site, path });
    //TODO: remove this once msm-app branch is merged to main
    params.set('ref', 'msm-app');
    return `${MSM_APP_URL}?${params.toString()}`;
  }

  // ── Handlers ────────────────────────────────────────────────────────

  handleToggle(site) {
    const next = new Set(this._selected);
    if (next.has(site)) next.delete(site);
    else next.add(site);
    this._selected = next;
  }

  clearStatuses() {
    this._satellites = this._satellites?.map((s) => ({ ...s, status: undefined }));
  }

  updateSatStatus(site, status) {
    this._satellites = this._satellites.map(
      (s) => (s.site === site ? { ...s, status } : s),
    );
  }

  onActionChange(value) {
    this._action = value;
    this.clearStatuses();
    this._satStatus = undefined;
    this._seedSelectionForAction(value);
  }

  onDirectionToggle(toUpward) {
    let nextAction;
    if (toUpward) {
      nextAction = 'sync-from-base';
    } else if (this._showAdvanced) {
      nextAction = 'break';
    } else {
      nextAction = 'preview';
    }
    this.onActionChange(nextAction);
  }

  async runQuickAction(action) {
    if (this._busy) return;
    const oldScope = ACTION_SCOPE[this._action];
    const newScope = ACTION_SCOPE[action];
    this._action = action;
    this.clearStatuses();
    this._satStatus = undefined;
    if (oldScope !== newScope || (newScope && this._selected.size === 0)) {
      this._seedSelectionForAction(action);
    }
    await this.apply();
  }

  async apply() {
    if (this._isUpwardMode) {
      this.applySatelliteAction();
      return;
    }

    if (!this._canApplyDownward) return;

    if (this._action === 'reset') {
      const names = this._directTargets.map((s) => s.label).join(', ');
      this._confirmAction = { message: `Discard local copy on ${names}? Removes the satellite override.` };
      return;
    }

    await this.runAction(this._action);
  }

  cancelConfirm() {
    this._confirmAction = undefined;
  }

  async doConfirmedAction() {
    const { confirmedAction } = this._confirmAction || {};
    this._confirmAction = undefined;
    if (confirmedAction === 'resume-inheritance') {
      await this.runSatelliteAction('resume-inheritance');
    } else if (confirmedAction === 'preview' || confirmedAction === 'publish') {
      await this.runAction(confirmedAction);
    } else {
      await this.runAction('reset');
    }
  }

  async runAction(action) {
    this._busy = true;
    const { org, site, path } = this.details;

    const directTargets = this._directTargets;

    directTargets.forEach((s) => this.updateSatStatus(s.site, STATUS.pending));

    switch (action) {
      case 'preview':
      case 'publish': {
        const fn = action === 'publish' ? publishSatellite : previewSatellite;
        const subtreeMap = new Map();
        await Promise.all(directTargets.map(async (target) => {
          const subtree = this._includeDescendants
            ? await getSubtreeSatellites(org, target.site)
            : [];
          subtreeMap.set(
            target.site,
            [target.site, ...subtree.map((s) => s.site)],
          );
        }));
        const sitesToCall = [...new Set([...subtreeMap.values()].flat())];
        const results = await Promise.allSettled(
          sitesToCall.map((satSite) => fn(org, satSite, path)),
        );
        const statusBySite = new Map();
        results.forEach((r, idx) => {
          const ok = r.status === 'fulfilled' && !r.value?.error;
          statusBySite.set(sitesToCall[idx], ok);
        });
        directTargets.forEach((target) => {
          const sites = subtreeMap.get(target.site) || [target.site];
          const allOk = sites.every((s) => statusBySite.get(s) === true);
          this.updateSatStatus(target.site, allOk ? STATUS.success : STATUS.error);
        });
        break;
      }

      case 'break':
        await Promise.allSettled(directTargets.map(async (sat) => {
          const result = await createOverride(org, site, sat.site, path);
          if (result.error) {
            this.updateSatStatus(sat.site, STATUS.error);
          } else {
            this._satellites = this._satellites.map(
              (s) => (s.site === sat.site
                ? { ...s, hasOverride: true, status: STATUS.success }
                : s),
            );
          }
        }));
        break;

      case 'sync':
        if (this._syncMode === SYNC_MODE.merge) {
          await Promise.allSettled(directTargets.map(async (sat) => {
            const result = await mergeFromBase(org, site, sat.site, path);
            if (result.error) {
              this.updateSatStatus(sat.site, STATUS.error);
            } else {
              this._satellites = this._satellites.map(
                (s) => (s.site === sat.site
                  ? { ...s, editUrl: result.editUrl, status: STATUS.success }
                  : s),
              );
            }
          }));
        } else {
          await Promise.allSettled(directTargets.map(async (sat) => {
            const result = await createOverride(org, site, sat.site, path);
            this.updateSatStatus(sat.site, result.error ? STATUS.error : STATUS.success);
          }));
        }
        break;

      case 'reset':
        await Promise.allSettled(directTargets.map(async (sat) => {
          const pageStatus = await getSatellitePageStatus(org, sat.site, path);
          const result = await deleteOverride(org, sat.site, path);
          if (result.error) {
            this.updateSatStatus(sat.site, STATUS.error);
          } else {
            if (pageStatus.live) {
              await previewSatellite(org, sat.site, path);
              await publishSatellite(org, sat.site, path);
            } else if (pageStatus.preview) {
              await previewSatellite(org, sat.site, path);
            }
            this._satellites = this._satellites.map(
              (s) => (s.site === sat.site
                ? { ...s, hasOverride: false, status: STATUS.success }
                : s),
            );
          }
        }));
        break;

      default:
        break;
    }

    this._selected = new Set();
    this._busy = false;
  }

  applySatelliteAction() {
    if (this._busy) return;

    if (this._action === 'resume-inheritance') {
      this._confirmAction = {
        message: 'Revert to base? This deletes the local copy on this satellite.',
        confirmedAction: 'resume-inheritance',
      };
      return;
    }

    this.runSatelliteAction(this._action);
  }

  async runSatelliteAction(action) {
    this._busy = true;
    this._satStatus = STATUS.pending;
    const { org, site, path } = this.details;
    const baseSite = this._asSatellite?.base;

    try {
      let result;
      if (action === 'sync-from-base') {
        const useMerge = this._hasOverride;
        result = useMerge
          ? await mergeFromBase(org, baseSite, site, path)
          : await createOverride(org, baseSite, site, path);
      } else if (action === 'resume-inheritance') {
        const pageStatus = await getSatellitePageStatus(org, site, path);
        result = await deleteOverride(org, site, path);
        if (!result?.error) {
          if (pageStatus.live) {
            await previewSatellite(org, site, path);
            await publishSatellite(org, site, path);
          } else if (pageStatus.preview) {
            await previewSatellite(org, site, path);
          }
        }
      }

      if (result?.error) {
        this._satStatus = STATUS.error;
      } else {
        this._satStatus = STATUS.success;
        this._hasOverride = action !== 'resume-inheritance';
      }
    } catch {
      this._satStatus = STATUS.error;
    }

    this._busy = false;
  }

  /* -------------------------------------------------- *
   * Render
   * -------------------------------------------------- */

  renderStatusIcon(status) {
    if (!status) return nothing;
    if (status === STATUS.pending) {
      return html`<svg class="result-icon pending" viewBox="0 0 20 20">
        <use href="${ICON_BASE}/S2_Icon_ClockPending_20_N.svg#S2_Icon_ClockPending"/>
      </svg>`;
    }
    if (status === STATUS.success) {
      return html`<svg class="result-icon success" viewBox="0 0 20 20">
        <use href="${ICON_BASE}/S2_Icon_CheckmarkCircle_20_N.svg#S2_Icon_CheckmarkCircle"/>
      </svg>`;
    }
    return html`<svg class="result-icon error" viewBox="0 0 20 20">
      <use href="${ICON_BASE}/S2_Icon_AlertTriangle_20_N.svg#S2_Icon_AlertTriangle"/>
    </svg>`;
  }

  renderConfirm() {
    if (!this._confirmAction) return nothing;
    return html`
      <div class="confirm-box">
        <p>${this._confirmAction.message}</p>
        <div class="confirm-actions">
          <button class="confirm-btn" @click=${() => this.cancelConfirm()}>Cancel</button>
          <button class="confirm-btn danger" @click=${() => this.doConfirmedAction()}>Confirm</button>
        </div>
      </div>`;
  }

  renderBreadcrumb() {
    if (!this._asSatellite) return nothing;

    const chain = [
      ...this._asSatellite.chain,
      { site: this.details.site, label: this.details.site, current: true },
    ];

    return html`
      <div class="crumb-row">
        <span class="crumb-label">Inherits from</span>
        ${chain.map((node, idx) => html`
          ${idx > 0 ? html`<span class="crumb-sep" aria-hidden="true">\u203A</span>` : nothing}
          <span class="crumb-node ${node.current ? 'current' : ''}">${node.label}</span>
        `)}
      </div>`;
  }

  renderPrimaryButtons() {
    if (!this._asBase || this._isUpwardMode) return nothing;

    const inheritedCount = this._inherited.length;
    if (inheritedCount === 0) return nothing;

    const isInheritedScope = ACTION_SCOPE[this._action] === 'inherited';
    const willRunOn = isInheritedScope
      ? this._inherited.filter((s) => this._selected.has(s.site))
      : this._inherited;
    const directCount = willRunOn.length;
    const cascadeCount = this._includeDescendants
      ? willRunOn.reduce((acc, s) => acc + (s.descendantCount || 0), 0)
      : 0;
    const totalCount = directCount + cascadeCount;
    const noSelection = isInheritedScope && directCount === 0;
    const disabled = this._busy || noSelection;

    const directLabel = `${directCount} site${directCount !== 1 ? 's' : ''} following base`;
    const cascadeLabel = cascadeCount > 0
      ? ` + ${cascadeCount} nested = ${totalCount} total`
      : '';
    const countLabel = `${directLabel}${cascadeLabel}`;
    const reason = noSelection ? 'Select at least one site below' : countLabel;
    const previewTitle = `Roll out to preview — ${reason}`;
    const liveTitle = `Roll out to live — ${reason}`;

    return html`
      <div class="primary-buttons">
        <button class="primary-btn fill"
          type="button"
          title=${previewTitle}
          ?disabled=${disabled}
          @click=${() => this.runQuickAction('preview')}>
          <svg class="primary-btn-icon" viewBox="0 0 20 20" aria-hidden="true">
            <use href="${ICON_BASE}/S2_Icon_ExperiencePreview_20_N.svg#S2_Icon_ExperiencePreview"/>
          </svg>
          <span class="primary-btn-label">Roll out to preview</span>
        </button>
        <button class="primary-btn outline"
          type="button"
          title=${liveTitle}
          ?disabled=${disabled}
          @click=${() => this.runQuickAction('publish')}>
          <svg class="primary-btn-icon" viewBox="0 0 20 20" aria-hidden="true">
            <use href="${ICON_BASE}/S2_Icon_Publish_20_N.svg#S2_Icon_Publish"/>
          </svg>
          <span class="primary-btn-label">Roll out to live</span>
        </button>
      </div>`;
  }

  renderSatellitePrimaryButtons() {
    const baseLabel = this._asSatellite?.baseLabel || this._asSatellite?.base || 'base';
    const canRevert = this._hasOverride === true;
    const pullTitle = this._hasOverride
      ? `Merge latest from ${baseLabel} into your local copy`
      : `Copy the page from ${baseLabel} to your site`;
    const revertTitle = `Delete your local copy and follow ${baseLabel} again`;

    return html`
      <div class="primary-buttons">
        <button class="primary-btn fill"
          type="button"
          title=${pullTitle}
          ?disabled=${this._busy}
          @click=${() => this.runQuickAction('sync-from-base')}>
          <svg class="primary-btn-icon" viewBox="0 0 20 20" aria-hidden="true">
            <use href="${ICON_BASE}/S2_Icon_ExperienceAdd_20_N.svg#S2_Icon_Experience_Add"/>
          </svg>
          <span class="primary-btn-label">Pull latest from base</span>
        </button>
        ${canRevert ? html`
          <button class="primary-btn outline"
            type="button"
            title=${revertTitle}
            ?disabled=${this._busy}
            @click=${() => this.runQuickAction('resume-inheritance')}>
            <svg class="primary-btn-icon" viewBox="0 0 20 20" aria-hidden="true">
              <use href="${ICON_BASE}/S2_Icon_Delete_20_N.svg#S2_Icon_Delete"/>
            </svg>
            <span class="primary-btn-label">Revert to base</span>
          </button>
        ` : nothing}
      </div>`;
  }

  renderSatelliteStatusLine() {
    if (!this._asSatellite) return nothing;
    const overrideText = this._hasOverride
      ? 'Yes — has local copy'
      : 'None — following base';
    return html`
      <div class="status-line">
        <span class="status-label">Local override:</span>
        <span class="status-value ${this._hasOverride ? '' : 'muted'}">${overrideText}</span>
        ${this._satStatus ? this.renderStatusIcon(this._satStatus) : nothing}
      </div>`;
  }

  renderSiteChips() {
    return this.renderSatelliteGrid();
  }

  renderSatelliteGrid() {
    if (!this._asBase || this._isUpwardMode) return nothing;
    if (!this._satellites?.length) return nothing;

    const inherited = this._inherited;
    const custom = this._custom;
    if (!inherited.length && !custom.length) return nothing;

    const scope = ACTION_SCOPE[this._action];

    return html`
      <div class="satellite-grid">
        ${inherited.length ? html`
          <div class="satellite-column">
            <div class="column-heading">Following base</div>
            <ul class="satellite-list">
              ${inherited.map((sat) => this.renderSatRow(sat, scope === 'custom'))}
            </ul>
          </div>
        ` : nothing}
        ${custom.length ? html`
          <div class="satellite-column">
            <div class="column-heading">With local copy</div>
            <ul class="satellite-list">
              ${custom.map((sat) => this.renderSatRow(sat, scope === 'inherited', true))}
            </ul>
          </div>
        ` : nothing}
      </div>`;
  }

  renderSatRow(sat, outOfScope, showEdit = false) {
    const inScope = this._isInScope(sat);
    const isSelected = inScope && this._selected.has(sat.site);
    const dc = sat.descendantCount || 0;
    const cascades = inScope
      && RECURSIVE_ACTIONS.has(this._action)
      && this._includeDescendants;
    const dcSuffix = dc === 1 ? '' : 's';
    const dcTitle = cascades
      ? `Also rolls out to ${dc} nested site${dcSuffix}`
      : `${dc} nested site${dcSuffix}`;
    const editUrl = sat.editUrl
      || `https://da.live/edit#/${this.details.org}/${sat.site}${this.details.path}`;

    return html`
      <li class="sat-row ${outOfScope ? 'out-of-scope' : ''} ${sat.status ? `status-${sat.status}` : ''}">
        <label>
          <input type="checkbox"
            .checked=${isSelected}
            ?disabled=${outOfScope || this._busy}
            @change=${() => { if (!outOfScope) this.handleToggle(sat.site); }} />
          <span>${sat.label}</span>
          ${dc > 0 ? html`<span class="descendant-badge" title=${dcTitle}>+${dc}</span>` : nothing}
        </label>
        ${sat.status ? this.renderStatusIcon(sat.status) : nothing}
        ${showEdit ? html`
          <a class="edit-link"
            href=${editUrl}
            target="_blank"
            rel="noopener"
            title="Open in editor"
            aria-label="Open ${sat.label} in editor">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <use href="${ICON_BASE}/S2_Icon_ChevronRight_20_N.svg#S2_Icon_ChevronRight"/>
            </svg>
          </a>
        ` : nothing}
      </li>`;
  }

  renderAdvancedExpander() {
    return html`
      <div class="advanced-section">
        <button class="advanced-toggle"
          type="button"
          aria-expanded=${this._showAdvanced ? 'true' : 'false'}
          @click=${() => this._toggleAdvanced()}>
          <span class="advanced-chevron ${this._showAdvanced ? 'open' : ''}" aria-hidden="true">\u25B8</span>
          More options
        </button>
        ${this._showAdvanced ? html`
          <div class="advanced-content">
            <p class="advanced-hint">Pick which action to apply, then choose the sites in the list above.</p>
            <div class="action-row">
              ${this.renderActionPicker()}
              ${this._isSyncMode ? this.renderSyncModeSelect() : nothing}
            </div>
            ${this.renderAdvancedFooter()}
          </div>
        ` : nothing}
      </div>`;
  }

  renderCascadeToggleInline() {
    if (!this._asBase || this._isUpwardMode) return nothing;
    const totalDescendants = this._inherited.reduce(
      (acc, s) => acc + (s.descendantCount || 0),
      0,
    );
    if (totalDescendants === 0) return nothing;
    const id = 'msm-cascade-toggle';
    const sitesWord = `nested site${totalDescendants === 1 ? '' : 's'}`;
    return html`
      <div class="cascade-toggle-inline">
        <input id=${id}
          type="checkbox"
          ?checked=${this._includeDescendants}
          @change=${(e) => this._setIncludeDescendants(e.target.checked)}>
        <label class="cascade-toggle-inline-label" for=${id}>
          Also roll out to ${totalDescendants} ${sitesWord}
        </label>
      </div>`;
  }

  renderAdvancedFooter() {
    const applyDisabled = this._busy || !this._canApplyDownward;
    const count = this._directTargets.length;
    const label = count > 0
      ? `Apply to ${count} site${count !== 1 ? 's' : ''}`
      : 'Apply';

    return html`
      <div class="form-actions">
        <sl-button
          @click=${() => this.apply()}
          ?disabled=${applyDisabled}>${label}</sl-button>
      </div>`;
  }

  renderAppLink() {
    return html`
      <a class="app-link" href=${this._getAppDeepLink()} target="_blank" rel="noopener">
        Manage variants in MSM \u2197
      </a>`;
  }

  renderDirectionFlipLink() {
    if (!this._hasDualRole) return nothing;
    const toUpward = !this._isUpwardMode;
    const baseLabel = this._asSatellite?.baseLabel || this._asSatellite?.base;
    const label = toUpward
      ? `Update from parent (${baseLabel}) instead`
      : 'Update children instead';
    const arrow = toUpward ? '\u2191' : '\u2193';
    return html`
      <button class="direction-flip"
        type="button"
        ?disabled=${this._busy}
        @click=${() => this.onDirectionToggle(toUpward)}>
        ${arrow} ${label}
      </button>`;
  }

  renderActionPicker() {
    const options = [
      { value: 'break', label: 'Make a local copy on selected sites' },
      { value: 'sync', label: 'Push update to customized sites' },
      { value: 'reset', label: 'Discard local copy on customized sites' },
    ];

    return html`
      <se-select
        label="Action"
        name="action"
        .value=${this._action}
        ?disabled=${this._busy}
        @change=${(e) => this.onActionChange(e.target.value)}>
        ${options.map((opt) => html`
          <option value=${opt.value}>${opt.label}</option>
        `)}
      </se-select>`;
  }

  renderSyncModeSelect() {
    return html`
      <se-select
        label="Sync mode"
        name="syncMode"
        .value=${this._syncMode}
        ?disabled=${this._busy}
        @change=${(e) => { this._syncMode = e.target.value; }}>
        <option value="merge">Keep local edits (merge)</option>
        <option value="override">Replace with base (override)</option>
      </se-select>`;
  }

  renderDownwardView() {
    return html`
      ${this.renderPrimaryButtons()}
      ${this.renderCascadeToggleInline()}
      ${this.renderSiteChips()}`;
  }

  renderUpwardView() {
    return html`
      ${this.renderSatelliteStatusLine()}
      ${this.renderSatellitePrimaryButtons()}`;
  }

  render() {
    if (this._loading) {
      return html`<p class="loading">${this._loading}</p>`;
    }

    if (!this._asBase && !this._asSatellite) {
      return html`<p class="no-satellites">No satellite sites configured.</p>`;
    }

    const isUpward = this._showUpwardView;

    return html`
      ${this._asSatellite ? this.renderBreadcrumb() : nothing}
      ${isUpward ? this.renderUpwardView() : this.renderDownwardView()}
      ${this.renderConfirm()}
      <div class="bottom-section">
        ${!isUpward && this._asBase ? this.renderAdvancedExpander() : nothing}
        ${this._hasDualRole ? this.renderDirectionFlipLink() : nothing}
        ${this.renderAppLink()}
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
    console.log('[MSM Plugin] actions.daFetch available?', typeof actions?.daFetch);

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
