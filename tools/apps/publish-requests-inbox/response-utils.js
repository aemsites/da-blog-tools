/*
 * Pure, dependency-free helpers for interpreting DA read responses.
 *
 * These exist so the read-outcome logic (the source of the "empty inbox with no
 * error" bug) can be unit-tested without importing the network-glued api.js,
 * which pulls in https:// modules that node --test cannot resolve.
 */

const SEEDED_EMPTY_SHEET = {
  data: [], total: 0, offset: 0, limit: 0,
};

/**
 * Interpret a DA source read of the requests sheet.
 * - 404 → the sheet has not been created yet: a seeded empty sheet (not an error).
 * - any other non-ok → a transient failure (expired token, 5xx, rate limit):
 *   throw, so the caller surfaces an error instead of a false-empty inbox.
 * - ok → the parsed sheet JSON.
 * @param {Response} resp - The fetch Response for the requests sheet read
 * @returns {Promise<Object>} The parsed sheet, or a seeded empty sheet on 404
 */
export async function readSheetResponse(resp) {
  if (resp.status === 404) return { ...SEEDED_EMPTY_SHEET };
  if (!resp.ok) {
    throw new Error(`Couldn't load publish requests (${resp.status}). Please reload and try again.`);
  }
  return resp.json();
}

/**
 * Guard a config-endpoint response. A 404 is a legitimate "no config here"
 * (the caller falls back to a broader scope); any other non-ok is a transient
 * failure and throws so it is never silently treated as "no config".
 * @param {Response} resp - The fetch Response for a config read
 * @param {string} label - Human-readable label for the error message
 * @returns {boolean} true when ok, false when a genuine 404 (absent)
 */
export function assertConfigResponse(resp, label = 'workflow configuration') {
  if (resp.ok) return true;
  if (resp.status === 404) return false;
  throw new Error(`Couldn't load ${label} (${resp.status}). Please reload and try again.`);
}
