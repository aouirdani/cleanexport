#!/usr/bin/env -S npx tsx
/**
 * Manual end-to-end check for the export pipeline against a REAL HubSpot
 * portal. Throwaway tooling - not part of the app, not imported by it, not
 * covered by CI.
 *
 * What it does:
 *   1. Reads HUBSPOT_PRIVATE_APP_TOKEN from recon/.env
 *   2. Fetches contact property definitions and builds a PropertyDef Map
 *   3. Fetches contacts for message (the multi-line fixture), firstname,
 *      email, createdate, hubspot_owner_id
 *   4. Fetches owners and builds an owners Map
 *   5. Runs fetchRecords -> writeExport into /tmp/cleanexport-e2e.xlsx
 *   6. Prints the row count and the output path
 *
 * Run with:
 *   npx tsx scripts/e2e-export.mts
 *
 * Uses the real lib/export modules (fetch.ts, writer.ts, typeMap.ts -
 * sanitize.ts is exercised transitively, inside writer.ts). A private app
 * token authenticates directly against the HubSpot API - there is no OAuth
 * portal record, no Prisma, no lib/hubspot/client.ts HubSpotClient instance.
 * Instead, a minimal object exposing just the listObjects/searchObjects
 * methods fetchRecords actually calls is built below and cast to
 * HubSpotClient's type, the same way the test suite's fake clients do.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { fetchRecords } from '@/lib/export/fetch';
import { writeExport } from '@/lib/export/writer';
import type { PropertyDef } from '@/lib/export/typeMap';
import type { HubSpotClient } from '@/lib/hubspot/client';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(HERE, '..', 'recon', '.env');
const OUTPUT_PATH = '/tmp/cleanexport-e2e.xlsx';
const OBJECT_TYPE = 'contacts';
const PROPERTIES = ['message', 'firstname', 'email', 'createdate', 'hubspot_owner_id'];

const API_BASE = 'https://api.hubapi.com';
const API_VERSION = process.env.HUBSPOT_API_VERSION ?? '2026-03';

function readPrivateAppToken(): string {
  const content = readFileSync(ENV_PATH, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() !== 'HUBSPOT_PRIVATE_APP_TOKEN') continue;
    const value = trimmed.slice(eq + 1).trim();
    if (value) return value;
  }
  throw new Error(`HUBSPOT_PRIVATE_APP_TOKEN not found in ${ENV_PATH}`);
}

/**
 * Wraps a private app token in a minimal object exposing the same
 * listObjects/searchObjects methods lib/export/fetch.ts's fetchRecords
 * expects from a HubSpotClient - plus properties/owners, used only by this
 * script to build propertyDefs and the owners Map. No Portal row, no
 * Prisma, no token refresh - a private app token does not expire.
 */
function makePrivateAppClient(token: string) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...init.headers,
      },
    });
    if (!res.ok && res.status !== 207) {
      const body = await res.text().catch(() => '');
      throw new Error(`HubSpot request failed: ${res.status} ${path} - ${body.slice(0, 300)}`);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  return {
    properties<T = unknown>(objectType: string): Promise<T> {
      return request<T>(`/crm/properties/${API_VERSION}/${objectType}`);
    },
    listObjects<T = unknown>(objectType: string, params: Record<string, string>): Promise<T> {
      const qs = new URLSearchParams(params).toString();
      return request<T>(`/crm/objects/${API_VERSION}/${objectType}?${qs}`);
    },
    searchObjects<T = unknown>(objectType: string, body: unknown): Promise<T> {
      return request<T>(`/crm/objects/${API_VERSION}/${objectType}/search`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    owners<T = unknown>(): Promise<T> {
      return request<T>('/crm/v3/owners?limit=100');
    },
  };
}

type PrivateAppClient = ReturnType<typeof makePrivateAppClient>;

interface RawHubSpotProperty {
  name: string;
  label: string;
  type: string;
  fieldType: string;
  options?: { label: string; value: string }[];
  referencedObjectType?: string;
  showCurrencySymbol?: boolean;
  currencyPropertyName?: string;
}

async function fetchPropertyDefs(client: PrivateAppClient): Promise<Map<string, PropertyDef>> {
  const { results } = await client.properties<{ results: RawHubSpotProperty[] }>(OBJECT_TYPE);
  const defs = new Map<string, PropertyDef>();
  for (const prop of results) {
    defs.set(prop.name, {
      name: prop.name,
      label: prop.label,
      type: prop.type,
      fieldType: prop.fieldType,
      options: prop.options,
      referencedObjectType: prop.referencedObjectType,
      showCurrencySymbol: prop.showCurrencySymbol,
      currencyPropertyName: prop.currencyPropertyName,
    });
  }
  return defs;
}

interface RawHubSpotOwner {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

async function fetchOwnersMap(client: PrivateAppClient): Promise<Map<string, { name: string; email: string }>> {
  const { results } = await client.owners<{ results: RawHubSpotOwner[] }>();
  const owners = new Map<string, { name: string; email: string }>();
  for (const owner of results) {
    const name = [owner.firstName, owner.lastName].filter(Boolean).join(' ') || owner.email;
    owners.set(String(owner.id), { name, email: owner.email });
  }
  return owners;
}

async function main(): Promise<void> {
  const token = readPrivateAppToken();
  const client = makePrivateAppClient(token);

  console.log(`Fetching ${OBJECT_TYPE} property definitions...`);
  const propertyDefs = await fetchPropertyDefs(client);
  console.log(`  ${propertyDefs.size} property definitions loaded`);

  console.log('Fetching owners...');
  const owners = await fetchOwnersMap(client);
  console.log(`  ${owners.size} owners loaded`);

  console.log(`Exporting ${OBJECT_TYPE} (${PROPERTIES.join(', ')}) -> ${OUTPUT_PATH} ...`);
  const { rowCount } = await writeExport({
    filePath: OUTPUT_PATH,
    records: fetchRecords(client as unknown as HubSpotClient, OBJECT_TYPE, PROPERTIES, undefined, propertyDefs),
    properties: PROPERTIES,
    propertyDefs,
    headerStyle: 'LABEL',
    owners,
  });

  console.log(`\nRows written: ${rowCount}`);
  console.log(`Output: ${OUTPUT_PATH}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
