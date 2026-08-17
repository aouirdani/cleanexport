/**
 * Property definitions and owners, shared setup for an export run.
 *
 * Mirrors the caching approach in app/api/properties/[objectType]/route.ts
 * (PropertyCache, 24h freshness) - not imported directly since that file is a
 * route handler, not a reusable module, but the same cache row so a run
 * doesn't force a redundant HubSpot call right after the user previewed
 * their export.
 */

import { prisma } from '@/lib/db';
import { ObjectType, type Prisma } from '@/lib/generated/prisma/client';
import type { HubSpotClient } from '@/lib/hubspot/client';
import type { PropertyDef } from '@/lib/export/typeMap';

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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

function toPropertyDef(prop: RawHubSpotProperty): PropertyDef {
  return {
    name: prop.name,
    label: prop.label,
    type: prop.type,
    fieldType: prop.fieldType,
    options: prop.options,
    referencedObjectType: prop.referencedObjectType,
    showCurrencySymbol: prop.showCurrencySymbol,
    currencyPropertyName: prop.currencyPropertyName,
  };
}

export async function loadPropertyDefs(
  client: HubSpotClient,
  portalId: string,
  objectType: ObjectType,
): Promise<Map<string, PropertyDef>> {
  const cached = await prisma.propertyCache.findUnique({
    where: { portalId_objectType: { portalId, objectType } },
  });

  let raw: RawHubSpotProperty[];
  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_MAX_AGE_MS) {
    raw = cached.payload as unknown as RawHubSpotProperty[];
  } else {
    const { results } = await client.properties<{ results: RawHubSpotProperty[] }>(objectType.toLowerCase());
    raw = results;
    const payload = results as unknown as Prisma.InputJsonValue;
    await prisma.propertyCache.upsert({
      where: { portalId_objectType: { portalId, objectType } },
      create: { portalId, objectType, payload },
      update: { payload, fetchedAt: new Date() },
    });
  }

  const defs = new Map<string, PropertyDef>();
  for (const prop of raw) defs.set(prop.name, toPropertyDef(prop));
  return defs;
}

interface RawHubSpotOwner {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export async function loadOwners(client: HubSpotClient): Promise<Map<string, { name: string; email: string }>> {
  const { results } = await client.owners<{ results: RawHubSpotOwner[] }>();
  const owners = new Map<string, { name: string; email: string }>();
  for (const owner of results) {
    const name = [owner.firstName, owner.lastName].filter(Boolean).join(' ') || owner.email;
    owners.set(String(owner.id), { name, email: owner.email });
  }
  return owners;
}
