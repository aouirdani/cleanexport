# 06 — Internal API Contract

Next.js Route Handlers under `/app/api`. All responses JSON. All authenticated routes
resolve `portalId` from the session — **never** from a request parameter.

## Conventions

- Success: `200`/`201` with the resource. Errors: `{ "error": { "code": "...", "message": "..." } }`.
- `BigInt` values serialise as strings.
- Every handler validates its body with a Zod schema defined in `lib/schemas.ts`.
- Error codes are `SCREAMING_SNAKE`, defined once in `lib/errors.ts`, never inline strings.

## Auth

```
GET  /api/auth/hubspot/start        → 302 to HubSpot authorize URL, sets state cookie
GET  /api/auth/hubspot/callback     → exchanges code, upserts Portal + User, sets session, 302 /dashboard
POST /api/auth/logout               → clears session
GET  /api/auth/session              → { portal: { id, hubspotPortalId, name }, user: {...} } | 401
```

## Properties

```
GET  /api/properties/:objectType
     → { properties: [{ name, label, type, fieldType, options?, isSystem }] }
     Served from PropertyCache. Refetch if fetchedAt older than 24h.

POST /api/properties/:objectType/refresh
     → forces refetch, returns the same shape
```

`isSystem` is `true` when `name` starts with `hs_`. The UI hides these behind a toggle.

## Exports

```
GET    /api/exports                 → { exports: [...] }
POST   /api/exports                 → creates. Body: CreateExportSchema. Returns 201.
GET    /api/exports/:id             → single definition
PATCH  /api/exports/:id             → partial update
DELETE /api/exports/:id             → soft delete (isActive=false), cancels schedule
POST   /api/exports/:id/run         → 202 { runId }. Emits export.run.requested.
POST   /api/exports/:id/preview     → 200 { columns: [...], sampleRows: [...] }  (max 20 rows, no file)
```

`preview` is the highest-value endpoint for conversion. A user who sees 20 correct rows
before configuring a schedule converts far better than one who must wait for an email.
Build it in the MVP.

## Runs

```
GET /api/runs?exportId=&limit=30    → { runs: [...] }
GET /api/runs/:id                   → single run with status
GET /api/runs/:id/download          → 302 to a freshly signed R2 URL. 410 if expired.
```

## Billing

```
POST /api/billing/checkout          → { url }  Stripe Checkout session
POST /api/billing/portal            → { url }  Stripe Customer Portal
POST /api/webhooks/stripe           → Stripe webhook receiver
```

Webhook events to handle: `checkout.session.completed`,
`customer.subscription.updated`, `customer.subscription.deleted`,
`invoice.payment_failed`.

Verify the Stripe signature. A webhook route that does not verify signatures is an open
endpoint that lets anyone grant themselves a subscription.

## Zod schema — CreateExportSchema

```ts
z.object({
  name: z.string().min(1).max(120),
  objectType: z.enum(['CONTACTS', 'COMPANIES', 'DEALS', 'TICKETS']),
  properties: z.array(z.string()).min(1).max(200),   // order is meaningful
  headerStyle: z.enum(['LABEL', 'INTERNAL', 'BOTH']).default('LABEL'),
  filters: FiltersSchema.nullable().optional(),
  associations: AssociationsSchema.nullable().optional(),
  scheduleCron: z.string().nullable().optional(),
  scheduleTz: z.string().default('Europe/Paris'),
  recipients: z.array(z.string().email()).max(10).default([]),
})
```

Note `.max(200)` on properties: a user selecting 400 columns produces an unusable file and
a very slow export. Cap it and say why in the UI.

## Plan gating

Enforce in a single `assertWithinPlan(portalId, action)` helper, called by the handlers
that need it. Not scattered `if` statements.

| Limit | Trial / Solo |
|---|---|
| Export definitions | 10 |
| Scheduled exports | 5 |
| Runs per day | 20 |
| Rows per export | 250,000 |
