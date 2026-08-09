# 07 — Build Backlog

Ordered. Each task is sized to be one session with one coding agent. Do not batch them.
Do not reorder — the ordering front-loads the risk.

Mark each `[ ]` → `[x]` as you go, and commit after each task.

---

## Phase 0 — De-risk before writing product code

### [ ] T0 — API reconnaissance (half a day, do not skip)

Create a free HubSpot developer account and a test portal. Write a throwaway Node script,
not part of the repo, that:

1. Completes the OAuth flow manually and prints the tokens.
2. Fetches the property list for `contacts` and prints how many exist.
3. Fetches 100 contacts with 20 properties and prints the raw JSON of one record.
4. Fetches a contact whose Notes field you filled with three line breaks. **Look at the
   raw string.** Confirm it contains `\n`.
5. Fetches deal→company associations via the batch endpoint.
6. Deliberately fires 200 requests in 10 seconds and confirms you receive `429` with a
   `Retry-After` header.

**Exit criterion:** you have seen, with your own eyes, the raw shape of every payload the
export engine will consume. If any step fails or a payload differs from
`04-HUBSPOT-INTEGRATION.md`, update that file before continuing.

This task exists because every downstream task assumes payload shapes. An error here
propagates into everything.

---

## Phase 1 — Skeleton

### [ ] T1 — Project init
`create-next-app` with TypeScript, App Router, Tailwind. Add shadcn/ui. Add Prisma.
Add Zod, ExcelJS, Inngest, Stripe SDK, Resend SDK. Configure ESLint and Prettier.
Commit a working `pnpm dev`.

### [ ] T2 — Database schema
Paste the Prisma schema from `03-DATA-MODEL.md` verbatim. Run the migration.
Write a seed script creating one fake Portal and one ExportDefinition.
**Do not let the agent redesign the schema.** If it proposes changes, reject them.

### [ ] T3 — Encryption helpers
`lib/crypto.ts` exporting `encrypt(plain: string): string` and `decrypt(cipher: string): string`
using AES-256-GCM, key from `ENCRYPTION_KEY` (32 bytes, base64). Output format
`v1:<iv>:<authTag>:<ciphertext>`, all base64. Unit tests: round-trip, tampered ciphertext
throws, wrong key throws.
*Write this one with a strong model or by hand.*

---

## Phase 2 — HubSpot connection

### [ ] T4 — OAuth start and callback
Both routes from `06-API-CONTRACT.md`. State cookie, CSRF check, token exchange,
introspection call, `Portal` + `User` upsert, encrypted token storage, session cookie
(iron-session or equivalent), redirect to `/dashboard`.
*Strong model.*

### [ ] T5 — HubSpot API client
`lib/hubspot/client.ts`. A single class holding: pinned API version constant, per-portal
token-bucket rate limiter at 100 req/10s, automatic token refresh on 401 with exactly one
retry, `429` handling with `Retry-After` and jittered exponential backoff (max 5 attempts),
and an API call counter exposed for `ExportRun.apiCallCount`.
*Strong model. This is the second most bug-prone file in the project.*

### [ ] T6 — Property fetching and cache
`GET /api/properties/:objectType` + refresh route + `PropertyCache` read-through.
Compute `isSystem` from the `hs_` prefix.

---

## Phase 3 — The engine

### [ ] T7 — Cell sanitiser
`lib/export/sanitize.ts`. Implement §3 of `05-EXPORT-ENGINE.md` exactly, as a pure
function. **Write the tests first**, one per rule, plus the ten fixtures in §10 that apply.
This is a self-contained, well-specified, pure function — ideal for a local model, provided
you give it the tests.

### [ ] T8 — Type mapper
`lib/export/typeMap.ts`. Given a property definition and a raw value, return
`{ value, numFmt?, wrapText? }` per §4. Pure function, table-driven, unknown types fall
back to text. Tests for every row of the table.
*Good local-model task.*

### [ ] T9 — Record fetcher
`lib/export/fetch.ts`. Async generator yielding pages of 100 records. Uses list endpoint
when no filters, Search endpoint when filters exist. Handles pagination. **Throws
explicitly if a filtered query hits the 10,000 cap** — never truncates silently.

### [ ] T10 — Association resolver
`lib/export/associations.ts`. Batch reads, 100 IDs per call, `FIRST` cardinality only.
Returns a `Map<recordId, associatedRecord>`.

### [ ] T11 — XLSX writer
`lib/export/writer.ts`. ExcelJS `WorkbookWriter`, streaming, header styling per §5,
column widths, freeze pane, autofilter. Consumes the fetcher generator, applies sanitiser
and type mapper, writes row by row to a temp file. Returns the path and row count.

### [ ] T12 — Engine integration test
Run T7–T11 end to end against the T0 test portal. Verify all ten fixtures from §10 of
`05-EXPORT-ENGINE.md`. **Open the file in real Excel.** Not a library, not a preview —
Excel. Half the defects only appear there.

---

## Phase 4 — Orchestration

### [ ] T13 — Inngest setup and the three functions
`export.run.requested` as discrete steps per `02-ARCHITECTURE.md` §4,
`export.schedule.tick` cron, `hubspot.token.refresh` cron.

### [ ] T14 — R2 upload and signed URLs
Upload the temp file, non-guessable key, 7-day signed URL generation, `/api/runs/:id/download`.

### [ ] T15 — Email delivery
Resend. Success template with attachment under 8 MB, link above. Failure template naming
the error in plain language. Reconnect template for `TOKEN_REVOKED`.

---

## Phase 5 — Interface

### [ ] T16 — Dashboard shell
Nav, portal name, connection status, empty state that says exactly what to do next.

### [ ] T17 — Export builder
Object type picker → searchable property list with **drag-to-reorder** on selected
properties → header style radio → filters → associations → schedule → recipients.
The reorder control is a differentiator; make it obvious.

### [ ] T18 — Preview
`POST /api/exports/:id/preview` and the table that renders 20 rows.
Ship this before the schedule UI. It is what converts.

### [ ] T19 — Run history
Table of last 30 runs, status badge, row count, re-download, error message shown in full.

---

## Phase 6 — Money

### [ ] T20 — Stripe
Checkout, Customer Portal, webhook with signature verification, `Subscription` sync,
`assertWithinPlan` helper, trial countdown banner.

### [ ] T21 — Landing page
Above the fold: the problem in one sentence, the $200/month anchor, a screenshot of a
correct export next to a broken HubSpot CSV, and a single CTA. No feature grid.

---

## Phase 7 — Ship

### [ ] T22 — Sentry, structured logging, health endpoint
Assert in a test that no log line and no API response ever contains a decrypted token.

### [ ] T23 — Onboard the 3 pre-sale customers by hand
Do it manually, over a call, watching them use it. Every friction point you see is a
task. This is not support work, it is product research you cannot buy.

---

## Suggested pacing

| Days | Phases |
|---|---|
| 1 | T0 |
| 2–3 | T1–T6 |
| 4–7 | T7–T12 |
| 8–10 | T13–T15 |
| 11–14 | T16–T19 |
| 15–17 | T20–T22 |
| 18+ | T23, then iterate on what customers actually say |

Three weeks assumes real focus. If you slip, cut Phase 5 features — never Phase 3 quality.
