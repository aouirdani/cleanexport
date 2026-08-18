/**
 * Sentry - browser runtime. Next.js 16 + Turbopack loads this file
 * automatically by convention (the older `sentry.client.config.ts` is
 * deprecated for Turbopack builds) - specs/07-TASKS.md T22. Uses the
 * `NEXT_PUBLIC_`-prefixed DSN since this file ships to the browser; the DSN
 * itself is not a secret (it only routes error ingest, it grants no
 * access), but see sentry.server.config.ts's header for why
 * beforeSend/beforeBreadcrumb (from the shared lib/sentryHooks.ts) still
 * run everything through the scrubber regardless - the DSN isn't secret,
 * session cookies and tokens that might get swept up into a browser-side
 * event are.
 */
import * as Sentry from '@sentry/nextjs';
import { sentryBeforeSend, sentryBeforeBreadcrumb } from '@/lib/sentryHooks';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
  beforeSend: sentryBeforeSend,
  beforeBreadcrumb: sentryBeforeBreadcrumb,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
