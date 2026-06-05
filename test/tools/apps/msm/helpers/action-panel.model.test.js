import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cellKey,
  findNode,
  subtreeSites,
  parentMap,
  flattenAll,
  flattenVisible,
  columnState,
  toggleTarget,
  effectiveSource,
  deriveCategory,
  isOutOfSync,
  scopedCells,
  scopedPagesUp,
  downGroups,
  upGroups,
  ancestorsToExpand,
  matrixComplete,
  sourceComplete,
  planSelectionLoad,
} from '../../../../../tools/apps/msm/helpers/action-panel.model.js';

// Linked-site subtree centered on root `global`:
//   apac ─ india, japan
//   eu   ─ france
const tree = [
  {
    site: 'apac',
    label: 'APAC',
    children: [
      { site: 'india', label: 'India', children: [] },
      { site: 'japan', label: 'Japan', children: [] },
    ],
  },
  {
    site: 'eu',
    label: 'EU',
    children: [{ site: 'france', label: 'France', children: [] }],
  },
];
const ROOT = 'global';
const sorted = (set) => [...set].sort();

describe('findNode', () => {
  it('finds a nested node', () => {
    assert.equal(findNode(tree, 'india').label, 'India');
  });
  it('returns null for an unknown site', () => {
    assert.equal(findNode(tree, 'nope'), null);
  });
});

describe('subtreeSites', () => {
  it('returns a site and all its descendants', () => {
    assert.deepEqual(subtreeSites(tree, 'apac'), ['apac', 'india', 'japan']);
  });
  it('returns just the site for a leaf', () => {
    assert.deepEqual(subtreeSites(tree, 'india'), ['india']);
  });
  it('falls back to [site] when not in the tree', () => {
    assert.deepEqual(subtreeSites(tree, 'missing'), ['missing']);
  });
});

describe('parentMap', () => {
  it('maps each site to its parent, top-level to root', () => {
    const pm = parentMap(tree, ROOT);
    assert.equal(pm.get('apac'), 'global');
    assert.equal(pm.get('eu'), 'global');
    assert.equal(pm.get('india'), 'apac');
    assert.equal(pm.get('japan'), 'apac');
    assert.equal(pm.get('france'), 'eu');
  });
});

describe('flattenAll', () => {
  it('lists every column depth-first with depth and childCount', () => {
    const cols = flattenAll(tree, ROOT);
    assert.deepEqual(cols.map((c) => c.site), ['apac', 'india', 'japan', 'eu', 'france']);
    assert.deepEqual(cols.map((c) => c.depth), [0, 1, 1, 0, 1]);
    assert.equal(cols.find((c) => c.site === 'apac').childCount, 2);
    assert.equal(cols.find((c) => c.site === 'india').childCount, 0);
  });
});

describe('flattenVisible', () => {
  it('hides children of collapsed columns', () => {
    const cols = flattenVisible(tree, ROOT, new Set());
    assert.deepEqual(cols.map((c) => c.site), ['apac', 'eu']);
  });
  it('reveals children of expanded columns', () => {
    const cols = flattenVisible(tree, ROOT, new Set(['apac']));
    assert.deepEqual(cols.map((c) => c.site), ['apac', 'india', 'japan', 'eu']);
  });
});

describe('columnState', () => {
  const all = new Set(['apac', 'india', 'japan', 'eu', 'france']);
  it('is checked when the whole subtree is included', () => {
    assert.equal(columnState(tree, 'apac', all), 'checked');
  });
  it('is indeterminate when only part of the subtree is included', () => {
    assert.equal(columnState(tree, 'apac', new Set(['india'])), 'indeterminate');
  });
  it('is unchecked when none of the subtree is included', () => {
    assert.equal(columnState(tree, 'apac', new Set()), 'unchecked');
  });
});

describe('toggleTarget', () => {
  it('removes the whole subtree when unchecking', () => {
    const all = new Set(['apac', 'india', 'japan', 'eu', 'france']);
    const next = toggleTarget(tree, all, 'apac', ROOT);
    assert.deepEqual(sorted(next), ['eu', 'france']);
  });
  it('adds the subtree and re-enables ancestors when checking', () => {
    const next = toggleTarget(tree, new Set(['eu', 'france']), 'india', ROOT);
    assert.deepEqual(sorted(next), ['apac', 'eu', 'france', 'india']);
  });
  it('checks the whole subtree when toggling an indeterminate parent', () => {
    // apac is indeterminate: india included, japan not. Clicking apac fills it
    // in (checks all) rather than wiping it out.
    const next = toggleTarget(tree, new Set(['apac', 'india', 'eu', 'france']), 'apac', ROOT);
    assert.deepEqual(sorted(next), ['apac', 'eu', 'france', 'india', 'japan']);
  });
});

describe('effectiveSource', () => {
  const page = { path: '/p', lastModified: '2024-01-01T00:00:00Z' };
  const pm = parentMap(tree, ROOT);

  it('resolves to the root when no ancestor has a local copy', () => {
    const src = effectiveSource(page, 'india', pm, new Map(), ROOT);
    assert.deepEqual(src, { site: 'global', lm: '2024-01-01T00:00:00Z' });
  });

  it('resolves to the nearest ancestor holding a detached copy', () => {
    const cells = new Map([[cellKey('/p', 'apac'), { isDetached: true, lastModified: '2024-05-05' }]]);
    const src = effectiveSource(page, 'india', pm, cells, ROOT);
    assert.deepEqual(src, { site: 'apac', lm: '2024-05-05' });
  });

  it('skips ancestors without a detached copy', () => {
    const src = effectiveSource(page, 'france', pm, new Map(), ROOT);
    assert.equal(src.site, 'global');
  });
});

describe('ancestorsToExpand', () => {
  it('returns the ancestors needed to reveal a nested site, excluding it and root', () => {
    assert.deepEqual(sorted(ancestorsToExpand(tree, ROOT, ['india'])), ['apac']);
  });
  it('needs no expansion for a top-level site', () => {
    assert.deepEqual([...ancestorsToExpand(tree, ROOT, ['apac'])], []);
  });
  it('unions ancestors across several affected sites', () => {
    assert.deepEqual(sorted(ancestorsToExpand(tree, ROOT, ['india', 'france'])), ['apac', 'eu']);
  });
  it('is empty for no affected sites', () => {
    assert.deepEqual([...ancestorsToExpand(tree, ROOT, [])], []);
  });
});

describe('deriveCategory', () => {
  it('is linked with no copy', () => {
    assert.equal(deriveCategory({ isDetached: false }), 'linked');
  });
  it('is detached with a copy and an existing source', () => {
    assert.equal(deriveCategory({ isDetached: true, sourceExists: true }), 'detached');
  });
  it('is local with a copy but no source above', () => {
    assert.equal(deriveCategory({ isDetached: true, sourceExists: false }), 'local');
  });
});

describe('isOutOfSync', () => {
  it('is true when the source is newer than the copy beyond the lag', () => {
    assert.equal(isOutOfSync('2024-02-01', '2024-01-01', 5000), true);
  });
  it('is false when the copy is newer than the source', () => {
    assert.equal(isOutOfSync('2024-01-01', '2024-02-01', 5000), false);
  });
  it('is false when either timestamp is missing', () => {
    assert.equal(isOutOfSync(null, '2024-01-01', 5000), false);
  });
  it('absorbs differences within the publish-lag window', () => {
    assert.equal(isOutOfSync('2024-01-01T00:00:03Z', '2024-01-01T00:00:00Z', 5000), false);
    assert.equal(isOutOfSync('2024-01-01T00:00:10Z', '2024-01-01T00:00:00Z', 5000), true);
  });
});

describe('scopedCells', () => {
  const allColumns = flattenAll(tree, ROOT);
  const included = new Set(['apac', 'india', 'japan', 'eu', 'france']);
  const pages = [{ path: '/p' }];
  const cells = new Map([
    [cellKey('/p', 'apac'), { isDetached: true }],
    [cellKey('/p', 'india'), { isDetached: false }],
    [cellKey('/p', 'japan'), { isDetached: false }],
    [cellKey('/p', 'france'), { isDetached: false }],
    // no eu cell — should be skipped
  ]);

  it('selects linked cells (no copy)', () => {
    const cellsOut = scopedCells(allColumns, pages, included, cells, 'linked');
    assert.deepEqual(cellsOut.map((c) => c.targetSite).sort(), ['france', 'india', 'japan']);
  });

  it('selects detached cells (has copy)', () => {
    const cellsOut = scopedCells(allColumns, pages, included, cells, 'detached');
    assert.deepEqual(cellsOut.map((c) => c.targetSite), ['apac']);
  });

  it('ignores excluded targets', () => {
    const cellsOut = scopedCells(allColumns, pages, new Set(['india']), cells, 'linked');
    assert.deepEqual(cellsOut.map((c) => c.targetSite), ['india']);
  });
});

describe('scopedPagesUp', () => {
  const pages = [{ path: '/a' }, { path: '/b' }, { path: '/c' }];
  const rows = new Map([
    ['/a', { category: 'linked' }],
    ['/b', { category: 'detached' }],
    ['/c', { category: 'local' }],
  ]);
  it('filters pages by link category', () => {
    assert.deepEqual(scopedPagesUp(pages, rows, 'linked').map((p) => p.path), ['/a']);
    assert.deepEqual(scopedPagesUp(pages, rows, 'detached').map((p) => p.path), ['/b']);
  });
});

describe('downGroups', () => {
  it('groups in-scope cells by (target, resolved source)', () => {
    const pages = [{ path: '/p' }];
    const included = new Set(['apac', 'india', 'japan', 'eu', 'france']);
    const cells = new Map([
      [cellKey('/p', 'apac'), { isDetached: true, lastModified: '2024-05-05' }],
      [cellKey('/p', 'india'), { isDetached: false }],
      [cellKey('/p', 'japan'), { isDetached: false }],
      [cellKey('/p', 'france'), { isDetached: false }],
    ]);
    const groups = downGroups({
      tree, pages, allColumns: flattenAll(tree, ROOT), included, cells, rootSite: ROOT, scope: 'linked',
    });
    const byTarget = Object.fromEntries(groups.map((g) => [g.target, g]));
    // india/japan link through apac's detached copy; france falls back to the root.
    assert.equal(byTarget.india.source, 'apac');
    assert.equal(byTarget.japan.source, 'apac');
    assert.equal(byTarget.france.source, 'global');
    assert.equal(groups.length, 3);
    groups.forEach((g) => assert.equal(g.pages.length, 1));
  });
});

describe('upGroups', () => {
  it('groups pages by their resolved source, target is the current site', () => {
    const pages = [{ path: '/a' }, { path: '/b' }, { path: '/c' }];
    const rows = new Map([
      ['/a', { category: 'linked', source: 'global' }],
      ['/b', { category: 'linked', source: 'na' }],
      ['/c', { category: 'linked' }], // no source — falls back to root source
    ]);
    const groups = upGroups({
      pages, rows, scope: 'linked', base: 'global', target: 'apac',
    });
    const bySource = Object.fromEntries(groups.map((g) => [g.source, g]));
    assert.deepEqual(Object.keys(bySource).sort(), ['global', 'na']);
    assert.equal(bySource.global.pages.length, 2); // /a + /c (fallback)
    assert.equal(bySource.na.pages.length, 1);
    groups.forEach((g) => assert.equal(g.target, 'apac'));
  });
});

describe('matrixComplete', () => {
  const allColumns = flattenAll(tree, ROOT); // apac, india, japan, eu, france
  const pages = [{ path: '/a' }, { path: '/b' }];
  const full = () => {
    const m = new Map();
    pages.forEach((p) => allColumns.forEach((c) => m.set(cellKey(p.path, c.site), {})));
    return m;
  };

  it('is true when every page has a cell for every column', () => {
    assert.equal(matrixComplete(pages, allColumns, full()), true);
  });
  it('is false when any cell is missing', () => {
    const cells = full();
    cells.delete(cellKey('/b', 'france'));
    assert.equal(matrixComplete(pages, allColumns, cells), false);
  });
  it('is vacuously true with no pages', () => {
    assert.equal(matrixComplete([], allColumns, new Map()), true);
  });
});

describe('sourceComplete', () => {
  const pages = [{ path: '/a' }, { path: '/b' }];
  it('is true when every page has a row', () => {
    assert.equal(sourceComplete(pages, new Map([['/a', {}], ['/b', {}]])), true);
  });
  it('is false when a row is missing', () => {
    assert.equal(sourceComplete(pages, new Map([['/a', {}]])), false);
  });
});

describe('planSelectionLoad', () => {
  const base = {
    prevContextKey: 'org|apac',
    contextKey: 'org|apac',
    loadedDownPaths: new Set(),
    loadedUpPaths: new Set(),
    hasSource: true,
    hasLinked: false,
  };
  const paths = (list) => list.map((p) => p.path);

  it('is a noop when context and selection are unchanged', () => {
    const plan = planSelectionLoad({
      ...base, prevSelKey: '/a', selKey: '/a', pages: [{ path: '/a' }],
    });
    assert.equal(plan.kind, 'noop');
    assert.deepEqual(plan.downPages, []);
    assert.deepEqual(plan.upPages, []);
  });

  it('resets and loads all selected pages when the site changes', () => {
    const plan = planSelectionLoad({
      ...base,
      prevContextKey: 'org|global',
      prevSelKey: '/x',
      selKey: '/a,/b',
      pages: [{ path: '/a' }, { path: '/b' }],
      // even pre-loaded paths reload on a context change
      loadedDownPaths: new Set(['/a']),
    });
    assert.equal(plan.kind, 'reset');
    assert.deepEqual(paths(plan.downPages), ['/a', '/b']);
  });

  it('loads only newly-added pages on a selection change', () => {
    const plan = planSelectionLoad({
      ...base,
      prevSelKey: '/a',
      selKey: '/a,/b',
      pages: [{ path: '/a' }, { path: '/b' }],
      loadedDownPaths: new Set(['/a']),
    });
    assert.equal(plan.kind, 'incremental');
    assert.deepEqual(paths(plan.downPages), ['/b']);
  });

  it('loads nothing when a page is removed (kept data, no refetch)', () => {
    const plan = planSelectionLoad({
      ...base,
      prevSelKey: '/a,/b',
      selKey: '/a',
      pages: [{ path: '/a' }],
      loadedDownPaths: new Set(['/a', '/b']),
    });
    assert.equal(plan.kind, 'incremental');
    assert.deepEqual(plan.downPages, []);
  });

  it('loads nothing when re-adding a previously-loaded page', () => {
    const plan = planSelectionLoad({
      ...base,
      prevSelKey: '/a',
      selKey: '/a,/b',
      pages: [{ path: '/a' }, { path: '/b' }],
      // /b was removed earlier but its data was kept
      loadedDownPaths: new Set(['/a', '/b']),
    });
    assert.equal(plan.kind, 'incremental');
    assert.deepEqual(plan.downPages, []);
  });

  it('filters down and up views independently for a dual site', () => {
    const plan = planSelectionLoad({
      ...base,
      hasLinked: true,
      prevSelKey: '/a',
      selKey: '/a,/b',
      pages: [{ path: '/a' }, { path: '/b' }],
      loadedDownPaths: new Set(['/a']),
      loadedUpPaths: new Set(['/a', '/b']),
    });
    assert.equal(plan.kind, 'incremental');
    assert.deepEqual(paths(plan.downPages), ['/b']); // /b missing downstream
    assert.deepEqual(plan.upPages, []); // both already loaded upstream
  });

  it('skips a view whose role is absent', () => {
    const plan = planSelectionLoad({
      ...base,
      hasSource: false,
      hasLinked: true,
      prevContextKey: 'org|global',
      prevSelKey: '',
      selKey: '/a',
      pages: [{ path: '/a' }],
    });
    assert.equal(plan.kind, 'reset');
    assert.deepEqual(plan.downPages, []); // not a base → no matrix load
    assert.deepEqual(paths(plan.upPages), ['/a']);
  });
});
