/**
 * Security-audit findings (this repo's own audit, item "no security
 * headers configured"): Vercel already sends strict-transport-security on
 * the live domain (verified directly against the deployed site), so HSTS
 * is deliberately NOT duplicated here. Everything below is genuinely
 * missing otherwise. Plain module (not inline in next.config.ts) so the
 * actual header values are unit-testable without importing next.config.ts
 * itself (which is wrapped in withSentryConfig and isn't meant to be
 * exercised from a test).
 *
 * X-Frame-Options/nosniff/Referrer-Policy/Permissions-Policy are safe to
 * enforce immediately - none of them change how any page on this site
 * currently behaves.
 *
 * The CSP is NOT one of those - it is shipped as
 * Content-Security-Policy-Report-Only, not Content-Security-Policy,
 * deliberately. Next.js's own inline bootstrap <script> tags and this
 * app's few inline `style={{...}}` usages (components/exports/property-picker.tsx's
 * virtualised-list transform, its selection progress bar) need
 * 'unsafe-inline' on script-src/style-src just to load without breaking -
 * an enforced CSP shipped without first checking the browser console on
 * every page would risk taking down the dashboard, which is worse than
 * the missing header. Report-Only sends violations to the console with
 * zero effect on page behavior - flip the header name to
 * `Content-Security-Policy` only after that console check comes back
 * clean on every real page (landing, login, dashboard, run history,
 * export builder).
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.sentry.io https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy-Report-Only", value: CONTENT_SECURITY_POLICY },
];
