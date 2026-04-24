/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console, class-methods-use-this */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import { fetchMsmConfig, checkPageOverrides, isActionableItem } from './helpers/api.js';
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

class MsmApp extends LitElement {
  static properties = {
    context: { attribute: false },
    token: { attribute: false },
    _state: { state: true },
    _org: { state: true },
    _site: { state: true },
    _role: { state: true },
    _baseSite: { state: true },
    _msmConfig: { state: true },
    _selectedItems: { state: true },
    _currentPath: { state: true },
    _satellites: { state: true },
    _pageOverrides: { state: true },
    _initError: { state: true },
    _siteWarning: { state: true },
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
    this.loadConfig(org);
  }

  classifySite(config) {
    this._siteWarning = '';

    if (!this._site) {
      this._role = 'base';
      this._baseSite = '';
      return;
    }

    const isSatellite = config.baseSites.find(
      (bs) => Object.keys(bs.satellites).includes(this._site),
    );
    if (isSatellite) {
      this._role = 'satellite';
      this._baseSite = isSatellite.site;
      this._satellites = {
        [this._site]: isSatellite.satellites[this._site],
      };
      return;
    }

    const isBase = config.baseSites.find((bs) => bs.site === this._site);
    if (isBase) {
      this._role = 'base';
      this._baseSite = this._site;
      this._satellites = isBase.satellites;
      return;
    }

    const fallback = config.baseSites[0];
    this._role = 'base';
    this._baseSite = fallback.site;
    this._satellites = fallback.satellites;
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

    if (this._role === 'satellite') return;

    if (selectedItems.length > 0 && this._msmConfig) {
      const baseSite = this._msmConfig.baseSites.find((s) => s.site === site);
      if (baseSite) {
        this._satellites = baseSite.satellites;
        this.loadOverrides(selectedItems);
      }
    } else {
      this._pageOverrides = new Map();
    }
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

    this._pageOverrides = new Map(overrides);
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
        ${this._role === 'satellite' ? html`<span class="role-badge">Satellite</span>` : nothing}
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
      ${this._siteWarning ? html`<div class="nx-alert warning"><p>${this._siteWarning}</p></div>` : nothing}
      <div class="msm-body">
        <msm-column-browser
          .org=${this._org}
          .role=${this._role}
          .site=${this._role === 'satellite' ? this._site : this._baseSite || ''}
          .msmConfig=${this._msmConfig}
          @browse-selection=${this.handleBrowseSelection}
        ></msm-column-browser>
        ${this._selectedPages.length > 0 ? html`
          <msm-action-panel
            .org=${this._org}
            .role=${this._role}
            .site=${this._role === 'satellite' ? this._site : this._currentSite}
            .baseSite=${this._baseSite}
            .pages=${this._selectedPages}
            .satellites=${this._satellites}
            .overrides=${this._pageOverrides}
            .isSinglePage=${this._isSinglePage}
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
  const { context, token } = await DA_SDK;
  const cmp = document.createElement('msm-app');
  cmp.context = context;
  cmp.token = token;
  document.body.append(cmp);
}());
