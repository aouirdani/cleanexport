import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { ObjectType, type Prisma } from '@/lib/generated/prisma/client';
import { readSession } from '@/lib/session';
import { AppError, ErrorCode } from '@/lib/errors';
import { HubSpotClient } from '@/lib/hubspot/client';

export const dynamic = 'force-dynamic';

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const OBJECT_TYPES: Record<string, ObjectType> = {
  contacts: ObjectType.CONTACTS,
  companies: ObjectType.COMPANIES,
  deals: ObjectType.DEALS,
  tickets: ObjectType.TICKETS,
};

interface HubSpotProperty {
  name: string;
  label: string;
  type: string;
  fieldType: string;
  options?: unknown;
  description?: string;
  calculated?: boolean;
  hidden?: boolean;
}

/**
 * Additive over the shape documented in specs/06-API-CONTRACT.md
 * (`{ name, label, type, fieldType, options?, isSystem }`) - `description`,
 * `calculated` and `hidden` are already present on the raw HubSpot payload
 * PropertyCache stores (recon/FINDINGS.md section 13's table), so this is
 * just widening what the route already reads from it, not a new HubSpot
 * call. specs/07-TASKS.md T17's property picker needs them: description as
 * tooltip text, calculated/hidden marked visually.
 */
function toResponseShape(properties: HubSpotProperty[]) {
  return properties.map((p) => ({
    name: p.name,
    label: p.label,
    type: p.type,
    fieldType: p.fieldType,
    options: p.options,
    isSystem: p.name.startsWith('hs_'),
    description: p.description ?? null,
    calculated: p.calculated ?? false,
    hidden: p.hidden ?? false,
  }));
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ objectType: string }> },
) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json(
      new AppError(ErrorCode.NOT_AUTHENTICATED, 'Not signed in', 401).toJSON(),
      { status: 401 },
    );
  }

  const { objectType: rawObjectType } = await params;
  const objectType = OBJECT_TYPES[rawObjectType];
  if (!objectType) {
    return NextResponse.json(
      new AppError(ErrorCode.VALIDATION_FAILED, `Unknown object type: ${rawObjectType}`, 400).toJSON(),
      { status: 400 },
    );
  }

  const cached = await prisma.propertyCache.findUnique({
    where: { portalId_objectType: { portalId: session.portalId, objectType } },
  });

  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_MAX_AGE_MS) {
    return NextResponse.json({
      properties: toResponseShape(cached.payload as unknown as HubSpotProperty[]),
    });
  }

  const client = await HubSpotClient.forPortal(session.portalId);
  const { results } = await client.properties<{ results: HubSpotProperty[] }>(rawObjectType);
  const payload = results as unknown as Prisma.InputJsonValue;

  await prisma.propertyCache.upsert({
    where: { portalId_objectType: { portalId: session.portalId, objectType } },
    create: { portalId: session.portalId, objectType, payload },
    update: { payload, fetchedAt: new Date() },
  });

  return NextResponse.json({ properties: toResponseShape(results) });
}
