import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mergeFromSource, setMergeCopy } from '../../../../../tools/apps/msm/core/operations.js';

describe('mergeFromSource', () => {
  beforeEach(() => setMergeCopy(undefined));

  it('passes operation data to the SDK loc action', async () => {
    let received;
    setMergeCopy(async (options) => {
      received = options;
      return { ok: true, status: 200 };
    });
    const result = await mergeFromSource('org', 'source', 'target', '/en/page');
    assert.deepEqual(received, {
      urlSource: '/org/source/en/page.html',
      urlTarget: '/org/target/en/page.html',
      msg: 'MSM Merge',
    });
    assert.equal(result.ok, true);
    assert.equal(result.editUrl, 'https://da.live/edit#/org/target/en/page');
  });

  it('reports missing SDK initialization', async () => {
    const result = await mergeFromSource('org', 'source', 'target', '/page');
    assert.equal(result.error, 'MSM requires SDK localization initialization');
  });

  it('returns the merge error', async () => {
    setMergeCopy(async () => ({ ok: false, status: 401, error: 'Source read failed (401)' }));
    const result = await mergeFromSource('org', 'source', 'target', '/page');
    assert.deepEqual(result, { error: 'Source read failed (401)' });
  });
});
