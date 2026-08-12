/**
 * Resolves association columns - specs/05-EXPORT-ENGINE.md section 7;
 * recon/FINDINGS.md sections 11 and 12.
 *
 * Two batched calls, never one:
 *   1. batchReadAssociations - ids only. The client already accepts HTTP 200
 *      and 207 (multi-status: some inputs resolved, some did not) and hands
 *      back parsed JSON either way, so 207 needs no special handling here.
 *      `results` does not align with `inputs` - records with no association
 *      are simply absent from `results`, not zipped in by index.
 *   2. batchReadObjects - fetches the requested columns for the resolved ids.
 *
 * Both calls are chunked at 100 ids, independently: the associations call
 * chunks recordIds, the objects call chunks the (deduped) resolved to-ids.
 */

import type { HubSpotClient } from '@/lib/hubspot/client';

const BATCH_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

interface AssociationsResponse {
  results: Array<{
    from: { id: string };
    to: Array<{ toObjectId: number; associationTypes: Array<{ typeId: number; label: string | null }> }>;
  }>;
  errors?: unknown[];
}

interface ObjectsResponse {
  results: Array<{ id: string; properties: Record<string, unknown> }>;
}

/**
 * The primary entry is the one whose associationTypes contains a type
 * labelled "Primary" (typeId 5 for deal->company) - never to[0]. Array order
 * is not documented as stable; to[0] happens to be primary in the one
 * observed payload, which is exactly how that bug survives testing.
 * Fall back to to[0] only when nothing is labelled.
 */
function selectPrimaryToId(to: AssociationsResponse['results'][number]['to']): string | undefined {
  if (to.length === 0) return undefined;
  const primary = to.find((entry) => entry.associationTypes.some((t) => t.label === 'Primary'));
  return String((primary ?? to[0]).toObjectId);
}

export async function resolveAssociations(
  client: HubSpotClient,
  fromObjectType: string,
  recordIds: string[],
  spec: { toObjectType: string; columns: string[]; cardinality?: 'PRIMARY' | 'JOIN' },
): Promise<Map<string, Record<string, unknown>>> {
  const result = new Map<string, Record<string, unknown>>();
  if (recordIds.length === 0) return result;

  // Step 1: ids only. Map keyed by String(from.id) - from.id arrives as a
  // string, to[].toObjectId as a number, in the same response (FINDINGS
  // section 12). String() every id on both sides of every key operation.
  const primaryToIdByFromId = new Map<string, string>();
  for (const idsChunk of chunk(recordIds, BATCH_SIZE)) {
    const response = await client.batchReadAssociations<AssociationsResponse>(
      fromObjectType,
      spec.toObjectType,
      idsChunk.map((id) => ({ id })),
    );
    for (const entry of response.results) {
      const toId = selectPrimaryToId(entry.to);
      if (toId) primaryToIdByFromId.set(String(entry.from.id), toId);
    }
  }

  // Step 2: the requested columns for the resolved ids, deduped and
  // rechunked - several from-records can share the same associated record.
  const uniqueToIds = [...new Set(primaryToIdByFromId.values())];
  const propertiesByToId = new Map<string, Record<string, unknown>>();
  for (const idsChunk of chunk(uniqueToIds, BATCH_SIZE)) {
    const response = await client.batchReadObjects<ObjectsResponse>(spec.toObjectType, {
      inputs: idsChunk.map((id) => ({ id })),
      properties: spec.columns,
    });
    for (const record of response.results) {
      propertiesByToId.set(String(record.id), record.properties);
    }
  }

  // A record with no association (absent from primaryToIdByFromId) simply
  // never gets a map entry - an empty cell, not a failed run.
  for (const [fromId, toId] of primaryToIdByFromId) {
    const properties = propertiesByToId.get(toId);
    if (properties) result.set(fromId, properties);
  }

  return result;
}
