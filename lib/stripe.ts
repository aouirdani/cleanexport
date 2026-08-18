/**
 * Stripe client and billing config - specs/07-TASKS.md T20;
 * specs/01-PRD.md A7: "14-day trial, then $29/month or $290/year."
 *
 * Env vars: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID_MONTHLY,
 * STRIPE_PRICE_ID_YEARLY, APP_URL (already used by inngest/email.ts's
 * buildReconnectUrl - same variable, same default).
 */
import Stripe from 'stripe';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

let cachedClient: Stripe | undefined;

/** Lazily constructed so importing this module never requires a live key (tests set env vars per-case). */
export function stripeClient(): Stripe {
  if (!cachedClient) cachedClient = new Stripe(requireEnv('STRIPE_SECRET_KEY'));
  return cachedClient;
}

export function stripeWebhookSecret(): string {
  return requireEnv('STRIPE_WEBHOOK_SECRET');
}

export function appUrl(): string {
  return process.env.APP_URL ?? 'http://localhost:3000';
}

/** specs/01-PRD.md A7. */
export const TRIAL_PERIOD_DAYS = 14;

export type BillingPlan = 'monthly' | 'yearly';

export function priceIdFor(plan: BillingPlan): string {
  return plan === 'monthly' ? requireEnv('STRIPE_PRICE_ID_MONTHLY') : requireEnv('STRIPE_PRICE_ID_YEARLY');
}
