/**
 * GET /api/runs/:id/download - specs/07-TASKS.md T14.
 *
 * 302s to a freshly-generated signed R2 URL. The signed URL is never
 * persisted (inngest/r2.ts's presignR2Url is called fresh on every request
 * here, same as it is once at run-completion time for the email link) - see
 * specs/02-ARCHITECTURE.md section 5.
 *
 * Two distinct "not found" reasons collapse to the same 404, on purpose:
 * a run id that belongs to another portal must be indistinguishable from a
 * run id that does not exist at all. `findFirst` scopes by portalId in the
 * WHERE clause itself (not a separate ownership check after an unscoped
 * lookup) specifically so there is no code path that could accidentally
 * return 403 (which would confirm the row exists) instead of 404.
 *
 * A run whose download window has passed gets 410, not 404 - genuinely
 * different information (this file did exist and was yours) that a 404
 * would hide, and worth surfacing so a customer doesn't wonder if the link
 * was ever valid. The window is DOWNLOAD_URL_TTL_SECONDS (7 days) from
 * run.finishedAt - the same "link expires in 7 days" promise the success
 * email states (inngest/email.ts) - independent of how long the underlying
 * R2 object physically survives (up to 90 days, inngest/cleanup.ts).
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { readSession } from '@/lib/session';
import { AppError, ErrorCode } from '@/lib/errors';
import { RunStatus } from '@/lib/generated/prisma/client';
import { loadR2Config, signedDownloadUrl, DOWNLOAD_URL_TTL_SECONDS } from '@/inngest/r2';
import { exportFilename } from '@/inngest/email';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json(new AppError(ErrorCode.NOT_AUTHENTICATED, 'Not signed in', 401).toJSON(), {
      status: 401,
    });
  }

  const { id } = await params;

  const run = await prisma.exportRun.findFirst({
    where: { id, portalId: session.portalId },
    select: { status: true, fileKey: true, finishedAt: true, export: { select: { name: true } } },
  });

  if (!run || run.status !== RunStatus.SUCCESS || !run.fileKey || !run.finishedAt) {
    return NextResponse.json(new AppError(ErrorCode.NOT_FOUND, 'Export run not found', 404).toJSON(), {
      status: 404,
    });
  }

  const expiresAt = run.finishedAt.getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000;
  if (Date.now() > expiresAt) {
    return NextResponse.json(
      new AppError(ErrorCode.LINK_EXPIRED, 'This download link has expired', 410).toJSON(),
      { status: 410 },
    );
  }

  const r2 = loadR2Config();
  // Defect #2: response-content-disposition=attachment (with the same
  // slugified filename the success email's attachment uses) makes the
  // browser download the file directly instead of opening a blank tab -
  // R2 otherwise serves the object with no Content-Disposition at all.
  const filename = exportFilename(run.export.name, run.finishedAt);
  const url = signedDownloadUrl(r2, run.fileKey, filename);

  return NextResponse.redirect(url, 302);
}
