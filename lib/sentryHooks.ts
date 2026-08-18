/**
 * The `beforeSend`/`beforeBreadcrumb` hooks shared by all three Sentry
 * configs (instrumentation-client.ts, sentry.server.config.ts,
 * sentry.edge.config.ts) - specs/07-TASKS.md T22. Extracted into their own
 * module, rather than defined inline in each config file, so a test can
 * import and call them directly without needing to mock `Sentry.init` just
 * to get at the function it was given.
 *
 * Both are thin wrappers over lib/scrub.ts's scrubValue - see that file's
 * header for the actual scrubbing rules. There is nothing Sentry-specific
 * about the scrubbing itself; only the function signatures (Sentry's
 * `Event`/`Breadcrumb` types) are specific to this module.
 */
import type { ErrorEvent, Breadcrumb, EventHint } from '@sentry/nextjs';
import { scrubValue } from '@/lib/scrub';

export function sentryBeforeSend(event: ErrorEvent, hint: EventHint): ErrorEvent {
  void hint; // part of Sentry's beforeSend signature, unused - scrubbing needs only the event itself
  return scrubValue(event);
}

export function sentryBeforeBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return scrubValue(breadcrumb);
}
