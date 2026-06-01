/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console, class-methods-use-this */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import {
  fetchMsmConfig,
  checkPageOverrides,
  isActionableItem,
  getSiteRoles,
} from './helpers/api.js';
import 'https://da.live/nx/public/sl/components.js';
import './helpers/column-browser.js';
import './helpers/action-panel.js';

const NX = 'https://da.live/nx';
let sl = null;
let styles = null;
let buttons = null;
try {
  const { default: getStyle } = await import(`${NX}/utils/styles.js`);
  [sl, styles, buttons] = await Promise.all([
    getStyle(`${NX}/public/sl/styles.css`),
    getStyle(import.meta.url),
    getStyle(`${NX}/styles/buttons.css`),
  ]);
} catch (e) {
  console.warn('Failed to load styles:', e);
}

const HIDE_INHERITED_KEY = 'da-msm-hide-inherited';

function loadHideInheritedPref() {
  try {
    return localStorage.getItem(HIDE_INHERITED_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveHideInheritedPref(value) {
  try {
    localStorage.setItem(HIDE_INHERITED_KEY, String(value));
  } catch {
    /* localStorage may be unavailable in private mode; ignore */
  }
}

function parseDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const org = (params.get('org') || '').trim();
  if (!org) return null;
  return {
    org,
    site: (params.get('site') || '').trim(),
    path: (params.get('path') || '').trim(),
  };
}

class MsmApp extends LitElement {
  static properties = {
    context: { attribute: false },
    token: { attribute: false },
    deepLink: { attribute: false },
    _state: { state: true },
    _org: { state: true },
    _site: { state: true },
    _role: { state: true },
    _parentBase: { state: true },
    _msmConfig: { state: true },
    _selectedItems: { state: true },
    _currentPath: { state: true },
    _satellites: { state: true },
    _pageOverrides: { state: true },
    _initError: { state: true },
    _siteWarning: { state: true },
    _parentChain: { state: true },
    _hasDescendants: { state: true },
    _hideInherited: { state: true },
    _deepLinkPath: { state: true },
    _deepLinkWarning: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sl, styles, buttons].filter(Boolean);
    this._selectedItems = [];
    this._currentPath = '';
    this._satellites = {};
    this._pageOverrides = new Map();
    this._initError = '';
    this._role = 'base';
    this._state = 'init';
    this._parentBase = '';
    this._parentChain = [];
    this._hasDescendants = false;
    this._hideInherited = loadHideInheritedPref();
    this._deepLinkPath = '';
    this._deepLinkWarning = '';

    // Auto-load when a deep-link was supplied via URL query params.
    if (this.deepLink?.org) {
      this._org = this.deepLink.org;
      this._site = this.deepLink.site || '';
      this._deepLinkPath = this.deepLink.path || '';
      this._state = 'loading';
      this.loadConfig(this.deepLink.org);
    }
  }

  handleDeepLinkConsumed() {
    this._deepLinkPath = '';
  }

  handleDeepLinkWarning(e) {
    const { requestedPath, lastResolvedPath } = e.detail || {};
    const tail = lastResolvedPath
      ? ` (navigated as far as ${lastResolvedPath})`
      : '';
    this._deepLinkWarning = `Could not resolve "${requestedPath}"${tail}.`;
  }

  dismissSiteWarning() {
    this._siteWarning = '';
  }

  dismissDeepLinkWarning() {
    this._deepLinkWarning = '';
  }

  onHideInheritedToggle(checked) {
    this._hideInherited = checked;
    saveHideInheritedPref(checked);
  }

  handleActionComplete() {
    const cb = this.shadowRoot.querySelector('msm-column-browser');
    cb?.invalidateMergedCache();
  }

  handleOrgSubmit(e) {
    e.preventDefault();
    const input = this.shadowRoot.querySelector('#path-input');
    const raw = (input?.value || '').trim();
    const parts = raw.replace(/^\/+/, '').split('/').filter(Boolean);
    if (!parts.length) return;
    const [org, site] = parts;
    this._org = org;
    this._site = site || '';
    this._initError = '';
    this._siteWarning = '';
    this._selectedItems = [];
    this._currentPath = '';
    this._pageOverrides = new Map();
    this._state = 'loading';

    const params = new URLSearchParams();
    params.set('org', org);
    if (site) params.set('site', site);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);

    this.loadConfig(org);
  }

  classifySite(config) {
    this._siteWarning = '';
    this._parentChain = [];
    this._parentBase = '';
    this._hasDescendants = false;
    this._satellites = {};
    this._browseSite = this._site;

    if (!this._site) {
      this._role = 'base';
      return;
    }

    const roles = getSiteRoles(config, this._site);
    const isBase = !!roles.asBase;
    const isSatellite = !!roles.asSatellite;

    if (isSatellite) {
      this._parentBase = roles.asSatellite.base;
      this._parentChain = roles.asSatellite.chain || [];
    }

    if (isBase && isSatellite) {
      // Middle-tier site: has children AND has a parent
      this._role = 'dual';
      this._satellites = roles.asBase.satellites;
      this._hasDescendants = Object.values(roles.asBase.satellites)
        .some((s) => s.descendantCount > 0);
      return;
    }

    if (isBase) {
      this._role = 'base';
      this._satellites = roles.asBase.satellites;
      this._hasDescendants = Object.values(roles.asBase.satellites)
        .some((s) => s.descendantCount > 0);
      return;
    }

    if (isSatellite) {
      this._role = 'satellite';
      const leafEntry = config.baseSites
        .find((bs) => Object.keys(bs.satellites).includes(this._site))
        ?.satellites[this._site];
      this._satellites = { [this._site]: leafEntry || { label: this._site } };
      return;
    }

    const fallback = config.baseSites[0];
    this._role = 'base';
    this._satellites = fallback.satellites;
    this._browseSite = fallback.site;
    this._siteWarning = `"${this._site}" is not a recognized base or satellite site. Showing "${fallback.site}" instead.`;
  }

  async loadConfig(org) {
    try {
      const config = await fetchMsmConfig(org);
      if (!config || !config.baseSites.length) {
        this._state = 'no-config';
        return;
      }
      this._msmConfig = config;
      this.classifySite(config);
      this._state = 'ready';
    } catch (e) {
      console.error('Failed to load MSM config:', e);
      this._initError = `Could not load MSM configuration for "${org}".`;
      this._state = 'init';
    }
  }

  handleBrowseSelection(e) {
    const { selectedItems, currentPath, site } = e.detail;
    this._selectedItems = selectedItems;
    this._currentPath = currentPath;
    this._currentSite = site;

    if (this._role === 'satellite' || this._role === 'dual') {
      const selfSite = this._role === 'satellite' ? this._site : site;
      this._pageOverrides = this._buildSelfOverrides(selectedItems, selfSite);
    } else {
      this._pageOverrides = new Map();
    }

    if (this._role === 'satellite') return;

    if (selectedItems.length > 0 && this._msmConfig) {
      const roles = getSiteRoles(this._msmConfig, site);
      if (roles.asBase) {
        this._satellites = roles.asBase.satellites;
        this._parentChain = roles.asSatellite?.chain || [];
        this._parentBase = roles.asSatellite?.base || '';
        this._hasDescendants = Object.values(roles.asBase.satellites)
          .some((s) => s.descendantCount > 0);
        this.loadOverrides(selectedItems);
      }
    }
  }

  _buildSelfOverrides(selectedItems, selfSite) {
    const map = new Map();
    selectedItems.filter(isActionableItem).forEach((page) => {
      map.set(page.path, [{
        site: selfSite,
        label: selfSite,
        hasOverride: !page.inheritedFrom,
        inheritedFrom: page.inheritedFrom || null,
        sourceSite: page.sourceSite || null,
      }]);
    });
    return map;
  }

  async loadOverrides(items) {
    const pages = items.filter((i) => isActionableItem(i));
    if (!pages.length) return;

    const org = this._org;
    const sats = this._satellites;
    const overrides = new Map();

    await Promise.all(pages.map(async (page) => {
      const ext = page.ext || 'html';
      const pagePath = page.path.replace(/\.[^/.]+$/, '');
      const results = await checkPageOverrides(org, sats, pagePath, ext);
      overrides.set(page.path, results);
    }));

    const merged = new Map();
    const allPaths = new Set([
      ...Array.from(this._pageOverrides?.keys?.() || []),
      ...overrides.keys(),
    ]);
    allPaths.forEach((p) => {
      const selfEntries = this._pageOverrides?.get(p) || [];
      const childEntries = overrides.get(p) || [];
      merged.set(p, [...selfEntries, ...childEntries]);
    });
    this._pageOverrides = merged;
  }

  get _selectedPages() {
    return this._selectedItems.filter((i) => isActionableItem(i));
  }

  get _isSinglePage() {
    return this._selectedPages.length === 1;
  }

  get _inputValue() {
    if (!this._org) return '';
    return this._site ? `/${this._org}/${this._site}` : `/${this._org}`;
  }

  renderToolbar() {
    const canShowInheritedToggle = this._role === 'satellite' || this._role === 'dual';
    return html`
      <div class="msm-toolbar">
        <h1>Multi-Site Management</h1>
        <form class="msm-toolbar-form" @submit=${this.handleOrgSubmit}>
          <sl-input
            id="path-input"
            type="text"
            placeholder="/org/site"
            autocomplete="off"
            spellcheck="false"
            required
            value=${this._inputValue}
            .error=${this._initError || nothing}
          ></sl-input>
          <sl-button @click=${this.handleOrgSubmit}>Load</sl-button>
        </form>
        <div class="msm-toolbar-role-badges">
          ${this._role === 'satellite' ? html`<span class="role-badge">Satellite</span>` : nothing}
          ${this._role === 'dual' ? html`<span class="role-badge dual">Middle-tier</span>` : nothing}
          ${canShowInheritedToggle ? html`
            <label class="hide-inherited-toggle">
              <input
                type="checkbox"
                role="switch"
                aria-label="Hide inherited pages"
                .checked=${this._hideInherited}
                @change=${(e) => this.onHideInheritedToggle(e.target.checked)} />
              <span>Hide inherited pages</span>
            </label>
          ` : nothing}
        </div>
      </div>
    `;
  }

  renderContent() {
    if (this._state === 'init') return nothing;

    if (this._state === 'loading') {
      return html`
        <div class="msm-loading">
          <div class="spinner"></div>
          Loading MSM configuration\u2026
        </div>
      `;
    }

    if (this._state === 'no-config') {
      return html`
        <div class="msm-empty">
          <p>No MSM base sites configured for <strong>${this._org}</strong>.</p>
        </div>
      `;
    }

    return html`
      ${this._siteWarning ? html`
        <div class="nx-alert warning site-warning">
          <p>${this._siteWarning}</p>
          <button class="nx-alert-dismiss" type="button"
            aria-label="Dismiss"
            @click=${() => this.dismissSiteWarning()}>\u00d7</button>
        </div>
      ` : nothing}
      ${this._deepLinkWarning ? html`
        <div class="nx-alert warning deep-link-warning">
          <p>${this._deepLinkWarning}</p>
          <button class="nx-alert-dismiss" type="button"
            aria-label="Dismiss"
            @click=${() => this.dismissDeepLinkWarning()}>\u00d7</button>
        </div>
      ` : nothing}
      <div class="msm-body">
        <msm-column-browser
          .org=${this._org}
          .role=${this._role}
          .site=${this._browseSite || ''}
          .msmConfig=${this._msmConfig}
          .hideInherited=${this._hideInherited}
          .deepLinkPath=${this._deepLinkPath}
          @browse-selection=${this.handleBrowseSelection}
          @deep-link-consumed=${this.handleDeepLinkConsumed}
          @deep-link-warning=${this.handleDeepLinkWarning}
        ></msm-column-browser>
        ${this._selectedPages.length > 0 ? html`
          <msm-action-panel
            .org=${this._org}
            .role=${this._role}
            .site=${this._role === 'satellite' ? this._site : this._currentSite}
            .parentBase=${this._parentBase}
            .parentChain=${this._parentChain}
            .pages=${this._selectedPages}
            .satellites=${this._satellites}
            .overrides=${this._pageOverrides}
            .isSinglePage=${this._isSinglePage}
            .hasDescendants=${this._hasDescendants}
            .msmConfig=${this._msmConfig}
            @action-complete=${this.handleActionComplete}
          ></msm-action-panel>
        ` : nothing}
      </div>
    `;
  }

  render() {
    return html`
      ${this.renderToolbar()}
      ${this.renderContent()}
    `;
  }
}

customElements.define('msm-app', MsmApp);

(async function init() {
  const deepLink = parseDeepLink();
  const { context, token } = await DA_SDK;
  const cmp = document.createElement('msm-app');
  cmp.context = context;
  cmp.token = token;
  if (deepLink) cmp.deepLink = deepLink;
  document.body.append(cmp);
}());
