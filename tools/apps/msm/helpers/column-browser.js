/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console, class-methods-use-this */
import { LitElement, html, nothing } from 'da-lit';
import {
  listFolder, listFolderWithInheritance, isActionableItem, getSatellitePageStatus,
} from './api.js';

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
const INHERITED_BADGE = html`<svg class="inherited-badge" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" fill="currentColor"/></svg>`;

// Status icons (sync state + publish state)
const si = (d, vb = '0 0 14 14') => html`<svg class="item-status-icon" width="13" height="13" viewBox="${vb}" fill="none" stroke="currentColor">${d}</svg>`;
const ICON_DOC_CHECK = si(html`<path d="M2.5 1.5h6l3 3v8.5h-9V1.5z" stroke-width="1.5" stroke-linejoin="round"/><path d="M8.5 1.5v3h3" stroke-width="1.5" stroke-linejoin="round"/><path d="M4.5 7.5l1.8 1.8 3-3" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`);
const ICON_DOC_X = si(html`<path d="M2.5 1.5h6l3 3v8.5h-9V1.5z" stroke-width="1.5" stroke-linejoin="round"/><path d="M8.5 1.5v3h3" stroke-width="1.5" stroke-linejoin="round"/><path d="M5 6.8l4 4M9 6.8l-4 4" stroke-width="1.6" stroke-linecap="round"/>`);
const ICON_CIRCLE_CHECK = si(html`<circle cx="7" cy="7" r="5.5" stroke-width="1.5"/><path d="M4.5 7l2 2 3.5-3.5" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`);
const ICON_CIRCLE_ALERT = si(html`<circle cx="7" cy="7" r="5.5" stroke-width="1.5"/><path d="M7 4v3.5" stroke-width="1.6" stroke-linecap="round"/><circle cx="7" cy="9.8" r="0.85" fill="currentColor" stroke="none"/>`);
const ICON_TRI_ALERT = si(html`<path d="M7 1.5L12.5 11.5H1.5L7 1.5z" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 5.5v3" stroke-width="1.6" stroke-linecap="round"/><circle cx="7" cy="10" r="0.9" fill="currentColor" stroke="none"/>`);

const ICON2_MAP = {
  'not-rolled-out': { icon: ICON_CIRCLE_ALERT, color: 'var(--s2-red-700,#ff513d)', tip: 'Not yet previewed or published' },
  'preview-current': { icon: ICON_TRI_ALERT, color: 'var(--s2-orange-600,#fc7d00)', tip: 'Previewed — not yet published to live' },
  'preview-behind': { icon: ICON_CIRCLE_ALERT, color: 'var(--s2-red-700,#ff513d)', tip: 'Preview is out of date' },
  'preview-current-live-behind': { icon: ICON_TRI_ALERT, color: 'var(--s2-orange-600,#fc7d00)', tip: 'Preview current — published content is out of date' },
  'live-current': { icon: ICON_CIRCLE_CHECK, color: 'var(--s2-green-700,#0ba45d)', tip: 'Published and current' },
  'live-behind': { icon: ICON_CIRCLE_ALERT, color: 'var(--s2-red-700,#ff513d)', tip: 'Content changed — re-publish needed' },
};

function getPublishStatusKey({ previewState, liveState }) {
  if (liveState === 'current') return 'live-current';
  if (liveState === 'behind') return previewState === 'current' ? 'preview-current-live-behind' : 'live-behind';
  if (previewState === 'current') return 'preview-current';
  if (previewState === 'behind') return 'preview-behind';
  return 'not-rolled-out';
}

class MsmColumnBrowser extends LitElement {
  static properties = {
    org: { type: String },
    role: { type: String },
    site: { type: String },
    msmConfig: { attribute: false },
    hideInherited: { type: Boolean },
    deepLinkPath: { type: String },
    _columns: { state: true },
    _checked: { state: true },
    _unchecked: { state: true },
    _activeColumnIdx: { state: true },
    _loadingColumn: { state: true },
    _focusedItem: { state: true },
    _selectionCategory: { state: true },
    _itemStatus: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sl, sheet].filter(Boolean);
    this._columns = [];
    this._checked = new Set();
    this._unchecked = new Set();
    this._itemStatus = new Map();
    this._activeColumnIdx = 0;
    this._loadingColumn = -1;
    this._focusedItem = null;
    this._selectionCategory = null;
    this._folderCache = new Map();
    this._mergedFolderCache = new Map();
    // Monotonic counter used by `emitSelection` to detect and drop stale
    // dispatches when the user check/unchecks faster than folder pages load.
    this._emitSeq = 0;
    this._handleKeydown = this._onKeydown.bind(this);

    if (this.role === 'satellite') {
      // Satellite: content starts at the satellite's own root (no sites list)
      this.initSiteRoot();
    } else {
      // Base / dual: always anchor with the sites list as column 0
      this.initSitesColumn();
      if (this.site) this._initFromSite(this.site);
    }
  }

  async _initFromSite(site) {
    const siteItem = this._columns[0]?.items.find((it) => it.site === site);
    if (!siteItem) return;
    await this.navigateToFolder(0, siteItem);
    if (this.deepLinkPath && !this._deepLinkConsumed) {
      this._deepLinkConsumed = true;
      // Column 0 is now the sites list; site root content is in column 1.
      await this._navigateToPath(this.deepLinkPath, 1);
    }
  }

  updated(changed) {
    if (changed.has('hideInherited') && this.hideInherited) {
      this._pruneHiddenInheritedChecks();
    }
  }

  _setFocus(columnIdx, item) {
    this._focusedItem = item ? {
      columnIdx,
      path: item.path,
      site: item.site || '',
    } : null;
  }

  _getActiveFocusedIdx() {
    const f = this._focusedItem;
    if (!f || f.columnIdx !== this._activeColumnIdx) return -1;
    const col = this._columns[this._activeColumnIdx];
    if (!col) return -1;
    const items = this._visibleItems(col);
    return items.findIndex((it) => (
      it.path === f.path && (it.site || '') === f.site
    ));
  }

  _pruneHiddenInheritedChecks() {
    if (!this._checked.size) return;
    const itemByKey = new Map();
    this._columns.forEach((col) => {
      col.items.forEach((it) => {
        itemByKey.set(`${it.site || ''}:${it.path}`, it);
      });
    });

    const next = new Set(this._checked);
    let modified = false;
    this._checked.forEach((key) => {
      const it = itemByKey.get(key);
      if (it?.inheritedFrom) {
        next.delete(key);
        modified = true;
      }
    });
    if (!modified) return;

    this._checked = next;
    this._focusedItem = null;
    this._refreshSelectionCategory();
    this.emitSelection(this.getCurrentSite());
  }

  _itemCategory(item) {
    if (item.inheritedFrom) return 'inherited';
    if (item.hasLocalOverride) return 'overridden';
    return 'local';
  }

  _isCheckBlocked(item) {
    if (!this._selectionCategory) return false;
    if (this.isItemChecked(item)) return false;
    return this._itemCategory(item) !== this._selectionCategory;
  }

  invalidateMergedCache() {
    this._mergedFolderCache = new Map();
  }

  _siteHasInheritance(site) {
    if (!this.msmConfig || !site) return false;
    return (this.msmConfig.rows || [])
      .some((row) => row.satellite === site);
  }

  async _loadFolderItems(site, path) {
    if (this._siteHasInheritance(site)) {
      const cacheKey = `${site}::${path}`;
      if (this._mergedFolderCache.has(cacheKey)) {
        return this._mergedFolderCache.get(cacheKey);
      }
      const items = await listFolderWithInheritance(this.org, site, path, this.msmConfig);
      this._mergedFolderCache.set(cacheKey, items);
      return items;
    }
    return listFolder(this.org, site, path);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  _onKeydown(e) {
    const col = this._columns[this._activeColumnIdx];
    if (!col) return;
    const items = this._visibleItems(col);
    if (!items.length) return;
    const curIdx = this._getActiveFocusedIdx();

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const nextIdx = Math.min(curIdx + 1, items.length - 1);
        this._setFocus(this._activeColumnIdx, items[nextIdx]);
        this.scrollFocusedIntoView();
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prevIdx = Math.max(curIdx - 1, 0);
        this._setFocus(this._activeColumnIdx, items[prevIdx]);
        this.scrollFocusedIntoView();
        break;
      }
      case 'ArrowRight':
      case 'Enter': {
        e.preventDefault();
        const item = items[curIdx];
        if (item && (item.isFolder || item.isSite)) {
          const fromColumn = this._activeColumnIdx;
          this.navigateToFolder(fromColumn, item).then(() => {
            const newCol = this._columns[fromColumn + 1];
            const visible = newCol ? this._visibleItems(newCol) : [];
            if (visible.length) {
              this._setFocus(fromColumn + 1, visible[0]);
              this.scrollFocusedIntoView();
            }
          });
        }
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        if (this._activeColumnIdx > 0) {
          this._activeColumnIdx -= 1;
          const prevCol = this._columns[this._activeColumnIdx];
          const visible = prevCol ? this._visibleItems(prevCol) : [];
          this._setFocus(this._activeColumnIdx, visible[0] || null);
        }
        break;
      }
      case ' ': {
        e.preventDefault();
        const item = items[curIdx];
        if (item && this.showCheckbox(item)) {
          this.toggleCheck(item, this._activeColumnIdx);
        }
        break;
      }
      default:
        break;
    }
  }

  _findItemElement(colIdx, path, site = '') {
    const lists = this.shadowRoot.querySelectorAll('.column .column-items');
    const list = lists[colIdx];
    if (!list) return null;
    return Array.from(list.querySelectorAll('.item')).find((el) => (
      el.dataset.path === path
      && (el.dataset.site || '') === (site || '')
    )) || null;
  }

  scrollItemIntoView(colIdx, path, site = '', { block = 'nearest', behavior = 'auto' } = {}) {
    return this.updateComplete.then(() => new Promise((resolve) => {
      requestAnimationFrame(() => {
        const target = this._findItemElement(colIdx, path, site);
        if (target) {
          target.scrollIntoView({ block, behavior, inline: 'nearest' });
        }
        resolve();
      });
    }));
  }

  scrollFocusedIntoView() {
    const f = this._focusedItem;
    if (!f) return this.updateComplete;
    return this.scrollItemIntoView(f.columnIdx, f.path, f.site);
  }

  // Scroll the current selection into view (focused, checked, or path highlight).
  // Used after deep-link navigation when the target row may be below the fold.
  scrollSelectionIntoView({ block = 'center', behavior = 'smooth' } = {}) {
    if (this._focusedItem) {
      const { columnIdx, path, site } = this._focusedItem;
      return this.scrollItemIntoView(columnIdx, path, site, { block, behavior });
    }

    for (let c = this._columns.length - 1; c >= 0; c -= 1) {
      const col = this._columns[c];
      const visible = this._visibleItems(col);
      const checked = visible.find((item) => this.isItemChecked(item));
      if (checked) {
        return this.scrollItemIntoView(
          c,
          checked.path,
          checked.site || '',
          { block, behavior },
        );
      }
    }

    const highlighted = [...this._columns].reverse().find((col) => col.selectedPath);
    if (highlighted) {
      const item = highlighted.items.find((it) => it.path === highlighted.selectedPath);
      if (item) {
        const colIdx = this._columns.indexOf(highlighted);
        return this.scrollItemIntoView(
          colIdx,
          item.path,
          item.site || '',
          { block, behavior },
        );
      }
    }

    return this.updateComplete;
  }

  scrollToActiveColumn() {
    return this.updateComplete.then(() => new Promise((resolve) => {
      requestAnimationFrame(() => {
        if (window.innerWidth > 600) {
          const browser = this.shadowRoot.querySelector('.browser');
          if (browser) {
            browser.scrollTo({ left: browser.scrollWidth, behavior: 'smooth' });
          }
        }
        resolve();
      });
    }));
  }

  toggleCheck(item, colIdx) {
    if (this._isCheckBlocked(item)) return;
    // The user is acting on column `colIdx`; any deeper columns belong to a
    // previously-opened folder that's no longer the current focus. Collapse
    // them so the browser reflects the user's new context.
    if (Number.isInteger(colIdx)) this._collapseColumnsAfter(colIdx);

    const key = this._itemKey(item);
    // Use display state so keyboard-toggling a propagated-checked folder unchecks it.
    const isChecked = this._displayChecked(item, colIdx);
    const nextChecked = new Set(this._checked);
    const nextUnchecked = new Set(this._unchecked);
    const prefix = this._childPrefix(item);

    if (isChecked) {
      if (this._isAncestorChecked(item)) {
        nextUnchecked.add(key);
      } else {
        nextChecked.delete(key);
        [...nextChecked].forEach((k) => { if (k.startsWith(prefix)) nextChecked.delete(k); });
        [...nextUnchecked].forEach((k) => { if (k.startsWith(prefix)) nextUnchecked.delete(k); });
      }
      this._clearFocusIfMatches(item);
    } else if (nextUnchecked.has(key)) {
      nextUnchecked.delete(key);
    } else {
      nextChecked.add(key);
      [...nextChecked].forEach((k) => { if (k.startsWith(prefix)) nextChecked.delete(k); });
      [...nextUnchecked].forEach((k) => { if (k.startsWith(prefix)) nextUnchecked.delete(k); });
    }

    this._checked = nextChecked;
    this._unchecked = nextUnchecked;
    if (item.isSite && !isChecked) this._clearOtherSiteChecks(key);
    this._refreshSelectionCategory();
    const site = item.site || this.getCurrentSite();
    this.emitSelection(site);
  }

  // Drops every column to the right of `colIdx` and prunes any checks that
  // lived in those discarded columns. No-op when `colIdx` is already the
  // rightmost column.
  _collapseColumnsAfter(colIdx) {
    if (colIdx >= this._columns.length - 1) return;
    this._columns = this._columns.slice(0, colIdx + 1);
    if (this._activeColumnIdx > colIdx) this._activeColumnIdx = colIdx;
    if (this._focusedItem && this._focusedItem.columnIdx > colIdx) {
      this._focusedItem = null;
    }
    this.clearChecksAfterColumn(colIdx);
  }

  _clearFocusIfMatches(item) {
    const f = this._focusedItem;
    if (!f) return;
    if (f.path === item.path && f.site === (item.site || '')) {
      this._focusedItem = null;
    }
  }

  initSitesColumn() {
    const rows = this.msmConfig?.rows;
    if (!rows?.length) return;

    // Collect all sites (both bases and satellites) with their labels.
    // Base-site labels come from label rows (base set, satellite empty, title set).
    // Satellite labels come from the relationship row's title field.
    const sitesMap = new Map();
    rows.forEach((row) => {
      if (row.base && !sitesMap.has(row.base)) {
        const labelRow = rows.find((r) => r.base === row.base && !r.satellite);
        sitesMap.set(row.base, labelRow?.title || row.base);
      }
      if (row.satellite && !sitesMap.has(row.satellite)) {
        sitesMap.set(row.satellite, row.title || row.satellite);
      }
    });

    const items = [...sitesMap.entries()].map(([site, label]) => ({
      name: label,
      path: site,
      isFolder: true,
      isSite: true,
      site,
    }));
    this._columns = [{ header: 'Sites', items, selectedPath: null }];
  }

  async initSiteRoot() {
    this._loadingColumn = 0;
    this._columns = [{
      header: this.site, items: [], selectedPath: null,
    }];

    try {
      const items = await this._loadFolderItems(this.site, '/');
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
    this._loadColumnStatus(this._columns[0]?.items || [], this.site);

    if (this.deepLinkPath && !this._deepLinkConsumed) {
      this._deepLinkConsumed = true;
      await this._navigateToPath(this.deepLinkPath);
    }
  }

  async _navigateToPath(path, startColIdx = 0) {
    const requested = path;
    const normalized = path.startsWith('/') ? path : `/${path}`;
    const parts = normalized.split('/').filter(Boolean);

    this._suppressEmit = true;
    let colIdx = startColIdx;
    let cumPath = '';
    let lastResolved = '';
    let resolvedFully = parts.length === 0;

    try {
      /* eslint-disable no-await-in-loop */
      for (let i = 0; i < parts.length; i += 1) {
        cumPath += `/${parts[i]}`;
        const stepPath = cumPath;
        const col = this._columns[colIdx];
        if (!col) break;

        const isLast = i === parts.length - 1;
        let item = col.items.find((it) => it.path === stepPath);
        if (!item && isLast && !/\.[a-z0-9]+$/i.test(parts[i])) {
          // Fall back to `.html` when the last segment lacks an extension.
          const htmlPath = `${stepPath}.html`;
          item = col.items.find((it) => it.path === htmlPath);
        }
        if (!item) break;
        lastResolved = item.path;

        if (isLast) {
          if (item.isFolder || item.isSite) {
            await this.navigateToFolder(colIdx, item);
          } else if (this.showCheckbox(item)) {
            this.toggleCheck(item, colIdx);
            this._setFocus(colIdx, item);
          }
          resolvedFully = true;
        } else if (item.isFolder || item.isSite) {
          await this.navigateToFolder(colIdx, item);
          colIdx += 1;
        } else {
          // Path expects a folder here but got a page; stop the walk.
          break;
        }
      }
      /* eslint-enable no-await-in-loop */
    } finally {
      this._suppressEmit = false;
    }

    await this.emitSelection(this.getCurrentSite());

    if (!resolvedFully) {
      this.dispatchEvent(new CustomEvent('deep-link-warning', {
        detail: { requestedPath: requested, lastResolvedPath: lastResolved },
        bubbles: true,
        composed: true,
      }));
    }
    this.dispatchEvent(new CustomEvent('deep-link-consumed', {
      bubbles: true,
      composed: true,
    }));

    await this.scrollToActiveColumn();
    await this.scrollSelectionIntoView({ block: 'center', behavior: 'smooth' });
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
        items = await this._loadFolderItems(site, '/');
      } else {
        items = await this._loadFolderItems(site, item.path);
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
    this._loadColumnStatus(this._columns[this._columns.length - 1]?.items || [], site);
    this.emitSelection(site);
  }

  _loadColumnStatus(items, site) {
    if (!this.org || !site) return;
    items.filter((i) => isActionableItem(i)).forEach(async (item) => {
      const cleanPath = item.path.replace(/\.[^/.]+$/, '');
      const status = await getSatellitePageStatus(this.org, site, cleanPath);
      const next = new Map(this._itemStatus);
      next.set(this._itemKey(item), status);
      this._itemStatus = next;
    });
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
      this.toggleCheck(item, colIdx);
    }
  }

  handleCheckChange(item, e, colIdx) {
    e.stopPropagation();
    if (this._isCheckBlocked(item)) {
      e.target.checked = false;
      return;
    }
    if (Number.isInteger(colIdx)) this._collapseColumnsAfter(colIdx);

    const key = this._itemKey(item);
    const wantChecked = e.target.checked;
    const nextChecked = new Set(this._checked);
    const nextUnchecked = new Set(this._unchecked);
    const prefix = this._childPrefix(item);

    if (wantChecked) {
      nextUnchecked.delete(key);
      if (!this._isAncestorChecked(item)) nextChecked.add(key);
      // Clear redundant individual child-checks and child exclusions.
      [...nextChecked].forEach((k) => { if (k.startsWith(prefix)) nextChecked.delete(k); });
      [...nextUnchecked].forEach((k) => { if (k.startsWith(prefix)) nextUnchecked.delete(k); });
    } else if (this._isAncestorChecked(item)) {
      nextUnchecked.add(key);
    } else {
      nextChecked.delete(key);
      this._clearFocusIfMatches(item);
      // Clear all individually-checked descendants and exclusions.
      [...nextChecked].forEach((k) => { if (k.startsWith(prefix)) nextChecked.delete(k); });
      [...nextUnchecked].forEach((k) => { if (k.startsWith(prefix)) nextUnchecked.delete(k); });
    }

    this._checked = nextChecked;
    this._unchecked = nextUnchecked;
    if (item.isSite && wantChecked) this._clearOtherSiteChecks(key);
    this._refreshSelectionCategory();
    const site = item.site || this.getCurrentSite();
    this.emitSelection(site);
  }

  _refreshSelectionCategory() {
    if (this._checked.size === 0) {
      this._selectionCategory = null;
      return;
    }
    const firstKey = this._checked.values().next().value;
    let category = null;
    this._columns.some((col) => col.items.some((item) => {
      const key = `${item.site || ''}:${item.path}`;
      if (key === firstKey) {
        category = this._itemCategory(item);
        return true;
      }
      return false;
    }));
    this._selectionCategory = category;
  }

  clearChecksAfterColumn(colIdx) {
    const validPaths = new Set(
      this._columns.slice(0, colIdx + 1).flatMap(
        (col) => col.items.map((item) => this._itemKey(item)),
      ),
    );
    const removed = new Set([...this._checked].filter((key) => !validPaths.has(key)));
    this._checked = new Set([...this._checked].filter((key) => validPaths.has(key)));
    // Drop _unchecked entries whose containing folder/site was just removed.
    let nextUnchecked = this._unchecked;
    removed.forEach((removedKey) => {
      const [s, p] = removedKey.split(':');
      // Site item: key "site:site" → child prefix is "site:/"
      // Folder item: key "site:/path" → child prefix is "site:/path/"
      const prefix = s === p ? `${s}:/` : `${removedKey}/`;
      if ([...nextUnchecked].some((k) => k.startsWith(prefix))) {
        nextUnchecked = new Set([...nextUnchecked].filter((k) => !k.startsWith(prefix)));
      }
    });
    this._unchecked = nextUnchecked;
    this._refreshSelectionCategory();
  }

  async emitSelection(site) {
    if (this._suppressEmit) return;
    // Snapshot `_checked` synchronously so a later check/uncheck that fires
    // its own `emitSelection` can't mutate what this call considers selected.
    // Combined with the seq check below, this guarantees an in-flight stale
    // dispatch can never re-introduce items the user has just unchecked.
    this._emitSeq += 1;
    const mySeq = this._emitSeq;
    const checkedSnapshot = new Set(this._checked);
    const checkedPages = [];
    const checkedFolders = [];

    this._columns.forEach((col) => {
      col.items.forEach((item) => {
        const key = `${item.site || site || ''}:${item.path}`;
        if (!checkedSnapshot.has(key)) return;
        if (item.isFolder || item.isSite) {
          checkedFolders.push(item);
        } else {
          checkedPages.push(item);
        }
      });
    });

    const folderPages = await Promise.all(
      checkedFolders.map(async (folder) => {
        const folderSite = folder.site || site;
        const folderPath = folder.isSite ? '/' : folder.path;
        const cacheKey = `${this.org}/${folderSite}${folderPath}`;
        if (!this._folderCache.has(cacheKey)) {
          try {
            const items = await this._loadFolderItems(folderSite, folderPath);
            // Cache the full list; _unchecked filter is applied at read-time below
            // so exclusion changes don't require a cache invalidation.
            this._folderCache.set(
              cacheKey,
              items.filter((i) => !i.isFolder && !i.isSite).map((i) => ({ ...i, site: folderSite })),
            );
          } catch (e) {
            console.error('Failed to resolve folder pages:', e);
            this._folderCache.set(cacheKey, []);
          }
        }
        return (this._folderCache.get(cacheKey) || [])
          .filter((i) => !this._unchecked.has(this._itemKey(i)) && !this._isAncestorUnchecked(i));
      }),
    );

    // A newer `emitSelection` has started (user clicked again while we were
    // awaiting folder loads); drop this stale result instead of overriding
    // the newer dispatch with files for a no-longer-checked folder.
    if (mySeq !== this._emitSeq) return;

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

  _itemKey(item) {
    return `${item.site || ''}:${item.path}`;
  }

  // Returns the key prefix that covers all descendants of item in _checked/_unchecked.
  // Site items (path === site name, no leading /) use "site:/" as their child scope.
  _childPrefix(item) {
    const site = item.site || '';
    return item.isSite ? `${site}:/` : `${this._itemKey(item)}/`;
  }

  _isAncestorChecked(item) {
    const site = item.site || '';
    if (this._checked.has(`${site}:${site}`)) return true;
    const parts = item.path.split('/').filter(Boolean);
    for (let i = parts.length - 1; i >= 1; i -= 1) {
      const ancestorPath = `/${parts.slice(0, i).join('/')}`;
      if (this._checked.has(`${site}:${ancestorPath}`)) return true;
    }
    return false;
  }

  // Mirror of _isAncestorChecked but for _unchecked. If a parent folder/site
  // was explicitly excluded, its descendants are also excluded.
  _isAncestorUnchecked(item) {
    const site = item.site || '';
    if (this._unchecked.has(`${site}:${site}`)) return true;
    const parts = item.path.split('/').filter(Boolean);
    for (let i = parts.length - 1; i >= 1; i -= 1) {
      const ancestorPath = `/${parts.slice(0, i).join('/')}`;
      if (this._unchecked.has(`${site}:${ancestorPath}`)) return true;
    }
    return false;
  }

  _isFolderIndeterminate(folder) {
    if (!this.isItemChecked(folder)) return false;
    const prefix = this._childPrefix(folder);
    return [...this._unchecked].some((k) => k.startsWith(prefix));
  }

  // Returns 'checked' | 'indeterminate' | 'unchecked' | null based on visible
  // children in the adjacent column. Only applies when this item is the
  // currently-expanded item (its child column is open). null = not expanded.
  _folderChildState(item, colIdx) {
    const col = this._columns[colIdx];
    if (col?.selectedPath !== item.path) return null;
    const childCol = this._columns[colIdx + 1];
    if (!childCol) return null;
    const checkable = this._visibleItems(childCol).filter((i) => this.showCheckbox(i));
    if (!checkable.length) return null;
    const checkedCount = checkable.filter((i) => this._displayChecked(i, colIdx + 1)).length;
    if (checkedCount === 0) return 'unchecked';
    if (checkedCount === checkable.length) return 'checked';
    return 'indeterminate';
  }

  // Display-only checked state — includes upward propagation from visible children.
  // Used only for rendering; does not affect toggle logic.
  _displayChecked(item, colIdx) {
    if (this.isItemChecked(item)) return true;
    if (item.isFolder || item.isSite) {
      return this._folderChildState(item, colIdx) === 'checked';
    }
    return false;
  }

  // Display-only indeterminate state — includes upward propagation.
  _displayIndeterminate(item, colIdx) {
    if (!(item.isFolder || item.isSite)) return false;
    if (this.isItemChecked(item) && this._isFolderIndeterminate(item)) return true;
    return this._folderChildState(item, colIdx) === 'indeterminate';
  }

  isItemChecked(item) {
    const key = this._itemKey(item);
    if (this._unchecked.has(key)) return false;
    if (this._isAncestorUnchecked(item)) return false;
    if (this._checked.has(key)) return true;
    return this._isAncestorChecked(item);
  }

  showCheckbox(item) {
    return isActionableItem(item) || item.isFolder || item.isSite;
  }

  // Sites are single-select: checking a new site clears any previous site check.
  _clearOtherSiteChecks(exceptKey) {
    const nextChecked = new Set(this._checked);
    let nextUnchecked = new Set(this._unchecked);
    nextChecked.forEach((key) => {
      // Site keys have format "site:site" (same value both sides of colon)
      const [s, p] = key.split(':');
      if (s === p && key !== exceptKey) {
        nextChecked.delete(key);
        const prefix = `${s}:/`;
        nextUnchecked = new Set([...nextUnchecked].filter((k) => !k.startsWith(prefix)));
      }
    });
    this._checked = nextChecked;
    this._unchecked = nextUnchecked;
  }

  _renderItemIcons(item) {
    if (!isActionableItem(item)) return nothing;
    let icon1 = nothing;
    if (item.inheritedFrom) {
      icon1 = html`<span class="item-status-icon" style="color:var(--s2-green-700,#0ba45d)" title="Inherited from ${item.inheritedFrom}">${ICON_DOC_CHECK}</span>`;
    } else if (item.hasLocalOverride) {
      icon1 = html`<span class="item-status-icon" style="color:var(--s2-orange-600,#fc7d00)" title="Local copy (overrides base)">${ICON_DOC_X}</span>`;
    }
    const status = this._itemStatus.get(this._itemKey(item));
    let icon2 = nothing;
    if (status) {
      const cfg = ICON2_MAP[getPublishStatusKey(status)];
      if (cfg) icon2 = html`<span class="item-status-icon" style="color:${cfg.color}" title=${cfg.tip}>${cfg.icon}</span>`;
    }
    if (icon1 === nothing && icon2 === nothing) return nothing;
    return html`<span class="item-status-icons">${icon1}${icon2}</span>`;
  }

  renderItem(colIdx, item) {
    const isSelected = this._columns[colIdx]?.selectedPath === item.path;
    const isPathAncestor = isSelected
      && (item.isFolder || item.isSite)
      && colIdx < this._columns.length - 1;
    const f = this._focusedItem;
    const isFocused = !!f
      && f.columnIdx === colIdx
      && f.path === item.path
      && f.site === (item.site || '');
    const isInherited = !!item.inheritedFrom;
    const blocked = this._isCheckBlocked(item);
    const tooltipParts = [];
    if (isInherited) tooltipParts.push(`Inherited from ${item.inheritedFrom}`);
    if (blocked) {
      tooltipParts.push(`Cannot mix with ${this._selectionCategory} pages. Clear the selection to switch categories.`);
    }
    const title = tooltipParts.join(' \u2022 ') || undefined;
    return html`
      <div
        class="item ${isSelected ? 'selected' : ''} ${isPathAncestor ? 'path-ancestor' : ''} ${isFocused ? 'focused' : ''} ${isInherited ? 'inherited' : ''} ${blocked ? 'blocked' : ''}"
        data-path=${item.path}
        data-site=${item.site || ''}
        @click=${(e) => this.handleItemClick(colIdx, item, e)}
        title=${title || nothing}
        role="option"
        aria-selected=${isSelected}
      >
        ${this.showCheckbox(item) ? html`
          <input
            type="checkbox"
            .checked=${this._displayChecked(item, colIdx)}
            .indeterminate=${this._displayIndeterminate(item, colIdx)}
            ?disabled=${blocked}
            @change=${(e) => this.handleCheckChange(item, e, colIdx)}
            @click=${(e) => e.stopPropagation()}
          />
        ` : nothing}
        ${item.isFolder || item.isSite ? FOLDER_ICON : PAGE_ICON}
        ${isInherited ? INHERITED_BADGE : nothing}
        <span class="item-label">${item.name}</span>
        ${this._renderItemIcons(item)}
        ${item.isFolder || item.isSite ? ARROW_RIGHT : nothing}
      </div>
    `;
  }

  _visibleItems(col) {
    if (!this.hideInherited) return col.items;
    return col.items.filter((i) => !i.inheritedFrom);
  }

  renderColumn(col, colIdx) {
    const isActive = colIdx === this._activeColumnIdx;
    const isLoading = this._loadingColumn === colIdx;
    const items = this._visibleItems(col);

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
          ${!isLoading && items.length === 0 ? html`
            <div class="column-empty">Empty folder</div>
          ` : nothing}
          ${!isLoading ? items.map(
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
