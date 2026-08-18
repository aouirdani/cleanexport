/**
 * Sentry - edge runtime (middleware, edge route handlers). Loaded from
 * instrumentation.ts's register() when NEXT_RUNTIME === 'edge' -
 * specs/07-TASKS.md T22. See sentry.server.config.ts's header for why
 * both hooks come from the shared lib/sentryHooks.ts.
 */
import * as Sentry from '@sentry/nextjs';
import { sentryBeforeSend, sentryBeforeBreadcrumb } from '@/lib/sentryHooks';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
  beforeSend: sentryBeforeSend,
  beforeBreadcrumb: sentryBeforeBreadcrumb,
});
