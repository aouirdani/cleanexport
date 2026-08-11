/**
 * The HubSpot API client. One instance per portal per operation.
 *
 * Responsibilities, in order of how badly each fails when wrong:
 *   1. Refresh tokens before and after expiry, without ever retrying a revoked grant
 *   2. Rate limit per portal, respecting the customer's shared quota
 *   3. Back off on 429 and 5xx with jitter
 *   4. Count every call, for ExportRun.apiCallCount
 *
 * Ground truth: recon/FINDINGS.md. Never invent a payload shape.
 */
import { prisma } from '@/lib/db';
import { encrypt, decrypt } from '@/lib/crypto';
import { AppError, ErrorCode } from '@/lib/errors';
import { refreshAccessToken, expiresAtFrom, GrantRevokedError } from '@/lib/hubspot/oauth';
import { bucketFor, type TokenBucket } from '@/lib/hubspot/rateLimiter';

const BASE = 'https://api.hubapi.com';
const MAX_ATTEMPTS = 5;
/** Refresh anything expiring inside this window rather than waiting for a 401. */
const REFRESH_MARGIN_MS = 2 * 60 * 60 * 1000; // 2 hours

export interface PortalTokens {
  id: string;
  hubspotPortalId: bigint;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  tokenExpiresAt: Date;
}

export interface ClientOptions {
  bucket?: TokenBucket;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  fetchImpl?: typeof fetch;
  /** Test seam only. Production always persists through Prisma. */
  persist?: (portalId: string, data: { accessTokenEnc: string; tokenExpiresAt: Date }) => Promise<void>;
  onRevoked?: (portalId: string) => Promise<void>;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Statuses to accept beyond 2xx. Batch endpoints return 207 (FINDINGS §11). */
  acceptStatus?: number[];
}

export class HubSpotClient {
  private portal: PortalTokens;
  private accessToken: string;
  private readonly bucket: TokenBucket;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly doFetch: typeof fetch;
  private readonly persist: NonNullable<ClientOptions['persist']>;
  private readonly onRevoked?: (portalId: string) => Promise<void>;
  private refreshing: Promise<void> | null = null;

  /** Exposed for ExportRun.apiCallCount. */
  public callCount = 0;

  constructor(portal: PortalTokens, opts: ClientOptions = {}) {
    this.portal = portal;
    this.accessToken = decrypt(portal.accessTokenEnc);
    this.bucket = opts.bucket ?? bucketFor(portal.id);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
    this.doFetch = opts.fetchImpl ?? fetch;
    this.onRevoked = opts.onRevoked;
    this.persist =
      opts.persist ??
      (async (portalId, data) => {
        await prisma.portal.update({ where: { id: portalId }, data });
      });
  }

  static async forPortal(portalId: string, opts?: ClientOptions): Promise<HubSpotClient> {
    const portal = await prisma.portal.findUnique({
      where: { id: portalId },
      select: {
        id: true, hubspotPortalId: true,
        accessTokenEnc: true, refreshTokenEnc: true, tokenExpiresAt: true,
      },
    });
    if (!portal) throw new AppError(ErrorCode.NOT_FOUND, 'Portal not found', 404);
    return new HubSpotClient(portal, opts);
  }

  private get version(): string {
    return process.env.HUBSPOT_API_VERSION ?? '2026-03';
  }

  /** Single-flight: concurrent callers share one refresh instead of racing. */
  private async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;

    this.refreshing = (async () => {
      try {
        const tokens = await refreshAccessToken(decrypt(this.portal.refreshTokenEnc), this.doFetch);
        this.accessToken = tokens.access_token;
        const expiresAt = expiresAtFrom(tokens, this.now());
        const accessTokenEnc = encrypt(tokens.access_token);
        this.portal = { ...this.portal, accessTokenEnc, tokenExpiresAt: expiresAt };
        await this.persist(this.portal.id, { accessTokenEnc, tokenExpiresAt: expiresAt });
      } catch (err) {
        if (err instanceof GrantRevokedError) {
          // The user revoked access. Retrying gets the whole APPLICATION rate limited,
          // which affects every customer. Disable and stop.
          await this.onRevoked?.(this.portal.id);
        }
        throw err;
      } finally {
        this.refreshing = null;
      }
    })();

    return this.refreshing;
  }

  private async ensureFresh(): Promise<void> {
    if (this.portal.tokenExpiresAt.getTime() - this.now() < REFRESH_MARGIN_MS) {
      await this.refresh();
    }
  }

  /** Full jitter: random within the backoff window, so retries do not synchronise. */
  private backoffMs(attempt: number, retryAfter: string | null): number {
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
    }
    const ceiling = Math.min(1000 * 2 ** attempt, 30_000);
    return Math.floor(Math.random() * ceiling);
  }

  async request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
    await this.ensureFresh();

    const accept = new Set(opts.acceptStatus ?? []);
    let refreshedOn401 = false;
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await this.bucket.acquire();
      this.callCount++;

      let res: Response;
      try {
        res = await this.doFetch(`${BASE}${path}`, {
          method: opts.method ?? 'GET',
          headers: {
            authorization: `Bearer ${this.accessToken}`,
            'content-type': 'application/json',
          },
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        });
      } catch (err) {
        // Network failure: retry with backoff.
        lastError = err;
        await this.sleep(this.backoffMs(attempt, null));
        continue;
      }

      if (res.ok || accept.has(res.status)) {
        const text = await res.text();
        return (text ? JSON.parse(text) : null) as T;
      }

      if (res.status === 401 && !refreshedOn401) {
        // Exactly one reactive refresh, then one retry. Never a loop.
        refreshedOn401 = true;
        await this.refresh();
        continue;
      }

      if (res.status === 429 || res.status >= 500) {
        lastError = new AppError(
          res.status === 429 ? ErrorCode.RATE_LIMITED : ErrorCode.HUBSPOT_ERROR,
          `HubSpot returned ${res.status}`,
          res.status,
        );
        await this.sleep(this.backoffMs(attempt, res.headers.get('retry-after')));
        continue;
      }

      // 4xx other than 401/429: deterministic, retrying changes nothing.
      const body = await res.text().catch(() => '');
      throw new AppError(
        ErrorCode.HUBSPOT_ERROR,
        `HubSpot returned ${res.status}: ${body.slice(0, 300)}`,
        res.status,
      );
    }

    if (lastError instanceof AppError) throw lastError;
    throw new AppError(ErrorCode.HUBSPOT_ERROR, `HubSpot request failed after ${MAX_ATTEMPTS} attempts`, 502);
  }

  /* ---------- typed helpers ---------- */

  properties<T = unknown>(objectType: string): Promise<T> {
    return this.request<T>(`/crm/properties/${this.version}/${objectType}`);
  }

  listObjects<T = unknown>(objectType: string, params: Record<string, string>): Promise<T> {
    const qs = new URLSearchParams(params).toString();
    return this.request<T>(`/crm/objects/${this.version}/${objectType}?${qs}`);
  }

  searchObjects<T = unknown>(objectType: string, body: unknown): Promise<T> {
    return this.request<T>(`/crm/objects/${this.version}/${objectType}/search`, { method: 'POST', body });
  }

  batchReadObjects<T = unknown>(objectType: string, body: unknown): Promise<T> {
    return this.request<T>(`/crm/objects/${this.version}/${objectType}/batch/read`, {
      method: 'POST', body, acceptStatus: [207],
    });
  }

  /** Associations stay on /crm/v4/ — objects use date versioning. Two schemes coexist. */
  batchReadAssociations<T = unknown>(from: string, to: string, inputs: { id: string }[]): Promise<T> {
    return this.request<T>(`/crm/v4/associations/${from}/${to}/batch/read`, {
      method: 'POST', body: { inputs }, acceptStatus: [207],
    });
  }

  owners<T = unknown>(): Promise<T> {
    return this.request<T>('/crm/v3/owners?limit=100');
  }
}
