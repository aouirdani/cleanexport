#!/usr/bin/env node
/**
 * T0 — HubSpot OAuth dance.
 * Zero dependencies. Node 20.6+.
 *
 *   node --env-file=.env auth.mjs
 *
 * Writes tokens.json in this folder. Throwaway tooling — not product code.
 */

import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const CLIENT_ID = process.env.HUBSPOT_CLIENT_ID;
const CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET;
const REDIRECT_URI = process.env.HUBSPOT_REDIRECT_URI || 'http://localhost:3000/callback';

const SCOPES = [
  'oauth',
  'crm.objects.contacts.read',
  'crm.objects.companies.read',
  'crm.objects.deals.read',
  'crm.objects.owners.read',
  'tickets',
  'crm.schemas.contacts.read',
  'crm.schemas.companies.read',
  'crm.schemas.deals.read',
];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing HUBSPOT_CLIENT_ID or HUBSPOT_CLIENT_SECRET.');
  console.error('Create .env in this folder — see README.md.');
  process.exit(1);
}

const state = randomBytes(16).toString('hex');
const port = Number(new URL(REDIRECT_URI).port || 3000);

const authorizeUrl =
  'https://app.hubspot.com/oauth/authorize?' +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(' '),
    state,
  }).toString();

console.log('\n─────────────────────────────────────────────');
console.log('Open this URL in your browser and pick your TEST portal:\n');
console.log(authorizeUrl);
console.log('\n─────────────────────────────────────────────');
console.log(`Waiting for the callback on port ${port}...\n`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname !== new URL(REDIRECT_URI).pathname) {
    res.writeHead(404).end('not here');
    return;
  }

  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(400).end(`HubSpot returned an error: ${error}`);
    console.error('OAuth error:', error, url.searchParams.get('error_description'));
    server.close();
    process.exit(1);
  }

  // CSRF check. The product must do this too — see 04-HUBSPOT-INTEGRATION.md §2.
  if (returnedState !== state) {
    res.writeHead(400).end('state mismatch');
    console.error('State mismatch. Aborting.');
    server.close();
    process.exit(1);
  }

  try {
    const tokens = await exchangeCode(code);
    const introspection = await introspect(tokens.access_token);

    const payload = {
      ...tokens,
      obtained_at: Date.now(),
      expires_at: Date.now() + tokens.expires_in * 1000,
      portalId: introspection.hub_id,
      hubDomain: introspection.hub_domain,
      userEmail: introspection.user,
      userId: introspection.user_id,
      scopes: introspection.scopes,
    };

    writeFileSync(join(HERE, 'tokens.json'), JSON.stringify(payload, null, 2));

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
       .end('<h2>Connected.</h2><p>You can close this tab and go back to the terminal.</p>');

    console.log('Connected.\n');
    console.log('  portalId    ', introspection.hub_id);
    console.log('  hub domain  ', introspection.hub_domain);
    console.log('  user        ', introspection.user);
    console.log('  expires_in  ', tokens.expires_in, 'seconds');
    console.log('  scopes      ', (introspection.scopes || []).join(' '));
    console.log('\nWrote tokens.json. Now run:  node --env-file=.env probe.mjs\n');

    // NOTE for the product build: expires_in is read from the response, never hardcoded.
  } catch (e) {
    res.writeHead(500).end('token exchange failed, see terminal');
    console.error('\nToken exchange failed:\n', e.message);
  } finally {
    server.close();
  }
});

server.listen(port);

async function exchangeCode(code) {
  const r = await fetch('https://api.hubapi.com/oauth/v1/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code,
    }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${body}`);
  return JSON.parse(body);
}

async function introspect(accessToken) {
  const r = await fetch(
    `https://api.hubapi.com/oauth/v1/access-tokens/${encodeURIComponent(accessToken)}`,
  );
  const body = await r.text();
  if (!r.ok) throw new Error(`introspection ${r.status} ${body}`);
  return JSON.parse(body);
}
