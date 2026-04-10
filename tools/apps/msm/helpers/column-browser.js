/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console, class-methods-use-this */
import { LitElement, html, nothing } from 'da-lit';
import { listFolder } from './api.js';

const NX = 'https://da.live/nx';
let sl;
let sheet;
try {
  const { default: getStyle } = await import(`${NX}/utils/styles.js`);
  [sl, sheet] = await Promise.all([
    getStyle(`${NX}/public/sl/styles.css`),
    getStyle(import.meta.url),
  ]);
} catch (e) {
  console.warn('Failed to load column-browser styles:', e);
}

const FOLDER_ICON = html`<svg class="item-icon" viewBox="0 0 18 18" fill="currentColor"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h4l2 2h5A1.5 1.5 0 0 1 15 5.5v8a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 13.5z"/></svg>`;
const PAGE_ICON = html`<svg class="item-icon" viewBox="0 0 18 18" fill="currentColor"><path d="M4 1h7l4 4v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2zm6.5 0v3.5H14"/></svg>`;
const ARROW_RIGHT = html`<svg class="item-arrow" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="3,1 7,5 3,9"/></svg>`;
const BACK_ARROW = html`<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="7,1 3,5 7,9"/></svg>`;

class MsmColumnBrowser extends LitElement {
  static properties = {
    org: { type: String },
    role: { type: String },
    site: { type: String },
    msmConfig: { attribute: false },
    _columns: { state: true },
    _checked: { state: true },
    _activeColumnIdx: { state: true },
    _loadingColumn: { state: true },
    _focusedItemIdx: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sl, sheet].filter(Boolean);
    this._columns = [];
    this._checked = new Set();
    this._activeColumnIdx = 0;
    this._loadingColumn = -1;
    this._focusedItemIdx = -1;
    this._folderCache = new Map();
    this._handleKeydown = this._onKeydown.bind(this);

    if (this.site) {
      this.initSiteRoot();
    } else {
      this.initSitesColumn();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  _onKeydown(e) {
    const col = this._columns[this._activeColumnIdx];
    if (!col?.items.length) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this._focusedItemIdx = Math.min(
          this._focusedItemIdx + 1,
          col.items.length - 1,
        );
        this.scrollFocusedIntoView();
        break;
      case 'ArrowUp':
        e.preventDefault();
        this._focusedItemIdx = Math.max(this._focusedItemIdx - 1, 0);
        this.scrollFocusedIntoView();
        break;
      case 'ArrowRight':
      case 'Enter': {
        e.preventDefault();
        const item = col.items[this._focusedItemIdx];
        if (item && (item.isFolder || item.isSite)) {
          this.navigateToFolder(this._activeColumnIdx, item);
          this._focusedItemIdx = 0;
        }
        break;
      }
      case 'ArrowLeft':
        e.preventDefault();
        if (this._activeColumnIdx > 0) {
          this._activeColumnIdx -= 1;
          this._focusedItemIdx = 0;
        }
        break;
      case ' ':
        e.preventDefault();
        if (this._focusedItemIdx >= 0) {
          const item = col.items[this._focusedItemIdx];
          if (item && this.showCheckbox(item)) {
            this.toggleCheck(item);
          }
        }
        break;
      default:
        break;
    }
  }

  scrollFocusedIntoView() {
    this.updateComplete.then(() => {
      const items = this.shadowRoot.querySelectorAll(
        `.column:nth-child(${this._activeColumnIdx + 1}) .item`,
      );
      if (items[this._focusedItemIdx]) {
        items[this._focusedItemIdx].scrollIntoView({ block: 'nearest' });
      }
    });
  }

  scrollToActiveColumn() {
    this.updateComplete.then(() => {
      const browser = this.shadowRoot.querySelector('.browser');
      if (browser) {
        browser.scrollTo({ left: browser.scrollWidth, behavior: 'smooth' });
      }
    });
  }

  toggleCheck(item) {
    const next = new Set(this._checked);
    const key = `${item.site || ''}:${item.path}`;
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this._checked = next;
    const site = item.site || this.getCurrentSite();
    this.emitSelection(site);
  }

  initSitesColumn() {
    if (!this.msmConfig?.baseSites?.length) return;
    const items = this.msmConfig.baseSites.map((bs) => ({
      name: `${this.org} / ${bs.label || bs.site}`,
      path: bs.site,
      isFolder: true,
      isSite: true,
      site: bs.site,
    }));
    this._columns = [{ header: 'Sites', items, selectedPath: null }];
  }

  async initSiteRoot() {
    this._loadingColumn = 0;
    this._columns = [{
      header: this.site, items: [], selectedPath: null,
    }];

    try {
      const items = await listFolder(this.org, this.site, '/');
      this._columns = [{
        header: this.site,
        items: items.map((i) => ({ ...i, site: this.site })),
        selectedPath: null,
      }];
    } catch (e) {
      console.error('Failed to load site root:', e);
      this._columns = [{ header: this.site, items: [], selectedPath: null }];
    }
    this._loadingColumn = -1;
  }

  async navigateToFolder(colIdx, item) {
    const site = this.findSite(colIdx, item);
    if (!site) return;

    const newColumns = this._columns.slice(0, colIdx + 1);
    newColumns[colIdx] = { ...newColumns[colIdx], selectedPath: item.path };
    this._columns = newColumns;
    this._activeColumnIdx = colIdx + 1;
    this._loadingColumn = colIdx + 1;

    try {
      let items;
      if (item.isSite) {
        items = await listFolder(this.org, site, '/');
      } else {
        items = await listFolder(this.org, site, item.path);
      }
      items = items.map((i) => ({ ...i, site }));

      const header = item.isSite ? item.path : item.name;
      this._columns = [
        ...newColumns,
        { header, items, selectedPath: null },
      ];
    } catch (e) {
      console.error('Failed to load folder:', e);
      this._columns = [
        ...newColumns,
        { header: item.name, items: [], selectedPath: null },
      ];
    }
    this._loadingColumn = -1;
    this.scrollToActiveColumn();

    this.clearChecksAfterColumn(colIdx);
    this.emitSelection(site);
  }

  findSite(colIdx, item) {
    if (item?.site) return item.site;
    if (this.role === 'satellite' && this.site) return this.site;

    const searchCols = this._columns.slice(0, colIdx + 1).reverse();
    const match = searchCols.reduce((found, col) => {
      if (found) return found;
      if (col.selectedPath) {
        const selItem = col.items.find((it) => it.path === col.selectedPath);
        if (selItem?.site) return selItem.site;
      }
      const siteItem = col.items.find((it) => it.isSite && it.site);
      if (siteItem && col.selectedPath === siteItem.path) return siteItem.site;
      return null;
    }, null);
    if (match) return match;

    const firstSiteCol = this._columns[0];
    if (firstSiteCol?.selectedPath) {
      const firstSel = firstSiteCol.items.find((i) => i.path === firstSiteCol.selectedPath);
      return firstSel?.site;
    }
    return null;
  }

  getCurrentSite() {
    if (this.role === 'satellite' && this.site) return this.site;

    const cols = [...this._columns].reverse();
    const match = cols.reduce((found, col) => (
      found || col.items.find((item) => item.site)
    ), null);
    return match?.site || null;
  }

  handleItemClick(colIdx, item, e) {
    if (e?.target?.type === 'checkbox') return;
    if (item.isFolder || item.isSite) {
      this.navigateToFolder(colIdx, item);
    } else {
      this.toggleCheck(item);
    }
  }

  handleCheckChange(item, e) {
    e.stopPropagation();
    const next = new Set(this._checked);
    const key = `${item.site || ''}:${item.path}`;
    if (e.target.checked) {
      next.add(key);
    } else {
      next.delete(key);
    }
    this._checked = next;

    const site = item.site || this.getCurrentSite();
    this.emitSelection(site);
  }

  clearChecksAfterColumn(colIdx) {
    const validPaths = new Set(
      this._columns.slice(0, colIdx + 1).flatMap(
        (col) => col.items.map((item) => `${item.site || ''}:${item.path}`),
      ),
    );
    this._checked = new Set([...this._checked].filter((key) => validPaths.has(key)));
  }

  async emitSelection(site) {
    const checkedPages = [];
    const checkedFolders = [];

    this._columns.forEach((col) => {
      col.items.forEach((item) => {
        const key = `${item.site || site || ''}:${item.path}`;
        if (!this._checked.has(key)) return;
        if (item.isFolder && !item.isSite) {
          checkedFolders.push(item);
        } else if (!item.isSite) {
          checkedPages.push(item);
        }
      });
    });

    const folderPages = await Promise.all(
      checkedFolders.map(async (folder) => {
        const folderSite = folder.site || site;
        const cacheKey = `${this.org}/${folderSite}${folder.path}`;
        if (!this._folderCache.has(cacheKey)) {
          try {
            const items = await listFolder(this.org, folderSite, folder.path);
            this._folderCache.set(
              cacheKey,
              items.filter((i) => i.ext === 'html').map((i) => ({ ...i, site: folderSite })),
            );
          } catch (e) {
            console.error('Failed to resolve folder pages:', e);
            this._folderCache.set(cacheKey, []);
          }
        }
        return this._folderCache.get(cacheKey);
      }),
    );

    const allItems = [...checkedPages, ...folderPages.flat()];
    const seen = new Set();
    const selectedItems = allItems.filter((item) => {
      const key = `${item.site || ''}:${item.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const lastCol = this._columns[this._columns.length - 1];
    const currentPath = lastCol?.header || '';
    this.dispatchEvent(new CustomEvent('browse-selection', {
      detail: { selectedItems, currentPath, site: site || this.getCurrentSite() },
      bubbles: true,
      composed: true,
    }));
  }

  goBack() {
    if (this._activeColumnIdx > 0) {
      this._activeColumnIdx -= 1;
    }
  }

  isItemChecked(item) {
    const key = `${item.site || ''}:${item.path}`;
    return this._checked.has(key);
  }

  showCheckbox(item) {
    return !item.isSite && (item.ext === 'html' || item.isFolder);
  }

  renderItem(colIdx, item, itemIdx) {
    const isSelected = this._columns[colIdx]?.selectedPath === item.path;
    const isFocused = colIdx === this._activeColumnIdx
      && itemIdx === this._focusedItemIdx;
    return html`
      <div
        class="item ${isSelected ? 'selected' : ''} ${isFocused ? 'focused' : ''}"
        @click=${(e) => this.handleItemClick(colIdx, item, e)}
        role="option"
        aria-selected=${isSelected}
      >
        ${this.showCheckbox(item) ? html`
          <input
            type="checkbox"
            .checked=${this.isItemChecked(item)}
            @change=${(e) => this.handleCheckChange(item, e)}
            @click=${(e) => e.stopPropagation()}
          />
        ` : nothing}
        ${item.isFolder || item.isSite ? FOLDER_ICON : PAGE_ICON}
        <span class="item-label">${item.name}</span>
        ${item.isFolder || item.isSite ? ARROW_RIGHT : nothing}
      </div>
    `;
  }

  renderColumn(col, colIdx) {
    const isActive = colIdx === this._activeColumnIdx;
    const isLoading = this._loadingColumn === colIdx;

    return html`
      <div class="column ${isActive ? 'active' : ''}">
        <div class="column-header">
          ${colIdx > 0 ? html`
            <button class="back-btn" @click=${() => this.goBack()}>
              ${BACK_ARROW} Back
            </button>
          ` : nothing}
          ${col.header}
        </div>
        <div class="column-items" role="listbox" aria-label="${col.header}">
          ${isLoading ? html`
            <div class="column-loading">
              <div class="mini-spinner"></div> Loading\u2026
            </div>
          ` : nothing}
          ${!isLoading && col.items.length === 0 ? html`
            <div class="column-empty">Empty folder</div>
          ` : nothing}
          ${!isLoading ? col.items.map(
    (item, idx) => this.renderItem(colIdx, item, idx),
  ) : nothing}
        </div>
      </div>
    `;
  }

  render() {
    if (!this._columns.length) {
      return html`<div class="browser"><div class="column-empty">No sites available</div></div>`;
    }

    const loadingNext = this._loadingColumn === this._columns.length;

    return html`
      <div class="browser" tabindex="0" @keydown=${this._handleKeydown}>
        ${this._columns.map((col, idx) => this.renderColumn(col, idx))}
        ${loadingNext ? html`
          <div class="column active">
            <div class="column-header">Loading\u2026</div>
            <div class="column-items">
              <div class="column-loading">
                <div class="mini-spinner"></div> Loading\u2026
              </div>
            </div>
          </div>
        ` : nothing}
      </div>
    `;
  }
}

customElements.define('msm-column-browser', MsmColumnBrowser);
