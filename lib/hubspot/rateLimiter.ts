/**
 * Token bucket, one per HubSpot portal.
 *
 * Marketplace-distributed OAuth apps are capped at 110 requests / 10 seconds PER
 * INSTALLING ACCOUNT, and buying the API limit increase does not raise it
 * (specs/04-HUBSPOT-INTEGRATION.md §3).
 *
 * We configure 100/10s deliberately. That quota is the customer's, shared with every
 * other integration they run. Starving their Salesforce sync to speed up an export is
 * how we get uninstalled. The headroom is a product decision, not slack to optimise away.
 */
export interface RateLimiterOptions {
  capacity?: number;
  refillWindowMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_CAPACITY = 100;
const DEFAULT_WINDOW_MS = 10_000;

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Serialises waiters so N concurrent callers cannot all pass on the same token. */
  private queue: Promise<void> = Promise.resolve();

  constructor(opts: RateLimiterOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.windowMs = opts.refillWindowMs ?? DEFAULT_WINDOW_MS;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.tokens = this.capacity;
    this.lastRefill = this.now();
  }

  private refill(): void {
    const elapsed = this.now() - this.lastRefill;
    if (elapsed <= 0) return;
    const gained = (elapsed / this.windowMs) * this.capacity;
    if (gained >= 1) {
      this.tokens = Math.min(this.capacity, this.tokens + gained);
      this.lastRefill = this.now();
    }
  }

  /** Resolves when a token is available. Serialised: concurrent callers queue up. */
  async acquire(): Promise<void> {
    const mine = this.queue.then(async () => {
      for (;;) {
        this.refill();
        if (this.tokens >= 1) {
          this.tokens -= 1;
          return;
        }
        const perToken = this.windowMs / this.capacity;
        await this.sleep(Math.max(1, Math.ceil((1 - this.tokens) * perToken)));
      }
    });
    this.queue = mine.catch(() => undefined);
    return mine;
  }

  get available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}

const buckets = new Map<string, TokenBucket>();

/** One bucket per portal, shared across all requests in this process. */
export function bucketFor(portalId: string, opts?: RateLimiterOptions): TokenBucket {
  let b = buckets.get(portalId);
  if (!b) {
    b = new TokenBucket(opts);
    buckets.set(portalId, b);
  }
  return b;
}

export function resetBuckets(): void {
  buckets.clear();
}
