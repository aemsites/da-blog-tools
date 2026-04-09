/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console, class-methods-use-this */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import { fetchMsmConfig, checkPageOverrides } from './helpers/api.js';
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

    const org = this.context?.org;
    const site = this.context?.repo;
    if (org) {
      this._org = org;
      this._site = site || '';
      this._state = 'loading';
      this.loadConfig(org);
    } else {
      this._state = 'init';
    }
  }

  handleOrgSubmit(e) {
    e.preventDefault();
    const orgInput = this.shadowRoot.querySelector('#org-input');
    const siteInput = this.shadowRoot.querySelector('#site-input');
    const org = (orgInput?.value || '').trim().replace(/^\/+/, '');
    const site = (siteInput?.value || '').trim().replace(/^\/+/, '');
    if (!org) return;
    this._org = org;
    this._site = site;
    this._initError = '';
    this._state = 'loading';
    this.loadConfig(org);
  }

  classifySite(config) {
    if (!this._site) {
      this._role = 'base';
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

    this._role = 'base';
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
    const pages = items.filter((i) => i.ext === 'html');
    if (!pages.length) return;

    const org = this._org;
    const sats = this._satellites;
    const overrides = new Map();

    await Promise.all(pages.map(async (page) => {
      const pagePath = page.path.replace('.html', '');
      const results = await checkPageOverrides(org, sats, pagePath);
      overrides.set(page.path, results);
    }));

    this._pageOverrides = new Map(overrides);
  }

  get _selectedPages() {
    return this._selectedItems.filter((i) => i.ext === 'html');
  }

  get _isSinglePage() {
    return this._selectedPages.length === 1;
  }

  renderHeader() {
    const org = this._org || '';
    const site = this._role === 'satellite' ? this._site : (this._currentSite || '');
    return html`
      <div class="msm-header">
        <h1>MSM Actions</h1>
        <div class="msm-header-meta">
          ${site ? html`<span class="site-label">${org} / ${site}</span>` : nothing}
          ${this._role === 'satellite' ? html`<span class="role-badge">Satellite</span>` : nothing}
        </div>
      </div>
    `;
  }

  renderLoading() {
    return html`
      <div class="msm-loading">
        <div class="spinner"></div>
        Loading MSM configuration\u2026
      </div>
    `;
  }

  renderInit() {
    return html`
      <div class="msm-init">
        <div class="msm-init-card">
          <h1>MSM Actions</h1>
          <p>Enter your organization and, optionally, a site name.</p>
          <form class="msm-init-form" @submit=${this.handleOrgSubmit}>
            <div class="msm-init-fields">
              <div class="msm-init-field">
                <label for="org-input">Organization</label>
                <input
                  id="org-input"
                  type="text"
                  placeholder="e.g. aemsites"
                  autocomplete="off"
                  spellcheck="false"
                  required
                />
              </div>
              <div class="msm-init-field">
                <label for="site-input">Site <span class="optional">(optional)</span></label>
                <input
                  id="site-input"
                  type="text"
                  placeholder="e.g. site-fr"
                  autocomplete="off"
                  spellcheck="false"
                />
              </div>
            </div>
            <p class="msm-init-hint">
              Leave site blank to manage all base sites.
              Enter a satellite site name to preview and publish your content.
            </p>
            ${this._initError ? html`
              <div class="msm-init-error" role="alert">${this._initError}</div>
            ` : nothing}
            <button type="submit" class="accent">Load</button>
          </form>
        </div>
      </div>
    `;
  }

  renderEmpty() {
    return html`
      <div class="msm-empty">
        <p>No MSM base sites configured for <strong>${this._org}</strong>.</p>
        <button class="accent" @click=${() => { this._state = 'init'; }}>Try another org</button>
      </div>
    `;
  }

  render() {
    if (this._state === 'init') return this.renderInit();
    if (this._state === 'loading') return this.renderLoading();
    if (this._state === 'no-config') return this.renderEmpty();

    return html`
      ${this.renderHeader()}
      <div class="msm-body">
        <msm-column-browser
          .org=${this._org}
          .role=${this._role}
          .site=${this._role === 'satellite' ? this._site : ''}
          .msmConfig=${this._msmConfig}
          @browse-selection=${this.handleBrowseSelection}
        ></msm-column-browser>
        ${this._selectedPages.length > 0 ? html`
          <msm-action-panel
            .org=${this._org}
            .role=${this._role}
            .site=${this._role === 'satellite' ? this._site : this._currentSite}
            .pages=${this._selectedPages}
            .satellites=${this._satellites}
            .overrides=${this._pageOverrides}
            .isSinglePage=${this._isSinglePage}
          ></msm-action-panel>
        ` : nothing}
      </div>
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
