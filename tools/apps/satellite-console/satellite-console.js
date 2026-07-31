// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
// eslint-disable-next-line import/no-unresolved
import { daFetch } from 'https://da.live/nx/utils/daFetch.js';

const CONTENT_ORIGIN = 'https://content.da.live';
const $ = (sel) => document.querySelector(sel);

function col(row, key) {
  return row[key] || row[key.charAt(0).toUpperCase() + key.slice(1)] || '';
}

function siteSlug(raw) {
  return (raw || '').split('/').filter(Boolean).at(-1) || '';
}

async function loadRows(org) {
  const resp = await daFetch(`${CONTENT_ORIGIN}/${org}/.da/satellites.json`);
  if (!resp.ok) throw new Error(`Satellite config not found at /${org}/.da/satellites.json (${resp.status})`);
  const json = await resp.json();
  return json.data ?? json;
}

function resolveConfig(rows, site) {
  const parsed = rows.map((r) => ({
    base: siteSlug(col(r, 'base') || col(r, 'primary')),
    satellite: siteSlug(col(r, 'satellite')),
    title: col(r, 'title'),
  }));

  const baseRows = parsed.filter((r) => r.base === site);
  if (baseRows.length) {
    return {
      role: 'base',
      title: baseRows.find((r) => !r.satellite)?.title || site,
      satellites: baseRows
        .filter((r) => r.satellite)
        .map((r) => ({ name: r.title || r.satellite, site: r.satellite })),
    };
  }

  const satRow = parsed.find((r) => r.satellite === site);
  if (satRow) {
    const sourceTitle = parsed.find((r) => r.base === satRow.base && !r.satellite)?.title || satRow.base;
    return {
      role: 'satellite',
      title: satRow.title || site,
      source: { name: sourceTitle, site: satRow.base },
    };
  }

  return null;
}

async function init() {
  try {
    const { context, token, actions } = await DA_SDK;
    const { org, repo: site } = context;
    const config = resolveConfig(await loadRows(org), site);

    if (!config) {
      throw new Error(`Site "${site}" is not listed as a base or satellite in the satellite config`);
    }

    $('#app').innerHTML = `
      <header class="mc-header">
        <h1>Satellite Console</h1>
        <span class="mc-role-badge mc-role-${config.role}">${config.role === 'base' ? 'Base' : 'Satellite'}</span>
        <span class="mc-org-badge">${config.title}</span>
      </header>
      <div id="main-content"></div>`;

    const container = $('#main-content');
    if (config.role === 'base') {
      const { initBase } = await import('./views/base.js');
      initBase({ org, site, token, config, container });
    } else {
      const { initSatellite } = await import('./views/satellite.js');
      initSatellite({ org, site, token, actions, config, container });
    }
  } catch (err) {
    $('#app').innerHTML = `
      <div class="mc-error-banner">
        ${err.message}.<br>
        Ensure <code>satellites.json</code> exists in your org's <code>.da</code> folder.
      </div>`;
  }
  document.body.style.display = '';
}

init();
