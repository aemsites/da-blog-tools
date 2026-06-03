import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getStatusConfig } from '../../../../../tools/apps/msm/core/status.js';

describe('getStatusConfig — no local copy (inherited)', () => {
  it('is green when live is current', () => {
    assert.equal(getStatusConfig({ hasOverride: false, liveState: 'current' }).tip, 'Live and current');
  });

  it('is amber when only previewed', () => {
    const cfg = getStatusConfig({ hasOverride: false, liveState: 'behind', previewState: 'current' });
    assert.equal(cfg.tip, 'Previewed — not yet published to live');
    assert.equal(cfg.name, 'S2_Icon_AlertTriangle_20_N');
  });

  it('is red when nothing is rolled out', () => {
    const cfg = getStatusConfig({ hasOverride: false, liveState: 'not-rolled-out', previewState: 'not-rolled-out' });
    assert.equal(cfg.tip, 'Not rolled out');
    assert.equal(cfg.name, 'S2_Icon_AlertDiamond_20_N');
  });

  it('is red when the base changed and a rollout is needed', () => {
    const cfg = getStatusConfig({ hasOverride: false, liveState: 'behind', previewState: 'behind' });
    assert.equal(cfg.tip, 'Base has changed — rollout needed');
  });
});

describe('getStatusConfig — local copy, out of sync', () => {
  it('is orange when live is still current', () => {
    const cfg = getStatusConfig({ hasOverride: true, outOfSync: true, liveState: 'current' });
    assert.equal(cfg.tip, 'Out of sync — base has changed since last sync');
  });

  it('is red when not current', () => {
    const cfg = getStatusConfig({ hasOverride: true, outOfSync: true, liveState: 'behind' });
    assert.equal(cfg.tip, 'Out of sync — needs sync and publish');
  });
});

describe('getStatusConfig — local copy, in sync', () => {
  it('is green when live is current', () => {
    assert.equal(getStatusConfig({ hasOverride: true, outOfSync: false, liveState: 'current' }).tip, 'Live and current');
  });

  it('is amber when only previewed', () => {
    const cfg = getStatusConfig({
      hasOverride: true, outOfSync: false, liveState: 'behind', previewState: 'current',
    });
    assert.equal(cfg.tip, 'Previewed — not yet published to live');
  });

  it('is red when neither previewed nor published', () => {
    const cfg = getStatusConfig({
      hasOverride: true, outOfSync: false, liveState: 'behind', previewState: 'behind',
    });
    assert.equal(cfg.tip, 'Not yet previewed or published');
  });
});
