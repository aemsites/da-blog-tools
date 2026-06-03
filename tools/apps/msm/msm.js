/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console, class-methods-use-this */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import { fetchMsmConfig } from './helpers/api.js';
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

// Parse `?org=&site=&path=` deep-link params (the dialog links here with these).
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

// Split "/org", "/org/site", or "/org/site/path…" into parts.
function parsePathInput(raw) {
  const parts = (raw || '').trim().replace(/^\/+/, '').split('/').filter(Boolean);
  const [org, site, ...rest] = parts;
  return { org: org || '', site: site || '', path: rest.length ? `/${rest.join('/')}` : '' };
}

class MsmApp extends LitElement {
  static properties = {
    context: { attribute: false },
    token: { attribute: false },
    deepLink: { attribute: false },
    _state: { state: true },
    _org: { state: true },
    _initialSite: { state: true },
    _initialPath: { state: true },
    _msmConfig: { state: true },
    _selectedItems: { state: true },
    _currentSite: { state: true },
    _initError: { state: true },
    _deepLinkWarning: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sl, styles, buttons].filter(Boolean);
    this._state = 'init';
    this._org = '';
    this._initialSite = '';
    this._initialPath = '';
    this._selectedItems = [];
    this._currentSite = '';
    this._initError = '';
    this._deepLinkWarning = '';

    if (this.deepLink?.org) {
      this._org = this.deepLink.org;
      this._initialSite = this.deepLink.site || '';
      this._initialPath = this.deepLink.path || '';
      this._state = 'loading';
      this.loadConfig(this.deepLink.org);
    }
  }

  get _inputValue() {
    if (!this._org) return '';
    let value = `/${this._org}`;
    if (this._initialSite) value += `/${this._initialSite}`;
    if (this._initialSite && this._initialPath) value += this._initialPath;
    return value;
  }

  async loadConfig(org) {
    try {
      const config = await fetchMsmConfig(org);
      if (!config || !config.baseSites.length) {
        this._state = 'no-config';
        return;
      }
      this._msmConfig = config;
      this._state = 'ready';
    } catch (e) {
      console.error('Failed to load MSM config:', e);
      this._initError = `Could not load MSM configuration for "${org}".`;
      this._state = 'init';
    }
  }

  handleSubmit(e) {
    e.preventDefault();
    const input = this.shadowRoot.querySelector('#path-input');
    const { org, site, path } = parsePathInput(input?.value);
    if (!org) return;
    this._org = org;
    this._initialSite = site;
    this._initialPath = path;
    this._initError = '';
    this._deepLinkWarning = '';
    this._selectedItems = [];
    this._currentSite = '';
    this._state = 'loading';
    this.loadConfig(org);
  }

  handleBrowseSelection(e) {
    const { selectedItems, site } = e.detail;
    this._selectedItems = selectedItems;
    this._currentSite = site;
  }

  handleNavigatePages(e) {
    const { site, paths } = e.detail || {};
    const browser = this.shadowRoot.querySelector('msm-column-browser');
    browser?.selectPaths(site, paths);
  }

  handleDeselectPage(e) {
    const { site, path } = e.detail || {};
    const browser = this.shadowRoot.querySelector('msm-column-browser');
    browser?.deselectPath(site, path);
  }

  handleDeepLinkWarning(e) {
    const { requestedPath, lastResolvedPath } = e.detail || {};
    const tail = lastResolvedPath ? ` (navigated as far as ${lastResolvedPath})` : '';
    this._deepLinkWarning = `Could not resolve "${requestedPath}"${tail}.`;
  }

  dismissDeepLinkWarning() {
    this._deepLinkWarning = '';
  }

  renderToolbar() {
    return html`
      <div class="msm-toolbar">
        <h1>Multi-Site Management</h1>
        <form class="msm-toolbar-form" @submit=${this.handleSubmit}>
          <sl-input
            id="path-input"
            type="text"
            placeholder="/org, /org/site, or /org/site/path"
            autocomplete="off"
            spellcheck="false"
            required
            value=${this._inputValue}
            .error=${this._initError || nothing}
          ></sl-input>
          <sl-button @click=${this.handleSubmit}>Load</sl-button>
        </form>
      </div>
    `;
  }

  renderContent() {
    if (this._state === 'init') return nothing;

    if (this._state === 'loading') {
      return html`<div class="msm-loading"><div class="spinner"></div> Loading MSM configuration…</div>`;
    }

    if (this._state === 'no-config') {
      return html`<div class="msm-empty"><p>No MSM base sites configured for <strong>${this._org}</strong>.</p></div>`;
    }

    return html`
      ${this._deepLinkWarning ? html`
        <div class="nx-alert warning deep-link-warning">
          <p>${this._deepLinkWarning}</p>
          <button class="nx-alert-dismiss" type="button" aria-label="Dismiss"
            @click=${() => this.dismissDeepLinkWarning()}>×</button>
        </div>
      ` : nothing}
      <div class="msm-body">
        <msm-column-browser
          .org=${this._org}
          .msmConfig=${this._msmConfig}
          .initialSite=${this._initialSite}
          .initialPath=${this._initialPath}
          @browse-selection=${this.handleBrowseSelection}
          @deep-link-warning=${this.handleDeepLinkWarning}
        ></msm-column-browser>
        <msm-action-panel
          .org=${this._org}
          .site=${this._currentSite}
          .msmConfig=${this._msmConfig}
          .pages=${this._selectedItems}
          @navigate-pages=${this.handleNavigatePages}
          @deselect-page=${this.handleDeselectPage}
        ></msm-action-panel>
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
