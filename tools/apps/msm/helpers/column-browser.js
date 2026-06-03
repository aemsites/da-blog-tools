/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console, class-methods-use-this */
import { LitElement, html, nothing } from 'da-lit';
import {
  listFolder,
  listFolderWithInheritance,
  isActionableItem,
  getAllMsmSites,
  getPageStatus,
  getStatusConfig,
} from './api.js';
import { icon } from '../core/icons.js';

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

const GLOBE_ICON = icon('S2_Icon_GlobeGrid_20_N');
const FOLDER_ICON = icon('S2_Icon_Folder_20_N');
const PAGE_ICON = icon('S2_Icon_File_20_N');
const ARROW_RIGHT = icon('S2_Icon_ChevronRight_20_N', '0 0 20 20', 14, 14);
const BACK_ARROW = icon('S2_Icon_ChevronLeft_20_N', '0 0 20 20', 14, 14);

// Out-of-sync tolerance: publishing bumps lastModified slightly after the fact.
const PUBLISH_LAG_MS = 5000;

const itemKey = (item) => `${item.site || ''}:${item.path}`;
const parseKey = (key) => {
  const idx = key.indexOf(':');
  return { site: key.slice(0, idx), path: key.slice(idx + 1) };
};

class MsmColumnBrowser extends LitElement {
  static properties = {
    org: { type: String },
    msmConfig: { attribute: false },
    initialSite: { type: String },
    initialPath: { type: String },
    _columns: { state: true },
    _selectedPages: { state: true },
    _checkedContainers: { state: true },
    _rowStatus: { state: true },
    _activeColumnIdx: { state: true },
    _loadingColumn: { state: true },
    _focusedItem: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sl, sheet].filter(Boolean);
    this._columns = [];
    this._selectedPages = new Map();
    this._checkedContainers = new Set();
    this._rowStatus = new Map();
    this._activeColumnIdx = 0;
    this._loadingColumn = -1;
    this._focusedItem = null;
    this._mergedFolderCache = new Map();
    // Per-container crawl generation; bumping it cancels an in-flight crawl.
    this._crawlGen = new Map();
    this._initKey = null;
    this._handleKeydown = this._onKeydown.bind(this);
    this._maybeInit();
  }

  updated(changed) {
    if (changed.has('org') || changed.has('msmConfig')
      || changed.has('initialSite') || changed.has('initialPath')) {
      this._maybeInit();
    }
  }

  _maybeInit() {
    if (!this.org || !this.msmConfig) return;
    const key = `${this.org}|${this.initialSite || ''}|${this.initialPath || ''}`;
    if (key === this._initKey) return;
    this._initKey = key;
    this._selectedPages = new Map();
    this._checkedContainers = new Set();
    this._rowStatus = new Map();
    this._crawlGen = new Map();
    this._focusedItem = null;
    this._activeColumnIdx = 0;
    this.initSitesColumn();
    if (this.initialSite) this._openDeepLink();
  }

  invalidateMergedCache() {
    this._mergedFolderCache = new Map();
  }

  _siteHasInheritance(site) {
    if (!this.msmConfig || !site) return false;
    return (this.msmConfig.rows || []).some((row) => row.satellite === site);
  }

  async _loadFolderItems(site, path) {
    if (this._siteHasInheritance(site)) {
      const cacheKey = `${site}::${path}`;
      if (this._mergedFolderCache.has(cacheKey)) return this._mergedFolderCache.get(cacheKey);
      const items = await listFolderWithInheritance(this.org, site, path, this.msmConfig);
      this._mergedFolderCache.set(cacheKey, items);
      return items;
    }
    return listFolder(this.org, site, path);
  }

  // ── Sites column ──────────────────────────────────────────────────────────

  initSitesColumn() {
    const sites = getAllMsmSites(this.msmConfig);
    const items = sites.map((s) => ({
      name: s.label,
      path: s.site,
      site: s.site,
      isSite: true,
      isFolder: false,
    }));
    this._columns = [{ header: 'Sites', items, selectedPath: null }];
  }

  // ── Deep linking ────────────────────────────────────────────────────────

  async _openDeepLink() {
    const siteItem = this._columns[0]?.items.find((it) => it.site === this.initialSite);
    if (!siteItem) {
      this._dispatchDeepLinkWarning(this.initialSite, '');
      this._dispatchDeepLinkConsumed();
      return;
    }
    await this.navigateToFolder(0, siteItem);
    if (this.initialPath) await this._walkPath(this.initialPath);
    this._dispatchDeepLinkConsumed();
    await this.scrollToActiveColumn();
    await this.scrollSelectionIntoView({ block: 'center', behavior: 'smooth' });
  }

  async _walkPath(path) {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    const parts = normalized.split('/').filter(Boolean);
    let colIdx = 1; // column 1 is the site root opened by _openDeepLink
    let cum = '';
    let lastResolved = '';
    let resolved = parts.length === 0;

    /* eslint-disable no-await-in-loop */
    for (let i = 0; i < parts.length; i += 1) {
      cum += `/${parts[i]}`;
      const stepPath = cum;
      const col = this._columns[colIdx];
      if (!col) break;
      const isLast = i === parts.length - 1;
      let item = col.items.find((it) => it.path === stepPath);
      if (!item && isLast && !/\.[a-z0-9]+$/i.test(parts[i])) {
        item = col.items.find((it) => it.path === `${stepPath}.html`);
      }
      if (!item) break;
      lastResolved = item.path;

      if (isLast) {
        if (item.isFolder) {
          await this.navigateToFolder(colIdx, item);
        } else if (this.showCheckbox(item)) {
          this._togglePage(item);
          this._setFocus(colIdx, item);
        }
        resolved = true;
      } else if (item.isFolder) {
        await this.navigateToFolder(colIdx, item);
        colIdx += 1;
      } else {
        break;
      }
    }
    /* eslint-enable no-await-in-loop */

    if (!resolved) this._dispatchDeepLinkWarning(path, lastResolved);
  }

  _dispatchDeepLinkWarning(requestedPath, lastResolvedPath) {
    this.dispatchEvent(new CustomEvent('deep-link-warning', {
      detail: { requestedPath, lastResolvedPath }, bubbles: true, composed: true,
    }));
  }

  _dispatchDeepLinkConsumed() {
    this.dispatchEvent(new CustomEvent('deep-link-consumed', { bubbles: true, composed: true }));
  }

  // Programmatically select a set of leaf pages at a site (used by the action
  // panel's "manage in base" hand-off). Opens the site, resolves each path to
  // its real leaf item, replaces the selection, and emits it.
  async selectPaths(site, paths) {
    if (!site || !paths?.length) return;
    const siteItem = this._columns[0]?.items.find((it) => it.site === site);
    if (!siteItem) return;
    await this.navigateToFolder(0, siteItem);
    const resolved = await Promise.all(paths.map((p) => this._resolveLeaf(site, p)));
    this._crawlGen.forEach((v, k) => this._crawlGen.set(k, v + 1));
    const selected = new Map();
    resolved.forEach((leaf) => { if (leaf) selected.set(itemKey(leaf), leaf); });
    this._selectedPages = selected;
    this._checkedContainers = new Set();
    this.emitSelection(site);
  }

  // Remove a single page from the selection (used by the action panel's
  // per-row remove control). Mirrors the deselect branch of _togglePage.
  deselectPath(site, path) {
    const key = `${site}:${path}`;
    if (!this._selectedPages.has(key)) return;
    const pages = new Map(this._selectedPages);
    pages.delete(key);
    const drop = new Set(this._ancestorContainerKeys(site, path));
    const containers = new Set();
    this._checkedContainers.forEach((k) => { if (!drop.has(k)) containers.add(k); });
    this._selectedPages = pages;
    this._checkedContainers = containers;
    this.emitSelection(site);
  }

  // Resolve a site-root-relative page path to its leaf item by listing the
  // folder it lives in. Returns null when the page doesn't exist on that site.
  async _resolveLeaf(site, path) {
    const idx = path.lastIndexOf('/');
    const parentPath = idx > 0 ? path.slice(0, idx) : '/';
    const items = await this._loadFolderItems(site, parentPath).catch(() => []);
    const leaf = items.find((it) => it.path === path);
    return leaf ? { ...leaf, site: leaf.site || site } : null;
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  async navigateToFolder(colIdx, item) {
    const { site } = item;
    if (!site) return;

    const newColumns = this._columns.slice(0, colIdx + 1);
    newColumns[colIdx] = { ...newColumns[colIdx], selectedPath: item.path };
    this._columns = newColumns;
    this._activeColumnIdx = colIdx + 1;
    this._loadingColumn = colIdx + 1;

    let items = [];
    try {
      const raw = await this._loadFolderItems(site, item.isSite ? '/' : item.path);
      items = raw.map((i) => ({ ...i, site: i.site || site }));
    } catch (e) {
      console.error('Failed to load folder:', e);
    }

    this._columns = [...newColumns, { header: item.name, items, selectedPath: null }];
    this._loadingColumn = -1;
    this.scrollToActiveColumn();
    this._loadRowStatuses(items);
  }

  getCurrentSite() {
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
    } else if (this.showCheckbox(item)) {
      this._togglePage(item);
    }
  }

  goBack() {
    if (this._activeColumnIdx > 0) this._activeColumnIdx -= 1;
  }

  // ── Selection model ─────────────────────────────────────────────────────
  // `_selectedPages` (Map<key,item>) is the canonical set of selected leaf
  // pages — this is what gets emitted. `_checkedContainers` (Set<key>) marks
  // sites/folders the user (or a crawl) has fully selected, for optimistic and
  // post-crawl "checked" display. A checked container shows checked instantly;
  // a background crawl then fills in the exact leaf pages.

  showCheckbox(item) {
    if (item.isSite || item.isFolder) return true;
    return isActionableItem(item);
  }

  isItemChecked(item) {
    if (item.isSite || item.isFolder) return this._checkedContainers.has(itemKey(item));
    return this._selectedPages.has(itemKey(item));
  }

  // 'checked' | 'indeterminate' | 'unchecked'
  checkboxState(item, colIdx) {
    if (!(item.isSite || item.isFolder)) {
      return this._selectedPages.has(itemKey(item)) ? 'checked' : 'unchecked';
    }
    if (this._checkedContainers.has(itemKey(item))) return 'checked';
    const derived = this._deriveOpenState(item, colIdx);
    if (derived) return derived;
    return this._hasSelectedUnder(item) ? 'indeterminate' : 'unchecked';
  }

  // When a container's child column is open we can reflect an exact state from
  // what's loaded, without crawling — the "show what we can, fast" path.
  _deriveOpenState(item, colIdx) {
    const parentCol = this._columns[colIdx];
    if (!parentCol || parentCol.selectedPath !== item.path) return null;
    const child = this._columns[colIdx + 1];
    if (!child) return null;
    const selectable = child.items.filter((it) => it.isFolder || isActionableItem(it));
    if (!selectable.length) return null;
    let checked = 0;
    let unchecked = 0;
    selectable.forEach((it) => {
      let st;
      if (it.isFolder) st = this.checkboxState(it, colIdx + 1);
      else st = this._selectedPages.has(itemKey(it)) ? 'checked' : 'unchecked';
      if (st === 'checked') checked += 1;
      else if (st === 'unchecked') unchecked += 1;
    });
    if (checked === selectable.length) return 'checked';
    if (unchecked === selectable.length) return 'unchecked';
    return 'indeterminate';
  }

  _isUnder(key, item) {
    const { site, path } = parseKey(key);
    if (site !== item.site) return false;
    if (item.isSite) return path !== item.site;
    return path.startsWith(`${item.path}/`);
  }

  _hasSelectedUnder(item) {
    return Array.from(this._selectedPages.keys()).some((key) => this._isUnder(key, item));
  }

  // Site row + parent folder keys for a given path (excludes the path itself).
  _ancestorContainerKeys(site, path) {
    const segs = path.split('/').filter(Boolean);
    const keys = [`${site}:${site}`];
    for (let i = 1; i < segs.length; i += 1) {
      keys.push(`${site}:/${segs.slice(0, i).join('/')}`);
    }
    return keys;
  }

  // MSM actions are defined relative to one site's position in the inheritance
  // tree, so a selection must stay within a single site. Selecting on a new
  // site clears whatever was selected on the previous one.
  _clearIfOtherSite(site) {
    const isOther = (k) => parseKey(k).site !== site;
    const hasOther = [...this._selectedPages.keys()].some(isOther)
      || [...this._checkedContainers].some(isOther);
    if (!hasOther) return;
    this._crawlGen.forEach((v, k) => this._crawlGen.set(k, v + 1));
    this._selectedPages = new Map();
    this._checkedContainers = new Set();
  }

  _togglePage(item) {
    const key = itemKey(item);
    if (!this._selectedPages.has(key)) this._clearIfOtherSite(item.site);
    const pages = new Map(this._selectedPages);
    if (pages.has(key)) {
      pages.delete(key);
      const drop = new Set(this._ancestorContainerKeys(item.site, item.path));
      const containers = new Set();
      this._checkedContainers.forEach((k) => { if (!drop.has(k)) containers.add(k); });
      this._checkedContainers = containers;
    } else {
      pages.set(key, item);
    }
    this._selectedPages = pages;
    this.emitSelection(item.site);
  }

  toggleCheck(item, colIdx) {
    if (item.isSite || item.isFolder) {
      if (this.checkboxState(item, colIdx) === 'checked') this._unselectSubtree(item);
      else this._selectSubtree(item);
      this.emitSelection(item.site);
    } else {
      this._togglePage(item);
    }
  }

  _selectSubtree(item) {
    this._clearIfOtherSite(item.site);
    const rootKey = itemKey(item);
    this._checkedContainers = new Set(this._checkedContainers).add(rootKey);
    const gen = (this._crawlGen.get(rootKey) || 0) + 1;
    this._crawlGen.set(rootKey, gen);
    this._crawlInto(item.site, item.isSite ? '/' : item.path, rootKey, gen);
  }

  _unselectSubtree(item) {
    const rootKey = itemKey(item);
    // Cancel any crawl still adding pages under this container.
    this._crawlGen.set(rootKey, (this._crawlGen.get(rootKey) || 0) + 1);

    const pages = new Map();
    this._selectedPages.forEach((v, k) => { if (!this._isUnder(k, item)) pages.set(k, v); });
    this._selectedPages = pages;

    const drop = new Set([rootKey, ...this._ancestorContainerKeys(item.site, item.path)]);
    const containers = new Set();
    this._checkedContainers.forEach((k) => {
      if (drop.has(k)) return;
      if (this._isUnder(k, item)) return;
      containers.add(k);
    });
    this._checkedContainers = containers;
  }

  // Background recursive crawl: lists each folder, marks it checked, and adds
  // its actionable pages to the selection — emitting as it goes so the UI fills
  // in. A generation mismatch (the user unchecked the root) aborts the walk.
  async _crawlInto(site, path, rootKey, gen) {
    if (this._crawlGen.get(rootKey) !== gen) return;
    let items;
    try {
      items = await this._loadFolderItems(site, path);
    } catch {
      return;
    }
    if (this._crawlGen.get(rootKey) !== gen) return;

    const pages = new Map(this._selectedPages);
    const containers = new Set(this._checkedContainers);
    const folders = [];
    items.forEach((it) => {
      const isite = it.site || site;
      if (it.isFolder) {
        folders.push({ ...it, site: isite });
        containers.add(`${isite}:${it.path}`);
      } else if (isActionableItem(it)) {
        pages.set(`${isite}:${it.path}`, { ...it, site: isite });
      }
    });
    this._selectedPages = pages;
    this._checkedContainers = containers;
    this.emitSelection(site);

    /* eslint-disable no-await-in-loop, no-restricted-syntax */
    for (const folder of folders) {
      if (this._crawlGen.get(rootKey) !== gen) return;
      await this._crawlInto(folder.site, folder.path, rootKey, gen);
    }
    /* eslint-enable no-await-in-loop, no-restricted-syntax */
  }

  emitSelection(site) {
    const selectedItems = [...this._selectedPages.values()];
    const lastCol = this._columns[this._columns.length - 1];
    const currentPath = lastCol?.header || '';
    this.dispatchEvent(new CustomEvent('browse-selection', {
      detail: { selectedItems, currentPath, site: site || this.getCurrentSite() },
      bubbles: true,
      composed: true,
    }));
  }

  handleCheckChange(item, e, colIdx) {
    e.stopPropagation();
    this.toggleCheck(item, colIdx);
  }

  // ── Lazy per-row status (icon2) ───────────────────────────────────────────

  _loadRowStatuses(items) {
    const next = new Map(this._rowStatus);
    const toFetch = [];
    items.forEach((item) => {
      if (!isActionableItem(item)) return;
      // The status icon answers "do you need an MSM action relative to your
      // source", so it only applies where inheritance does. Base-only sites
      // have no source — skip the fetch entirely.
      if (!this._siteHasInheritance(item.site)) return;
      const key = itemKey(item);
      if (next.has(key)) return;
      next.set(key, 'loading');
      toFetch.push(item);
    });
    if (!toFetch.length) return;
    this._rowStatus = next;

    toFetch.forEach((item) => {
      const ext = item.ext || 'html';
      const pagePath = item.path.replace(/\.[^/.]+$/, '');
      getPageStatus(this.org, item.site, pagePath, item.lastModified, ext)
        .then((status) => this._setRowStatus(itemKey(item), status))
        .catch(() => this._setRowStatus(itemKey(item), { previewState: 'not-rolled-out', liveState: 'not-rolled-out' }));
    });
  }

  _setRowStatus(key, status) {
    const m = new Map(this._rowStatus);
    m.set(key, status);
    this._rowStatus = m;
  }

  // ── Keyboard navigation ─────────────────────────────────────────────────

  _setFocus(columnIdx, item) {
    this._focusedItem = item
      ? { columnIdx, path: item.path, site: item.site || '' }
      : null;
  }

  _getActiveFocusedIdx() {
    const f = this._focusedItem;
    if (!f || f.columnIdx !== this._activeColumnIdx) return -1;
    const col = this._columns[this._activeColumnIdx];
    if (!col) return -1;
    return col.items.findIndex((it) => it.path === f.path && (it.site || '') === f.site);
  }

  _clearFocusIfMatches(item) {
    const f = this._focusedItem;
    if (f && f.path === item.path && f.site === (item.site || '')) this._focusedItem = null;
  }

  _onKeydown(e) {
    const col = this._columns[this._activeColumnIdx];
    if (!col || !col.items.length) return;
    const { items } = col;
    const curIdx = this._getActiveFocusedIdx();

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        this._setFocus(this._activeColumnIdx, items[Math.min(curIdx + 1, items.length - 1)]);
        this.scrollFocusedIntoView();
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        this._setFocus(this._activeColumnIdx, items[Math.max(curIdx - 1, 0)]);
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
            if (newCol?.items.length) {
              this._setFocus(fromColumn + 1, newCol.items[0]);
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
          this._setFocus(this._activeColumnIdx, prevCol?.items[0] || null);
        }
        break;
      }
      case ' ': {
        e.preventDefault();
        const item = items[curIdx];
        if (item && this.showCheckbox(item)) this.toggleCheck(item, this._activeColumnIdx);
        break;
      }
      default:
        break;
    }
  }

  // ── Scrolling helpers ─────────────────────────────────────────────────────

  _findItemElement(colIdx, path, site = '') {
    const lists = this.shadowRoot.querySelectorAll('.column .column-items');
    const list = lists[colIdx];
    if (!list) return null;
    return Array.from(list.querySelectorAll('.item')).find((el) => (
      el.dataset.path === path && (el.dataset.site || '') === (site || '')
    )) || null;
  }

  scrollItemIntoView(colIdx, path, site = '', { block = 'nearest', behavior = 'auto' } = {}) {
    return this.updateComplete.then(() => new Promise((resolve) => {
      requestAnimationFrame(() => {
        const target = this._findItemElement(colIdx, path, site);
        if (target) target.scrollIntoView({ block, behavior, inline: 'nearest' });
        resolve();
      });
    }));
  }

  scrollFocusedIntoView() {
    const f = this._focusedItem;
    if (!f) return this.updateComplete;
    return this.scrollItemIntoView(f.columnIdx, f.path, f.site);
  }

  scrollSelectionIntoView({ block = 'center', behavior = 'smooth' } = {}) {
    if (this._focusedItem) {
      const { columnIdx, path, site } = this._focusedItem;
      return this.scrollItemIntoView(columnIdx, path, site, { block, behavior });
    }
    for (let c = this._columns.length - 1; c >= 0; c -= 1) {
      const checked = this._columns[c].items.find((item) => this.isItemChecked(item));
      if (checked) {
        return this.scrollItemIntoView(c, checked.path, checked.site || '', { block, behavior });
      }
    }
    return this.updateComplete;
  }

  scrollToActiveColumn() {
    return this.updateComplete.then(() => new Promise((resolve) => {
      requestAnimationFrame(() => {
        if (window.innerWidth > 600) {
          const browser = this.shadowRoot.querySelector('.browser');
          if (browser) browser.scrollTo({ left: browser.scrollWidth, behavior: 'smooth' });
        }
        resolve();
      });
    }));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  // Small corner badge overlaid on the type icon. Inheritance state only
  // applies to satellite listings (which carry an `inheritedFrom` field) and
  // never to the sites column.
  renderInheritanceBadge(item) {
    if (item.isSite || !('inheritedFrom' in item)) return nothing;
    const inherited = !!item.inheritedFrom;
    const tip = inherited ? `Inheriting from ${item.inheritedFrom}` : 'Local copy — inheritance broken';
    return html`<span class="inherit-badge ${inherited ? 'inherited' : 'override'}" title=${tip}>
      ${icon(inherited ? 'S2_Icon_LinkApplied_20_N' : 'S2_Icon_UnLink_20_N')}
    </span>`;
  }

  renderStatusIcon(item) {
    if (!isActionableItem(item)) return nothing;
    if (!this._siteHasInheritance(item.site)) return nothing;
    const status = this._rowStatus.get(itemKey(item));
    if (!status) return nothing;
    if (status === 'loading') return html`<span class="row-icon row-icon-loading"></span>`;
    const hasOverride = !item.inheritedFrom;
    const outOfSync = !!(item.hasLocalOverride && item.baseLastModified && item.lastModified
      && new Date(item.baseLastModified).getTime()
        > new Date(item.lastModified).getTime() + PUBLISH_LAG_MS);
    const cfg = getStatusConfig({
      hasOverride, outOfSync, previewState: status.previewState, liveState: status.liveState,
    });
    return html`<span class="row-icon" style="color:${cfg.color}" title=${cfg.tip}>
      ${icon(cfg.name)}
    </span>`;
  }

  renderItem(colIdx, item) {
    const isSelected = this._columns[colIdx]?.selectedPath === item.path;
    const isPathAncestor = isSelected && (item.isFolder || item.isSite)
      && colIdx < this._columns.length - 1;
    const f = this._focusedItem;
    const isFocused = !!f && f.columnIdx === colIdx
      && f.path === item.path && f.site === (item.site || '');
    const state = this.checkboxState(item, colIdx);
    const isContainer = item.isFolder || item.isSite;

    let typeIcon = PAGE_ICON;
    if (item.isSite) typeIcon = GLOBE_ICON;
    else if (item.isFolder) typeIcon = FOLDER_ICON;

    return html`
      <div
        class="item ${isSelected ? 'selected' : ''} ${isPathAncestor ? 'path-ancestor' : ''} ${isFocused ? 'focused' : ''}"
        data-path=${item.path}
        data-site=${item.site || ''}
        @click=${(e) => this.handleItemClick(colIdx, item, e)}
        role="option"
        aria-selected=${isSelected}
      >
        ${this.showCheckbox(item) ? html`
          <input
            type="checkbox"
            .checked=${state === 'checked'}
            .indeterminate=${state === 'indeterminate'}
            @change=${(e) => this.handleCheckChange(item, e, colIdx)}
            @click=${(e) => e.stopPropagation()}
          />
        ` : nothing}
        <span class="item-icon">
          ${typeIcon}
          ${this.renderInheritanceBadge(item)}
        </span>
        <span class="item-label">${item.name}</span>
        <span class="item-trailing">
          ${isContainer
    ? html`<span class="item-arrow">${ARROW_RIGHT}</span>`
    : this.renderStatusIcon(item)}
        </span>
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
            <button class="back-btn" @click=${() => this.goBack()}>${BACK_ARROW} Back</button>
          ` : nothing}
          ${col.header}
        </div>
        <div class="column-items" role="listbox" aria-label=${col.header}>
          ${isLoading ? html`
            <div class="column-loading"><div class="mini-spinner"></div> Loading…</div>
          ` : nothing}
          ${!isLoading && col.items.length === 0 ? html`
            <div class="column-empty">Empty folder</div>
          ` : nothing}
          ${!isLoading ? col.items.map((item) => this.renderItem(colIdx, item)) : nothing}
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
            <div class="column-header">Loading…</div>
            <div class="column-items">
              <div class="column-loading"><div class="mini-spinner"></div> Loading…</div>
            </div>
          </div>
        ` : nothing}
      </div>
    `;
  }
}

customElements.define('msm-column-browser', MsmColumnBrowser);
