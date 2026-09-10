import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readSheetResponse, assertConfigResponse } from '../../../../tools/apps/publish-requests-inbox/response-utils.js';

function resp({ status, ok = status >= 200 && status < 300, json }) {
  return { status, ok, json: async () => json };
}

describe('readSheetResponse', () => {
  it('returns the parsed sheet on a 200', async () => {
    const sheet = await readSheetResponse(resp({ status: 200, json: { data: [{ path: '/a' }] } }));
    assert.equal(sheet.data[0].path, '/a');
  });

  it('returns a seeded empty sheet on 404 (sheet not created yet)', async () => {
    const sheet = await readSheetResponse(resp({ status: 404 }));
    assert.deepEqual(sheet.data, []);
    assert.equal(sheet.total, 0);
  });

  it('throws on a transient failure (401) instead of returning empty', async () => {
    await assert.rejects(
      () => readSheetResponse(resp({ status: 401 })),
      /401/,
    );
  });

  it('throws on a 500 instead of returning empty', async () => {
    await assert.rejects(
      () => readSheetResponse(resp({ status: 500 })),
      /Couldn't load publish requests/,
    );
  });
});

describe('assertConfigResponse', () => {
  it('returns true when the response is ok', () => {
    assert.equal(assertConfigResponse(resp({ status: 200 })), true);
  });

  it('returns false on a 404 (absent, fall back to broader scope)', () => {
    assert.equal(assertConfigResponse(resp({ status: 404 })), false);
  });

  it('throws on a transient failure (503)', () => {
    assert.throws(() => assertConfigResponse(resp({ status: 503 })), /503/);
  });
});
