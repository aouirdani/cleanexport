import { describe, it, expect } from 'vitest';
import { SECURITY_HEADERS, CONTENT_SECURITY_POLICY } from '@/lib/securityHeaders';

// This repo's own security audit: "no security headers configured" -
// next.config.ts had no headers() at all. HSTS is deliberately NOT among
// these: Vercel already sends it on the live domain, so duplicating it
// here would be redundant, not protective.

function find(key: string): string | undefined {
  return SECURITY_HEADERS.find((h) => h.key === key)?.value;
}

describe('SECURITY_HEADERS', () => {
  it('sets X-Content-Type-Options: nosniff', () => {
    expect(find('X-Content-Type-Options')).toBe('nosniff');
  });

  it('sets Referrer-Policy: strict-origin-when-cross-origin', () => {
    expect(find('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('sets X-Frame-Options: DENY', () => {
    expect(find('X-Frame-Options')).toBe('DENY');
  });

  it('sets a Permissions-Policy denying camera, microphone, and geolocation', () => {
    const value = find('Permissions-Policy');
    expect(value).toBeDefined();
    expect(value).toMatch(/camera=\(\)/);
    expect(value).toMatch(/microphone=\(\)/);
    expect(value).toMatch(/geolocation=\(\)/);
  });

  it('does NOT set a real (enforcing) Strict-Transport-Security header - Vercel already sends it on the live domain', () => {
    expect(find('Strict-Transport-Security')).toBeUndefined();
  });

  // The CSP is shipped Report-Only, not enforced: Next.js's own inline
  // bootstrap scripts and this app's few inline `style={{...}}` usages
  // (components/exports/property-picker.tsx) need 'unsafe-inline' just to
  // load, and an enforced policy shipped without checking the browser
  // console on every real page first would risk breaking the dashboard -
  // worse than the missing header. This must stay Report-Only until that
  // check has actually been done.
  it('ships the CSP as Content-Security-Policy-Report-Only, never as an enforcing Content-Security-Policy', () => {
    expect(find('Content-Security-Policy-Report-Only')).toBe(CONTENT_SECURITY_POLICY);
    expect(find('Content-Security-Policy')).toBeUndefined();
  });

  it("the CSP's frame-ancestors is 'none' - belt-and-suspenders with the enforced X-Frame-Options: DENY above", () => {
    expect(CONTENT_SECURITY_POLICY).toMatch(/frame-ancestors 'none'/);
  });

  it('the CSP allows inline scripts/styles (documented necessity for Next.js), not a silently-broken strict policy', () => {
    expect(CONTENT_SECURITY_POLICY).toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(CONTENT_SECURITY_POLICY).toMatch(/style-src[^;]*'unsafe-inline'/);
  });

  it('the CSP defaults to same-origin only, not a wide-open policy', () => {
    expect(CONTENT_SECURITY_POLICY).toMatch(/default-src 'self'/);
    expect(CONTENT_SECURITY_POLICY).toMatch(/base-uri 'self'/);
    expect(CONTENT_SECURITY_POLICY).toMatch(/form-action 'self'/);
  });

  it('exposes exactly these five headers - no accidental extras, nothing silently dropped', () => {
    expect(SECURITY_HEADERS.map((h) => h.key).sort()).toEqual(
      [
        'Content-Security-Policy-Report-Only',
        'Permissions-Policy',
        'Referrer-Policy',
        'X-Content-Type-Options',
        'X-Frame-Options',
      ].sort(),
    );
  });
});
