import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildParentMap,
  ancestorChain,
  effectiveSource,
  isOutOfSync,
} from '../../../../../tools/apps/msm/core/source-tree.js';

// Linked-site tree centered on root `global`:
//   global ─ eu ─ france
//          └ apac ─ india
const tree = [
  { siteId: 'eu', children: [{ siteId: 'france', children: [] }] },
  { siteId: 'apac', children: [{ siteId: 'india', children: [] }] },
];
const ROOT = 'global';
const keyOf = (n) => n.siteId;

describe('buildParentMap', () => {
  it('maps each child to its parent and top-level nodes to the root', () => {
    const pm = buildParentMap(tree, ROOT, keyOf);
    assert.equal(pm.get('eu'), ROOT);
    assert.equal(pm.get('apac'), ROOT);
    assert.equal(pm.get('france'), 'eu');
    assert.equal(pm.get('india'), 'apac');
  });

  it('honours the keyOf accessor (app keys nodes on `site`)', () => {
    const appTree = [{ site: 'eu', children: [{ site: 'france', children: [] }] }];
    const pm = buildParentMap(appTree, ROOT, (n) => n.site);
    assert.equal(pm.get('france'), 'eu');
    assert.equal(pm.get('eu'), ROOT);
  });
});

describe('ancestorChain', () => {
  const pm = buildParentMap(tree, ROOT, keyOf);

  it('returns ancestors nearest-first, excluding the root sentinel', () => {
    assert.deepEqual(ancestorChain('france', pm, ROOT), ['eu']);
    assert.deepEqual(ancestorChain('eu', pm, ROOT), []);
  });
});

describe('effectiveSource', () => {
  const pm = buildParentMap(tree, ROOT, keyOf);
  const rootLm = '2024-01-01';

  it('resolves to the root when no ancestor is detached', () => {
    const src = effectiveSource('france', pm, () => undefined, ROOT, rootLm);
    assert.deepEqual(src, { site: ROOT, lm: rootLm });
  });

  it('resolves a direct child of the root to the root', () => {
    const src = effectiveSource('eu', pm, () => undefined, ROOT, rootLm);
    assert.deepEqual(src, { site: ROOT, lm: rootLm });
  });

  // The bug ravuthu flagged: france must pull from eu, not the root, when eu
  // holds a detached copy — even though france is two levels below global.
  it('resolves to the nearest detached ancestor', () => {
    const lookup = (s) => (s === 'eu' ? { isDetached: true, lastModified: '2024-05-05' } : undefined);
    const src = effectiveSource('france', pm, lookup, ROOT, rootLm);
    assert.deepEqual(src, { site: 'eu', lm: '2024-05-05' });
  });

  it('prefers the nearest detached ancestor over a farther one', () => {
    const deep = [{ siteId: 'eu', children: [{ siteId: 'france', children: [{ siteId: 'paris', children: [] }] }] }];
    const pmDeep = buildParentMap(deep, ROOT, keyOf);
    const lookup = (s) => {
      if (s === 'eu') return { isDetached: true, lastModified: '2024-02-02' };
      if (s === 'france') return { isDetached: true, lastModified: '2024-06-06' };
      return undefined;
    };
    const src = effectiveSource('paris', pmDeep, lookup, ROOT, rootLm);
    assert.deepEqual(src, { site: 'france', lm: '2024-06-06' });
  });

  it('normalises a missing lastModified to null', () => {
    const lookup = (s) => (s === 'eu' ? { isDetached: true } : undefined);
    const src = effectiveSource('france', pm, lookup, ROOT, rootLm);
    assert.deepEqual(src, { site: 'eu', lm: null });
  });
});

describe('isOutOfSync', () => {
  it('is true when the source changed after the copy, beyond the lag window', () => {
    assert.equal(isOutOfSync('2024-01-01T00:00:10Z', '2024-01-01T00:00:00Z', 5000), true);
  });

  it('is false when the source is older than the copy', () => {
    assert.equal(isOutOfSync('2024-01-01', '2024-02-01', 5000), false);
  });

  it('is false within the publish-lag grace window', () => {
    assert.equal(isOutOfSync('2024-01-01T00:00:03Z', '2024-01-01T00:00:00Z', 5000), false);
  });

  it('is false when either timestamp is missing', () => {
    assert.equal(isOutOfSync(null, '2024-01-01', 5000), false);
    assert.equal(isOutOfSync('2024-01-01', null, 5000), false);
  });
});
