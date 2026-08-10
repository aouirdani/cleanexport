#!/usr/bin/env node
/**
 * T0 — HubSpot payload reconnaissance.
 * Zero dependencies. Node 20.6+.
 *
 *   node --env-file=.env probe.mjs
 *   node --env-file=.env probe.mjs --ratelimit
 *
 * Answers the seven questions in README.md. Throwaway tooling — not product code.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS = join(HERE, 'tokens.json');
const BASE = 'https://api.hubapi.com';

// The two path formats in circulation. We test both and report which answers.
const DATE_VERSION = process.env.HUBSPOT_API_VERSION || '2026-03';

let tokens = load();
let apiCalls = 0;

const line = (t = '') => console.log(t);
const rule = (t) => { line(); line(`━━━ ${t} ${'━'.repeat(Math.max(0, 58 - t.length))}`); };

await main();

async function main() {
  line(`\nPortal ${tokens.portalId}  ·  ${tokens.hubDomain || ''}  ·  mode: ${tokens.mode}`);

  if (process.argv.includes('--ratelimit')) {
    if (tokens.mode === 'private') {
      line('\n  ⚠  You are on a PRIVATE APP token. Private apps have different quotas');
      line('     than marketplace-distributed OAuth apps (110 req / 10s per installing');
      line('     account). Whatever number you measure here is NOT the number your');
      line('     product will live with. Re-run this check with OAuth before writing T5.\n');
    }
    await checkRateLimit();
    return;
  }

  const paths = await checkPathFormat();
  await checkProperties(paths);
  const sample = await checkRecords(paths);
  checkNewlines(sample);
  await checkAssociations();
  await checkOwners();

  rule('DONE');
  line(`Total API calls made: ${apiCalls}`);
  line('Re-read the seven exit criteria in README.md before starting T1.');
  line('Run with --ratelimit for check 6 (fires 200 requests deliberately).\n');
}

/* ── 1. Which path format works ─────────────────────────────────────────── */

async function checkPathFormat() {
  rule('1. API PATH FORMAT');

  const candidates = {
    dated: {
      objects: (t) => `/crm/objects/${DATE_VERSION}/${t}`,
      properties: (t) => `/crm/properties/${DATE_VERSION}/${t}`,
    },
    v3: {
      objects: (t) => `/crm/v3/objects/${t}`,
      properties: (t) => `/crm/v3/properties/${t}`,
    },
  };

  const results = {};
  for (const [name, p] of Object.entries(candidates)) {
    const r = await raw(`${p.objects('contacts')}?limit=1`);
    results[name] = r.status;
    line(`  ${name.padEnd(6)} ${p.objects('contacts')}  →  HTTP ${r.status}`);
  }

  const winner = results.dated === 200 ? 'dated' : results.v3 === 200 ? 'v3' : null;

  if (!winner) {
    line('\n  ⚠  Neither format returned 200. Check your scopes and token, then');
    line('     look up the current path in HubSpot developer docs before continuing.');
    process.exit(1);
  }

  line(`\n  → USE "${winner}". Pin HUBSPOT_API_VERSION accordingly.`);
  if (winner === 'v3') {
    line('  → Update 04-HUBSPOT-INTEGRATION.md §4: date-based versioning is not live');
    line('    on your portal yet. Keep the single-constant rule anyway.');
  }
  return candidates[winner];
}

/* ── 2. Properties ──────────────────────────────────────────────────────── */

async function checkProperties(paths) {
  rule('2. PROPERTIES ON contacts');

  const { results } = await get(`${paths.properties('contacts')}`);
  const all = results || [];
  const system = all.filter((p) => p.name.startsWith('hs_'));

  line(`  total properties      ${all.length}`);
  line(`  hs_ system properties ${system.length}`);
  line(`  user-facing           ${all.length - system.length}`);

  const types = {};
  for (const p of all) {
    const k = `${p.type}/${p.fieldType}`;
    types[k] = (types[k] || 0) + 1;
  }
  line('\n  type/fieldType combinations present (map every one in typeMap.ts):');
  Object.entries(types)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, n]) => line(`    ${String(n).padStart(4)}  ${k}`));

  const enumWithOptions = all.find((p) => p.type === 'enumeration' && p.options?.length);
  if (enumWithOptions) {
    line(`\n  sample enumeration "${enumWithOptions.name}" options (internal → label):`);
    enumWithOptions.options.slice(0, 4).forEach((o) => line(`    ${o.value}  →  ${o.label}`));
  }
}

/* ── 3. Records ─────────────────────────────────────────────────────────── */

async function checkRecords(paths) {
  rule('3. RAW RECORD SHAPE');

  const { results: propDefs } = await get(paths.properties('contacts'));
  // Deliberately include textarea/html first: alphabetical sampling stops around
  // "firstname" and never reaches "message", which hides the multi-line evidence.
  const all = propDefs || [];
  const multiline = all.filter((p) => p.fieldType === 'textarea' || p.fieldType === 'html');
  const rest = all.filter((p) => !p.name.startsWith('hs_') && !multiline.includes(p));
  const wanted = [...multiline, ...rest.slice(0, 25)].map((p) => p.name);

  const qs = new URLSearchParams({ limit: '100', properties: wanted.join(',') });
  const page = await get(`${paths.objects('contacts')}?${qs}`);
  const records = page.results || [];

  line(`  fetched ${records.length} records`);
  line(`  paging.next.after present: ${Boolean(page.paging?.next?.after)}`);

  if (!records.length) {
    line('  ⚠  No contacts in this portal. Add a few and re-run.');
    return [];
  }

  const one = records[0];
  line('\n  One full record, pretty-printed:');
  line(JSON.stringify(one, null, 2).split('\n').map((l) => '    ' + l).join('\n'));

  // Question 4 from the README: how does an empty property present itself?
  const empties = Object.entries(one.properties).filter(([, v]) => v === null || v === '');
  line('\n  Empty-value representation in this payload:');
  if (!empties.length) {
    line('    (no empty values in this record — check another, or clear a field)');
  } else {
    empties.slice(0, 5).forEach(([k, v]) => line(`    ${k} = ${JSON.stringify(v)}`));
  }
  const requested = new Set(wanted);
  const absent = [...requested].filter((k) => !(k in one.properties));
  line(`    keys requested but ABSENT from the payload: ${absent.length}`);
  if (absent.length) line(`      e.g. ${absent.slice(0, 5).join(', ')}`);
  line('    → sanitize.ts rule 1 must handle null, "", AND missing keys.');

  writeFileSync(join(HERE, 'sample-records.json'), JSON.stringify(records, null, 2));
  line('\n  Wrote sample-records.json (100 records) for offline inspection.');

  return records;
}

/* ── 4. The newline question — the important one ────────────────────────── */

function checkNewlines(records) {
  rule('4. MULTI-LINE FIELDS  ← the product depends on this');

  const hits = [];
  for (const r of records) {
    for (const [k, v] of Object.entries(r.properties || {})) {
      if (typeof v === 'string' && /[\r\n]/.test(v)) hits.push({ id: r.id, k, v });
    }
  }

  if (!hits.length) {
    line('  ⚠  No multi-line value found in the sample.');
    line('     Go to the test portal, put THREE REAL LINE BREAKS in a textarea field');
    line('     on a contact, save, and re-run. Do not skip this — it is the entire');
    line('     reason the product exists.');
    return;
  }

  for (const h of hits.slice(0, 3)) {
    line(`\n  record ${h.id}  ·  property "${h.k}"`);
    line('  escaped (this is what you must look at):');
    line(`    ${JSON.stringify(h.v)}`);
    const crlf = (h.v.match(/\r\n/g) || []).length;
    const lf = (h.v.match(/(?<!\r)\n/g) || []).length;
    const cr = (h.v.match(/\r(?!\n)/g) || []).length;
    line(`  line-ending census:  CRLF=${crlf}  bare LF=${lf}  bare CR=${cr}`);
    line(`  → sanitize.ts rule 3 must normalise all three to \\n.`);
    line(`  → this value must produce ONE row, with wrapText on the column.`);
  }
}

/* ── 5. Associations ────────────────────────────────────────────────────── */

async function checkAssociations() {
  rule('5. BATCH ASSOCIATIONS  deals → companies');

  const deals = await get('/crm/v3/objects/deals?limit=10');
  const ids = (deals.results || []).map((d) => ({ id: d.id }));
  if (!ids.length) {
    line('  ⚠  No deals in this portal. Create one associated with a company.');
    return;
  }

  // v4 is the current associations API. If this 404s, look up the replacement.
  const r = await raw('/crm/v4/associations/deals/companies/batch/read', {
    method: 'POST',
    body: JSON.stringify({ inputs: ids }),
  });

  line(`  POST /crm/v4/associations/deals/companies/batch/read → HTTP ${r.status}`);
  if (r.status !== 200) {
    line(`  body: ${r.text.slice(0, 400)}`);
    line('  → find the current associations endpoint before writing T10.');
    return;
  }

  const body = JSON.parse(r.text);
  line('\n  Response shape:');
  line(JSON.stringify(body, null, 2).slice(0, 1200).split('\n').map((l) => '    ' + l).join('\n'));

  const withMultiple = (body.results || []).filter((x) => (x.to || []).length > 1);
  line(`\n  deals with MORE THAN ONE associated company: ${withMultiple.length}`);
  line('  → this is the case cardinality:"FIRST" resolves. Confirm your choice is right.');
}

/* ── 6. Owners ──────────────────────────────────────────────────────────── */

async function checkOwners() {
  rule('6. OWNERS');
  const r = await raw('/crm/v3/owners?limit=5');
  line(`  GET /crm/v3/owners → HTTP ${r.status}`);
  if (r.status !== 200) { line(`  body: ${r.text.slice(0, 300)}`); return; }
  const body = JSON.parse(r.text);
  const o = (body.results || [])[0];
  if (!o) { line('  no owners returned'); return; }
  line('  one owner record:');
  line(JSON.stringify(o, null, 2).split('\n').map((l) => '    ' + l).join('\n'));
  line('\n  → confirm whether contact.properties.hubspot_owner_id is an ID (it should be).');
  line('  → typeMap.ts resolves it to name+email using a per-run cache of this list.');
}

/* ── 7. Rate limit ──────────────────────────────────────────────────────── */

async function checkRateLimit() {
  rule('7. RATE LIMIT  (firing 200 requests on purpose)');
  line('  Expect 110 requests / 10s for marketplace OAuth apps.\n');

  const started = Date.now();
  let ok = 0, limited = 0, firstRetryAfter = null, firstLimitedAt = null;

  const batch = Array.from({ length: 200 }, async (_, i) => {
    const r = await raw('/crm/v3/objects/contacts?limit=1');
    if (r.status === 429) {
      limited++;
      if (firstLimitedAt === null) {
        firstLimitedAt = Date.now() - started;
        firstRetryAfter = r.headers.get('retry-after');
        line(`  first 429 after ${firstLimitedAt} ms and ~${i} requests`);
        line(`  Retry-After header: ${firstRetryAfter ?? '(absent)'}`);
        const remaining = r.headers.get('x-hubspot-ratelimit-remaining');
        const interval = r.headers.get('x-hubspot-ratelimit-interval-milliseconds');
        line(`  x-hubspot-ratelimit-remaining: ${remaining ?? '(absent)'}`);
        line(`  x-hubspot-ratelimit-interval-milliseconds: ${interval ?? '(absent)'}`);
      }
    } else if (r.status === 200) ok++;
  });

  await Promise.all(batch);

  line(`\n  succeeded ${ok}  ·  rate-limited ${limited}  ·  elapsed ${Date.now() - started} ms`);
  if (!limited) {
    line('  ⚠  Never hit the limit. Either the portal has a higher quota or the requests');
    line('     were not concurrent enough. Do NOT conclude there is no limit.');
  }
  line('\n  → T5 token bucket: 100 req / 10s per portal, leaving headroom for the');
  line('    customer\'s other integrations sharing the same quota.\n');
}

/* ── plumbing ───────────────────────────────────────────────────────────── */

function load() {
  // Mode A — private app token. Fastest path to real payloads: no OAuth dance.
  // Create a private app inside the TEST portal, copy its token into .env.
  const pat = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (pat) {
    return {
      mode: 'private',
      access_token: pat,
      expires_at: Number.MAX_SAFE_INTEGER, // private app tokens do not expire
      portalId: '(private app)',
      hubDomain: '',
    };
  }

  // Mode B — OAuth tokens produced by auth.mjs.
  try {
    return { mode: 'oauth', ...JSON.parse(readFileSync(TOKENS, 'utf8')) };
  } catch {
    console.error(
      'No credentials found. Either:\n' +
      '  A) put HUBSPOT_PRIVATE_APP_TOKEN=pat-... in .env   (fast, payload recon only)\n' +
      '  B) run: node --env-file=.env auth.mjs              (full OAuth flow)',
    );
    process.exit(1);
  }
}

async function refreshIfNeeded() {
  if (tokens.mode === 'private') return;
  if (Date.now() < tokens.expires_at - 60_000) return;
  const r = await fetch(`${BASE}/oauth/v1/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.HUBSPOT_CLIENT_ID,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
    }),
  });
  const body = await r.text();
  if (!r.ok) {
    // 400 invalid_grant here = the grant was revoked. In production: stop, do not retry.
    console.error(`Refresh failed ${r.status}: ${body}`);
    process.exit(1);
  }
  const fresh = JSON.parse(body);
  tokens = { ...tokens, ...fresh, expires_at: Date.now() + fresh.expires_in * 1000 };
  writeFileSync(TOKENS, JSON.stringify(tokens, null, 2));
  console.log('  (access token refreshed)');
}

async function raw(path, init = {}) {
  await refreshIfNeeded();
  apiCalls++;
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${tokens.access_token}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  return { status: r.status, headers: r.headers, text: await r.text() };
}

async function get(path) {
  const r = await raw(path);
  if (r.status !== 200) {
    console.error(`\n  GET ${path} → ${r.status}\n  ${r.text.slice(0, 500)}\n`);
    process.exit(1);
  }
  return JSON.parse(r.text);
}
