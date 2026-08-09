# 01 — Product Requirements

## 1. Problem

HubSpot customers on Professional ($890/mo) and Enterprise ($3,600/mo) plans routinely
need CRM data in Excel and cannot get it cleanly. Documented failure modes:

- Dashboard reports export to PDF only; CSV/XLSX export of a dashboard report is not available.
- Emailed reports are row-limited and cannot attach a spreadsheet.
- Native CSV export breaks records: a line break inside a multi-line text field (Notes,
  Description) is read as a new row, silently turning one contact into four rows.
- Column headers are formatted for human reading, not machine processing, so the file
  cannot feed another system without manual cleanup.
- Column order configured in the report is not preserved in the export.
- Exports are manual and one-off. There is no scheduling.
- HubSpot's own product team has stated the dashboard-to-Excel export is not on the roadmap.

The existing workarounds are full BI connectors (Coefficient, Coupler.io, Supermetrics).
Their own reviewers say the pricing is disproportionate for a team that only needs
HubSpot exports.

## 2. Positioning

> One job, done correctly: your HubSpot data, in a correct Excel file, on a schedule.

We are not a BI tool. We do not visualise, blend sources, or model data. Every feature
request that starts with "could it also chart / also pull Google Ads / also write back"
is a no until further notice.

**Pricing anchor to state on the landing page:** the HubSpot reporting add-on is $200/month.

## 3. Ideal customer profile

| | |
|---|---|
| Primary | Marketing Ops / RevOps at a company on HubSpot Professional or Enterprise |
| Secondary | HubSpot solution partner agencies managing 5–40 client portals |
| Technical level | Non-technical. Comfortable in Excel. Will not write a script. |
| Buying authority | Can expense $29–79/month without approval |

The secondary segment matters more than its size suggests: one agency signing brings
many portals. Do not build agency features in the MVP, but do not make them impossible.

## 4. MVP scope — must ship in under 3 weeks

The MVP is the smallest thing a stranger will pay for.

- **A1** Connect a HubSpot portal via OAuth. HubSpot OAuth is also the login. No separate
  password auth.
- **A2** Create an Export definition: pick one object type from `contacts`, `companies`,
  `deals`, `tickets`; pick properties from that portal's live property list; order them.
- **A3** Optional filters: up to 5 conditions, AND only. Operators: `EQ`, `NEQ`, `GT`,
  `LT`, `BETWEEN`, `HAS_PROPERTY`, `NOT_HAS_PROPERTY`, `IN`.
- **A4** Optional single-level associations (e.g. deals → associated company name).
- **A4b** Selectable meta columns beyond `properties`: `id`, `createdAt`, `updatedAt`,
  and `url` (a direct link back to the HubSpot record — confirmed present in the payload,
  see `recon/FINDINGS.md` §5). Cheap to add, and exactly what a spreadsheet user wants.
- **A5** "Run now" → generates `.xlsx` → download link.
- **A6** Schedule: daily / weekly / monthly, with timezone, delivered by email.
- **A7** Stripe subscription: 14-day trial, then $29/month or $290/year.
- **A8** Export history: last 30 runs, status, row count, re-download.

## 5. Explicitly OUT of MVP

Write these down so the coding agent does not helpfully add them.

- Custom objects
- Multi-portal / agency workspaces
- Slack, Google Drive, Google Sheets, S3, FTP delivery
- CSV or JSON output (XLSX only)
- Charts, pivot tables, formulas in output
- Two-way sync or any write to HubSpot
- Data warehouse destinations
- Team seats, roles, permissions
- Marketing Hub analytics endpoints (sources, traffic, campaigns)
- Any AI feature whatsoever

## 6. V1 — only after 10 paying customers

Ordered by expected demand, to be re-ordered by what customers actually ask for:
multi-portal for agencies · Slack and Google Drive delivery · saved export templates ·
CSV and JSON output · second-level associations · custom objects · webhook on completion.

## 7. Success criteria

| Milestone | Target |
|---|---|
| Pre-sale validation | 3 paid founder subscriptions before the build starts |
| MVP shipped | ≤ 3 weeks from T0 |
| First non-founder paying customer | ≤ 6 weeks from T0 |
| 10 paying customers | ≤ 4 months |
| Export correctness | 0 row-splitting defects on a 50k-row portal with multi-line notes |

## 8. Kill criteria

Decide now, while unattached.

- Fewer than 3 pre-sales from 30 qualified contacts in 10 days → do not build.
- T0 reconnaissance shows required properties are unreachable on Professional plans → stop.
- HubSpot ships native scheduled XLSX export of dashboard reports → stop selling, pivot
  to the association-flattening and machine-header angle, which they will not cover.

## 9. Non-negotiable quality bar

The entire value proposition is that the file is correct. A single corrupted export
destroys the reason to pay. Correctness of output outranks every other consideration
including speed, UI polish, and feature count.
