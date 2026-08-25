import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
// Relative import, not the "@/" alias: next.config.ts is loaded by Next's
// own config loader outside the normal app module-resolution pipeline,
// which does not reliably honor tsconfig path aliases here.
import { SECURITY_HEADERS } from "./lib/securityHeaders";

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default withSentryConfig(nextConfig, {
  // Source map upload needs an org/project/auth token - all optional at
  // build time (unset in dev and in this repo's tests/CI). Missing them
  // just skips the upload step rather than failing the build.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
});
