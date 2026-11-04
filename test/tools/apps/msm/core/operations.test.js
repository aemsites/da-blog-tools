import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mergeFromSource, setMergeCopy } from '../../../../../tools/apps/msm/core/operations.js';
import { daFetch, DA_ORIGIN } from '../../../../../tools/apps/msm/core/fetch.js';

describe('mergeFromSource', () => {
  beforeEach(() => setMergeCopy(undefined));

  it('passes transport and operation data to the public loc mergeCopy', async () => {
    let received;
    setMergeCopy(async (options) => {
      received = options;
      return { ok: true, status: 200 };
    });
    const result = await mergeFromSource('org', 'source', 'target', '/en/page');
    assert.deepEqual(received, {
      fetch: daFetch,
      daOrigin: DA_ORIGIN,
      urlSource: '/org/source/en/page.html',
      urlTarget: '/org/target/en/page.html',
      msg: 'MSM Merge',
    });
    assert.equal(result.ok, true);
    assert.equal(result.editUrl, 'https://da.live/edit#/org/target/en/page');
  });

  it('returns the merge error', async () => {
    setMergeCopy(async () => ({ ok: false, status: 401, error: 'Source read failed (401)' }));
    const result = await mergeFromSource('org', 'source', 'target', '/page');
    assert.deepEqual(result, { error: 'Source read failed (401)' });
  });

  it('falls back to status when no error is given', async () => {
    setMergeCopy(async () => ({ ok: false, status: 500 }));
    const result = await mergeFromSource('org', 'source', 'target', '/page');
    assert.deepEqual(result, { error: 'Merge failed (500)' });
  });
});
