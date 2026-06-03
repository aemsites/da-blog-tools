import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSourceChain,
  getSiteRoles,
  getAllMsmSites,
  buildDescendantTree,
} from '../../../../../tools/apps/msm/core/config.js';

// global ─ apac ─ india, japan
//        ├ eu   ─ france, uk
//        └ na   ─ canada, us
const rows = [
  { base: 'global', title: 'Global' },
  { base: 'global', satellite: 'apac', title: 'APAC' },
  { base: 'global', satellite: 'eu', title: 'EU' },
  { base: 'global', satellite: 'na', title: 'NA' },
  { base: 'apac', satellite: 'india', title: 'India' },
  { base: 'apac', satellite: 'japan', title: 'Japan' },
  { base: 'eu', satellite: 'france', title: 'France' },
  { base: 'eu', satellite: 'uk', title: 'UK' },
  { base: 'na', satellite: 'canada', title: 'Canada' },
  { base: 'na', satellite: 'us', title: 'US' },
];
const config = { rows };

describe('getSourceChain', () => {
  it('walks root → parent for a leaf', () => {
    const chain = getSourceChain(config, 'india');
    assert.deepEqual(chain.map((c) => c.site), ['global', 'apac']);
  });

  it('labels the root from its source-label row', () => {
    const chain = getSourceChain(config, 'india');
    assert.equal(chain[0].label, 'Global');
  });

  it('falls back to the id for intermediate sites with no source-label row', () => {
    // `apac` is only ever a linked site or a source-with-linked, never a
    // standalone source-label row, so its chain label is the id.
    const chain = getSourceChain(config, 'india');
    assert.equal(chain[1].label, 'apac');
  });

  it('returns an empty chain for a root site', () => {
    assert.deepEqual(getSourceChain(config, 'global'), []);
  });
});

describe('getSiteRoles', () => {
  it('marks a root as source-only with its direct linked sites', () => {
    const roles = getSiteRoles(config, 'global');
    assert.ok(roles.asSource);
    assert.equal(roles.asLinked, undefined);
    assert.deepEqual(Object.keys(roles.asSource.linked), ['apac', 'eu', 'na']);
    assert.equal(roles.asSource.linked.apac.descendantCount, 2);
  });

  it('marks a mid-tier site as both source and linked', () => {
    const roles = getSiteRoles(config, 'apac');
    assert.deepEqual(Object.keys(roles.asSource.linked), ['india', 'japan']);
    assert.equal(roles.asLinked.source, 'global');
  });

  it('marks a leaf as linked-only', () => {
    const roles = getSiteRoles(config, 'india');
    assert.equal(roles.asSource, undefined);
    assert.equal(roles.asLinked.source, 'apac');
  });
});

describe('getAllMsmSites', () => {
  it('orders breadth-first, grouped under parents, with levels', () => {
    const sites = getAllMsmSites(config);
    assert.deepEqual(
      sites.map((s) => s.site),
      ['global', 'apac', 'eu', 'na', 'india', 'japan', 'france', 'uk', 'canada', 'us'],
    );
    assert.deepEqual(
      sites.map((s) => s.level),
      [0, 1, 1, 1, 2, 2, 2, 2, 2, 2],
    );
  });
});

describe('buildDescendantTree', () => {
  it('nests direct children at each level', () => {
    const tree = buildDescendantTree(rows, 'global');
    assert.deepEqual(tree.map((n) => n.site), ['apac', 'eu', 'na']);
    assert.deepEqual(tree[0].children.map((n) => n.site), ['india', 'japan']);
    assert.deepEqual(tree[0].children[0].children, []);
  });

  it('returns empty for an unknown or leaf site', () => {
    assert.deepEqual(buildDescendantTree(rows, 'india'), []);
    assert.deepEqual(buildDescendantTree([], 'global'), []);
  });
});

describe('config column compatibility', () => {
  // The sheet may use the new `source`/`linked` column names instead of the
  // original `base`/`satellite`; readers accept either.
  const newRows = [
    { source: 'global', title: 'Global' },
    { source: 'global', linked: 'apac', title: 'APAC' },
    { source: 'apac', linked: 'india', title: 'India' },
  ];
  const newConfig = { rows: newRows };

  it('resolves roles from source/linked columns', () => {
    const roles = getSiteRoles(newConfig, 'apac');
    assert.deepEqual(Object.keys(roles.asSource.linked), ['india']);
    assert.equal(roles.asLinked.source, 'global');
  });

  it('walks the source chain from source/linked columns', () => {
    assert.deepEqual(getSourceChain(newConfig, 'india').map((c) => c.site), ['global', 'apac']);
  });
});
