/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console, class-methods-use-this */
import { LitElement, html, nothing } from 'da-lit';
import { listFolder, listFolderWithInheritance, isActionableItem } from './api.js';

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
    _activeColumnIdx: { state: true },
    _loadingColumn: { state: true },
    _focusedItem: { state: true },
    _selectionCategory: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sl, sheet].filter(Boolean);
    this._columns = [];
    this._checked = new Set();
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

  _updateUrl(site, path) {
    console.log('[MSM] _updateUrl called', { site, path, org: this.org, hasReplaceState: !!window.history?.replaceState });
    if (!window.history?.replaceState || !this.org) return;
    const params = new URLSearchParams(window.location.search);
    params.set('org', this.org);
    if (site) params.set('site', site); else params.delete('site');
    if (path) params.set('path', path); else params.delete('path');
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    console.log('[MSM] replaceState ->', newUrl);
    window.history.replaceState(null, '', newUrl);
  }

  _getCurrentBrowsedPath() {
    for (let i = this._columns.length - 1; i >= 0; i -= 1) {
      const col = this._columns[i];
      if (col.selectedPath) {
        const item = col.items.find((it) => it.path === col.selectedPath);
        if (item && !item.isSite) return col.selectedPath;
        return null;
      }
    }
    return null;
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
    const next = new Set(this._checked);
    const key = `${item.site || ''}:${item.path}`;
    const willUncheck = next.has(key);
    if (willUncheck) next.delete(key);
    else next.add(key);
    this._checked = next;
    if (willUncheck) this._clearFocusIfMatches(item);
    this._refreshSelectionCategory();
    const site = item.site || this.getCurrentSite();
    const urlPath = willUncheck ? this._getCurrentBrowsedPath() : item.path;
    this._updateUrl(site, urlPath);
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
    console.log('[MSM] navigateToFolder end', { site, path: item.path, suppressEmit: this._suppressEmit });
    if (!this._suppressEmit) {
      this._updateUrl(site, item.isSite ? null : item.path);
    }
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
    const next = new Set(this._checked);
    const key = `${item.site || ''}:${item.path}`;
    if (e.target.checked) {
      next.add(key);
    } else {
      next.delete(key);
      this._clearFocusIfMatches(item);
    }
    this._checked = next;
    this._refreshSelectionCategory();

    const site = item.site || this.getCurrentSite();
    const urlPath = e.target.checked ? item.path : this._getCurrentBrowsedPath();
    this._updateUrl(site, urlPath);
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
        (col) => col.items.map((item) => `${item.site || ''}:${item.path}`),
      ),
    );
    this._checked = new Set([...this._checked].filter((key) => validPaths.has(key)));
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
            const items = await this._loadFolderItems(folderSite, folder.path);
            const files = items
              .filter((i) => !i.isFolder && !i.isSite)
              .map((i) => ({ ...i, site: folderSite }));
            this._folderCache.set(cacheKey, files);
          } catch (e) {
            console.error('Failed to resolve folder pages:', e);
            this._folderCache.set(cacheKey, []);
          }
        }
        return this._folderCache.get(cacheKey);
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

  isItemChecked(item) {
    const key = `${item.site || ''}:${item.path}`;
    return this._checked.has(key);
  }

  showCheckbox(item) {
    return !item.isSite && (isActionableItem(item) || item.isFolder);
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
            .checked=${this.isItemChecked(item)}
            ?disabled=${blocked}
            @change=${(e) => this.handleCheckChange(item, e, colIdx)}
            @click=${(e) => e.stopPropagation()}
          />
        ` : nothing}
        ${item.isFolder || item.isSite ? FOLDER_ICON : PAGE_ICON}
        ${isInherited ? INHERITED_BADGE : nothing}
        <span class="item-label">${item.name}</span>
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
