/**
 * Sentry - server runtime. Loaded from instrumentation.ts's register()
 * when NEXT_RUNTIME === 'nodejs' - specs/02-ARCHITECTURE.md section 5
 * ("Sentry... non-optional"), specs/07-TASKS.md T22.
 *
 * beforeSend/beforeBreadcrumb both come from lib/sentryHooks.ts, which
 * itself is just lib/scrub.ts's scrubValue - the ONE scrubbing
 * implementation, shared with lib/logger.ts and the client/edge configs.
 * "A Sentry breadcrumb is a log line: the same scrubbing applies" is why
 * beforeBreadcrumb is wired here too, not just beforeSend - a breadcrumb
 * never reaches beforeSend on its own if nothing is ever captured in that
 * scope, so relying on beforeSend alone would miss it.
 */
import * as Sentry from '@sentry/nextjs';
import { sentryBeforeSend, sentryBeforeBreadcrumb } from '@/lib/sentryHooks';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
  beforeSend: sentryBeforeSend,
  beforeBreadcrumb: sentryBeforeBreadcrumb,
});
