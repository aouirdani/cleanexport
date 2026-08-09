# 04 — HubSpot Integration

Everything in this file was verified against HubSpot documentation and HubSpot staff
statements in August 2026. Re-verify §1 and §3 before writing code; HubSpot changes.

## 1. The hard constraint that shapes the product

**There is no public API that returns the data of a HubSpot dashboard or custom report.**

HubSpot staff, answering this exact question on the HubSpot Community: the Reporting API
endpoints predate the current Custom Reporting tool and do not offer the ability to export
custom reports programmatically. The Analytics API mimics what the reporting tools show but
cannot return the exact data of a dashboard report, and this extends to custom reports.

### Consequence

CleanExport is a **query builder plus export engine**, not a report fetcher. The user
rebuilds their export inside our UI once. We then query the CRM object APIs directly.

This is not a weakness. It is why the problem still exists: nobody can trivially proxy
HubSpot's reports, so everyone has to build the query layer, and nobody has built a cheap
single-purpose one.

**How to say it on the landing page:** "Rebuild your report once. Get it every Monday,
correctly, forever." Never imply we import existing HubSpot reports. That promise would
generate refunds.

## 2. OAuth

Standard authorization code flow.

```
GET  https://app.hubspot.com/oauth/authorize
       ?client_id=...&redirect_uri=...&scope=...&state=...
POST https://api.hubapi.com/oauth/v1/token          (code → tokens)
POST https://api.hubapi.com/oauth/v1/token          (refresh_token → tokens)
GET  https://api.hubapi.com/oauth/v1/access-tokens/{token}   (introspect → portalId, user, scopes)
```

Access tokens are short-lived (treat as ~30 minutes; read `expires_in`, never hardcode).
Refresh tokens are long-lived but **can be revoked by the user at any time**.

### Scopes for the MVP

Request the minimum. Every extra scope lowers install conversion and slows marketplace review.

```
oauth
crm.objects.contacts.read
crm.objects.companies.read
crm.objects.deals.read
crm.objects.owners.read
tickets
crm.schemas.contacts.read
crm.schemas.companies.read
crm.schemas.deals.read
```

Do not request any `.write` scope. Ever. It is a trust argument you can make on the
landing page: this app can only read.

### Token refresh rules

- Refresh proactively on the hourly cron for anything expiring in under 2 hours.
- Refresh reactively on any `401`, then retry the request exactly once.
- On `400 invalid_grant` during refresh: the user revoked access. Set
  `Portal.disconnectedAt`, disable all schedules, email the user with a reconnect link.
  **Do not retry.** Retrying a revoked grant in a loop is how you get rate-limited by
  HubSpot as an application, which affects all your customers.

## 3. Rate limits — read carefully

For OAuth apps distributed via the HubSpot Marketplace, **each installing account is
limited to 110 requests every 10 seconds**. The CRM Search API is excluded from this and
has its own stricter limit. Purchasing the API limit increase does **not** raise the limit
for marketplace-distributed OAuth apps.

### Implementation requirements

1. A **token-bucket limiter keyed by `portalId`**, configured at 100 requests / 10s to
   leave headroom for the customer's other integrations. This is not optional — you are
   sharing the customer's quota with their other tools, and starving their Salesforce sync
   will get you uninstalled.
2. Respect `429` responses. Read the `Retry-After` header. Exponential backoff with jitter,
   maximum 5 attempts.
3. Prefer **batch reads** over the Search API where possible; Search has a lower limit and
   caps results at 10,000 records per query.
4. For full-object exports use the **list endpoint with pagination** (`limit=100`, follow
   `paging.next.after`), not Search.
5. Record `apiCallCount` on every `ExportRun`. When a customer complains about their quota,
   you need the number.

## 4. API versioning

HubSpot has moved from `v3` paths to **date-based versioning**, e.g.
`/crm/objects/2026-03/contacts` rather than `/crm/v3/contacts`. Each version has a defined
support window before deprecation.

- Pin the version in one constant, `HUBSPOT_API_VERSION`, used by every request.
- Do not scatter version strings through the codebase.
- Add a calendar reminder to check deprecation notices quarterly.

## 5. Endpoints used by the MVP

| Purpose | Endpoint |
|---|---|
| List properties for an object | `GET /crm/properties/{version}/{objectType}` |
| List records with properties | `GET /crm/objects/{version}/{objectType}?properties=a,b,c&limit=100&after=` |
| Filtered records | `POST /crm/objects/{version}/{objectType}/search` |
| Associations | `GET /crm/associations/{version}/{from}/{to}/batch/read` (POST batch) |
| Owners (to resolve owner IDs to names) | `GET /crm/owners/{version}/owners` |

## 6. Data quirks that must be handled

These are the defects that justify the product. Handling them is the product.

| Quirk | Required handling |
|---|---|
| Multi-line text fields contain `\n` and `\r\n` | Keep them inside a single cell. Never let a newline create a row. See `05-EXPORT-ENGINE.md` §3. |
| Owner fields return numeric IDs | Resolve to owner name + email via the owners endpoint, cached per run. |
| Enumeration fields return internal values (`closedwon`) | Map to labels from the property definition. Offer both via `headerStyle`. |
| Dates are ISO-8601 strings; datetimes are epoch millis on some properties | Convert to real Excel date values, not text. |
| Currency amounts are strings | Convert to numbers and apply a number format. |
| `hs_` prefixed system properties | Available but noisy. Do not show them by default; put them behind a "show system properties" toggle. |
| Deleted / archived records | Excluded by default. Do not add an option in the MVP. |
| Empty property values | Return empty cell, never the string `"null"` or `"undefined"`. |

## 7. Marketplace listing — do not block on it

You can distribute the app privately with OAuth from day one and sell directly. Marketplace
listing requires review and takes time. **Ship and sell first, list second.** Nothing in the
architecture changes; only the distribution setting on the app.
