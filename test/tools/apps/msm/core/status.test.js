import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getStatusConfig } from '../../../../../tools/apps/msm/core/status.js';

describe('getStatusConfig — linked (no copy)', () => {
  it('is green when live is current', () => {
    assert.equal(getStatusConfig({ isDetached: false, liveState: 'current' }).tip, 'Live and current');
  });

  it('is amber when only previewed', () => {
    const cfg = getStatusConfig({ isDetached: false, liveState: 'behind', previewState: 'current' });
    assert.equal(cfg.tip, 'Previewed — not yet published to live');
    assert.equal(cfg.name, 'S2_Icon_AlertTriangle_20_N');
  });

  it('is red when nothing is published', () => {
    const cfg = getStatusConfig({ isDetached: false, liveState: 'not-published', previewState: 'not-published' });
    assert.equal(cfg.tip, 'Not published');
    assert.equal(cfg.name, 'S2_Icon_AlertDiamond_20_N');
  });

  it('is red when the source changed and a publish is needed', () => {
    const cfg = getStatusConfig({ isDetached: false, liveState: 'behind', previewState: 'behind' });
    assert.equal(cfg.tip, 'Source changed — publish needed');
  });
});

describe('getStatusConfig — detached, behind source', () => {
  it('is orange when live is still current', () => {
    const cfg = getStatusConfig({ isDetached: true, outOfSync: true, liveState: 'current' });
    assert.equal(cfg.tip, 'Behind source — changed since last sync');
  });

  it('is red when not current', () => {
    const cfg = getStatusConfig({ isDetached: true, outOfSync: true, liveState: 'behind' });
    assert.equal(cfg.tip, 'Behind source — needs sync and publish');
  });
});

describe('getStatusConfig — detached, in sync', () => {
  it('is green when live is current', () => {
    assert.equal(getStatusConfig({ isDetached: true, outOfSync: false, liveState: 'current' }).tip, 'Live and current');
  });

  it('is amber when only previewed', () => {
    const cfg = getStatusConfig({
      isDetached: true, outOfSync: false, liveState: 'behind', previewState: 'current',
    });
    assert.equal(cfg.tip, 'Previewed — not yet published to live');
  });

  it('is red when neither previewed nor published', () => {
    const cfg = getStatusConfig({
      isDetached: true, outOfSync: false, liveState: 'behind', previewState: 'behind',
    });
    assert.equal(cfg.tip, 'Not yet previewed or published');
  });
});
