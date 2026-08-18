/**
 * Next.js instrumentation entry point - registers Sentry for whichever
 * server runtime is actually running (specs/07-TASKS.md T22). Named
 * `sentry.server.config`/`sentry.edge.config` in the dynamic import paths
 * on purpose: @sentry/nextjs's build-time check only skips its "put this in
 * register()" deprecation warning when it can see one of those two
 * filenames referenced from this file.
 */
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
