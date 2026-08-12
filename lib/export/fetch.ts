/**
 * Streams CRM records page by page - specs/05-EXPORT-ENGINE.md sections 6 and 9;
 * recon/FINDINGS.md sections 2, 3, 10, 13.
 *
 * An async generator, not an array-returning function: a 250,000-row export must
 * keep memory flat, so each page is fetched, yielded, and discarded - never
 * accumulated. All network access goes through the passed-in HubSpotClient.
 */

import type { HubSpotClient } from '@/lib/hubspot/client';
import type { PropertyDef } from '@/lib/export/typeMap';
import { AppError, ErrorCode } from '@/lib/errors';

export interface Filters {
  operator: 'AND';
  conditions: Array<{ property: string; operator: string; value?: string; highValue?: string; values?: string[] }>;
}

export interface HubSpotRecord {
  id: string;
  properties: Record<string, string | null>;
}

interface Page {
  results: HubSpotRecord[];
  paging?: { next?: { after?: string } };
  total?: number;
}

const PAGE_LIMIT = 100;

/**
 * FINDINGS.md section 2: 200 short property names produced a 5,116-character
 * query string at HTTP 200, but verbose custom property names can exceed it.
 * Past this, switch to a POST body, which has no such limit.
 */
const MAX_QUERY_STRING_LENGTH = 7000;

/**
 * HubSpot's Search endpoint caps `total` at 10,000. Reaching it means the true
 * result set may be larger and is unknowable from this response alone - never
 * truncate silently, never split behind the user's back (spec section 6).
 */
const SEARCH_TOTAL_CAP = 10000;

/**
 * FINDINGS.md section 13: a property with `currencyPropertyName` set must pull
 * that companion property in too, whether or not the caller asked for it, or the
 * currency is unknowable at write time. Deduped against what was already requested.
 */
function withCurrencyProperties(properties: string[], propertyDefs?: Map<string, PropertyDef>): string[] {
  if (!propertyDefs) return properties;

  const result = [...properties];
  for (const name of properties) {
    const currencyProperty = propertyDefs.get(name)?.currencyPropertyName;
    if (currencyProperty && !result.includes(currencyProperty)) {
      result.push(currencyProperty);
    }
  }
  return result;
}

function assembledQueryStringLength(properties: string[]): number {
  const params = new URLSearchParams({ properties: properties.join(','), limit: String(PAGE_LIMIT) });
  return params.toString().length;
}

async function fetchListPage(
  client: HubSpotClient,
  objectType: string,
  properties: string[],
  after: string | undefined,
): Promise<Page> {
  const params: Record<string, string> = { properties: properties.join(','), limit: String(PAGE_LIMIT) };
  if (after !== undefined) params.after = after;
  return client.listObjects<Page>(objectType, params);
}

async function fetchSearchPage(
  client: HubSpotClient,
  objectType: string,
  properties: string[],
  filters: Filters | undefined,
  after: string | undefined,
): Promise<Page> {
  const body: Record<string, unknown> = { properties, limit: PAGE_LIMIT };
  if (filters) body.filterGroups = [{ filters: filters.conditions }];
  if (after !== undefined) body.after = after;

  const page = await client.searchObjects<Page>(objectType, body);

  if (typeof page.total === 'number' && page.total >= SEARCH_TOTAL_CAP) {
    throw new AppError(
      ErrorCode.SEARCH_CAP_EXCEEDED,
      `Search matched HubSpot's ${SEARCH_TOTAL_CAP}-record cap; the true result set may be larger`,
      400,
    );
  }

  return page;
}

export async function* fetchRecords(
  client: HubSpotClient,
  objectType: string,
  properties: string[],
  filters?: Filters,
  propertyDefs?: Map<string, PropertyDef>,
): AsyncGenerator<HubSpotRecord[]> {
  const allProperties = withCurrencyProperties(properties, propertyDefs);
  const useSearch = Boolean(filters) || assembledQueryStringLength(allProperties) > MAX_QUERY_STRING_LENGTH;

  let after: string | undefined;
  while (true) {
    const page = useSearch
      ? await fetchSearchPage(client, objectType, allProperties, filters, after)
      : await fetchListPage(client, objectType, allProperties, after);

    if (page.results.length > 0) yield page.results;

    after = page.paging?.next?.after;
    if (!after) break;
  }
}
