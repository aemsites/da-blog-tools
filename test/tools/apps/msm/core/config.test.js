import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getInheritanceChain,
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

describe('getInheritanceChain', () => {
  it('walks root → parent for a leaf', () => {
    const chain = getInheritanceChain(config, 'india');
    assert.deepEqual(chain.map((c) => c.site), ['global', 'apac']);
  });

  it('labels the root from its base-label row', () => {
    const chain = getInheritanceChain(config, 'india');
    assert.equal(chain[0].label, 'Global');
  });

  it('falls back to the id for intermediate sites with no base-label row', () => {
    // `apac` is only ever a satellite or a base-with-satellite, never a
    // standalone base-label row, so its chain label is the id.
    const chain = getInheritanceChain(config, 'india');
    assert.equal(chain[1].label, 'apac');
  });

  it('returns an empty chain for a root site', () => {
    assert.deepEqual(getInheritanceChain(config, 'global'), []);
  });
});

describe('getSiteRoles', () => {
  it('marks a root as base-only with its direct satellites', () => {
    const roles = getSiteRoles(config, 'global');
    assert.ok(roles.asBase);
    assert.equal(roles.asSatellite, undefined);
    assert.deepEqual(Object.keys(roles.asBase.satellites), ['apac', 'eu', 'na']);
    assert.equal(roles.asBase.satellites.apac.descendantCount, 2);
  });

  it('marks a mid-tier site as both base and satellite', () => {
    const roles = getSiteRoles(config, 'apac');
    assert.deepEqual(Object.keys(roles.asBase.satellites), ['india', 'japan']);
    assert.equal(roles.asSatellite.base, 'global');
  });

  it('marks a leaf as satellite-only', () => {
    const roles = getSiteRoles(config, 'india');
    assert.equal(roles.asBase, undefined);
    assert.equal(roles.asSatellite.base, 'apac');
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
