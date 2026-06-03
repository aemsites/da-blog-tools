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
} from '../../../../../tools/apps/msm/helpers/action-panel.model.js';

// Satellite subtree centered on root `global`:
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
});

describe('effectiveSource', () => {
  const page = { path: '/p', lastModified: '2024-01-01T00:00:00Z' };
  const pm = parentMap(tree, ROOT);

  it('resolves to the root when no ancestor has a local copy', () => {
    const src = effectiveSource(page, 'india', pm, new Map(), ROOT);
    assert.deepEqual(src, { site: 'global', lm: '2024-01-01T00:00:00Z' });
  });

  it('resolves to the nearest ancestor holding a local copy', () => {
    const cells = new Map([[cellKey('/p', 'apac'), { hasOverride: true, lastModified: '2024-05-05' }]]);
    const src = effectiveSource(page, 'india', pm, cells, ROOT);
    assert.deepEqual(src, { site: 'apac', lm: '2024-05-05' });
  });

  it('skips ancestors without a local copy', () => {
    const src = effectiveSource(page, 'france', pm, new Map(), ROOT);
    assert.equal(src.site, 'global');
  });
});

describe('deriveCategory', () => {
  it('is inherited with no local copy', () => {
    assert.equal(deriveCategory({ hasOverride: false }), 'inherited');
  });
  it('is override with a local copy and an existing source', () => {
    assert.equal(deriveCategory({ hasOverride: true, sourceExists: true }), 'override');
  });
  it('is local with a copy but no source above', () => {
    assert.equal(deriveCategory({ hasOverride: true, sourceExists: false }), 'local');
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
    [cellKey('/p', 'apac'), { hasOverride: true }],
    [cellKey('/p', 'india'), { hasOverride: false }],
    [cellKey('/p', 'japan'), { hasOverride: false }],
    [cellKey('/p', 'france'), { hasOverride: false }],
    // no eu cell — should be skipped
  ]);

  it('selects inherited cells (no local copy)', () => {
    const cellsOut = scopedCells(allColumns, pages, included, cells, 'inherited');
    assert.deepEqual(cellsOut.map((c) => c.satSite).sort(), ['france', 'india', 'japan']);
  });

  it('selects custom cells (local copy)', () => {
    const cellsOut = scopedCells(allColumns, pages, included, cells, 'custom');
    assert.deepEqual(cellsOut.map((c) => c.satSite), ['apac']);
  });

  it('ignores excluded targets', () => {
    const cellsOut = scopedCells(allColumns, pages, new Set(['india']), cells, 'inherited');
    assert.deepEqual(cellsOut.map((c) => c.satSite), ['india']);
  });
});

describe('scopedPagesUp', () => {
  const pages = [{ path: '/a' }, { path: '/b' }, { path: '/c' }];
  const rows = new Map([
    ['/a', { category: 'inherited' }],
    ['/b', { category: 'override' }],
    ['/c', { category: 'local' }],
  ]);
  it('filters pages by inheritance category', () => {
    assert.deepEqual(scopedPagesUp(pages, rows, 'inherited').map((p) => p.path), ['/a']);
    assert.deepEqual(scopedPagesUp(pages, rows, 'override').map((p) => p.path), ['/b']);
  });
});

describe('downGroups', () => {
  it('groups in-scope cells by (target, resolved source)', () => {
    const pages = [{ path: '/p' }];
    const included = new Set(['apac', 'india', 'japan', 'eu', 'france']);
    const cells = new Map([
      [cellKey('/p', 'apac'), { hasOverride: true, lastModified: '2024-05-05' }],
      [cellKey('/p', 'india'), { hasOverride: false }],
      [cellKey('/p', 'japan'), { hasOverride: false }],
      [cellKey('/p', 'france'), { hasOverride: false }],
    ]);
    const groups = downGroups({
      tree, pages, allColumns: flattenAll(tree, ROOT), included, cells, rootSite: ROOT, scope: 'inherited',
    });
    const byTarget = Object.fromEntries(groups.map((g) => [g.target, g]));
    // india/japan inherit through apac's local copy; france falls back to the root.
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
      ['/a', { category: 'inherited', source: 'global' }],
      ['/b', { category: 'inherited', source: 'na' }],
      ['/c', { category: 'inherited' }], // no source — falls back to base
    ]);
    const groups = upGroups({
      pages, rows, scope: 'inherited', base: 'global', target: 'apac',
    });
    const bySource = Object.fromEntries(groups.map((g) => [g.source, g]));
    assert.deepEqual(Object.keys(bySource).sort(), ['global', 'na']);
    assert.equal(bySource.global.pages.length, 2); // /a + /c (fallback)
    assert.equal(bySource.na.pages.length, 1);
    groups.forEach((g) => assert.equal(g.target, 'apac'));
  });
});
