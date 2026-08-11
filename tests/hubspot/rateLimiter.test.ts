import { describe, it, expect, beforeEach } from 'vitest';
import { TokenBucket, bucketFor, resetBuckets } from '@/lib/hubspot/rateLimiter';

/** Deterministic clock: no real timers, no flaky timing assertions. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => { t += ms; },
    advance: (ms: number) => { t += ms; },
  };
}

beforeEach(() => resetBuckets());

describe('TokenBucket', () => {
  it('allows up to capacity immediately', async () => {
    const c = fakeClock();
    const b = new TokenBucket({ capacity: 5, refillWindowMs: 1000, now: c.now, sleep: c.sleep });
    for (let i = 0; i < 5; i++) await b.acquire();
    expect(c.now()).toBe(0); // no waiting yet
  });

  it('waits once the bucket is empty', async () => {
    const c = fakeClock();
    const b = new TokenBucket({ capacity: 5, refillWindowMs: 1000, now: c.now, sleep: c.sleep });
    for (let i = 0; i < 5; i++) await b.acquire();
    await b.acquire();
    expect(c.now()).toBeGreaterThan(0);
  });

  it('refills over time', async () => {
    const c = fakeClock();
    const b = new TokenBucket({ capacity: 10, refillWindowMs: 1000, now: c.now, sleep: c.sleep });
    for (let i = 0; i < 10; i++) await b.acquire();
    expect(b.available).toBe(0);
    c.advance(500);
    expect(b.available).toBe(5);
    c.advance(500);
    expect(b.available).toBe(10);
  });

  it('never exceeds capacity when idle', () => {
    const c = fakeClock();
    const b = new TokenBucket({ capacity: 10, refillWindowMs: 1000, now: c.now, sleep: c.sleep });
    c.advance(100_000);
    expect(b.available).toBe(10);
  });

  it('serialises concurrent acquires — no double-spend', async () => {
    const c = fakeClock();
    const b = new TokenBucket({ capacity: 3, refillWindowMs: 1000, now: c.now, sleep: c.sleep });
    await Promise.all(Array.from({ length: 3 }, () => b.acquire()));
    expect(b.available).toBe(0);
    // A 4th concurrent caller must have waited.
    await b.acquire();
    expect(c.now()).toBeGreaterThan(0);
  });

  it('defaults to 100 per 10s — headroom under HubSpot 110/10s', () => {
    const b = new TokenBucket();
    expect(b.available).toBe(100);
  });
});

describe('bucketFor', () => {
  it('returns the same bucket for one portal', () => {
    expect(bucketFor('p1')).toBe(bucketFor('p1'));
  });
  it('isolates portals from each other', async () => {
    const c = fakeClock();
    const a = bucketFor('pa', { capacity: 2, refillWindowMs: 1000, now: c.now, sleep: c.sleep });
    const b = bucketFor('pb', { capacity: 2, refillWindowMs: 1000, now: c.now, sleep: c.sleep });
    await a.acquire(); await a.acquire();
    expect(a.available).toBe(0);
    expect(b.available).toBe(2);
  });
});
