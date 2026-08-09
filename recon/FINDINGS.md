# recon/FINDINGS.md — observed HubSpot behaviour

Portal 149063119 (EU, `app-eu1`), service key auth, probed 9 August 2026.
**This file outranks every spec.** If a spec contradicts it, the spec is wrong.

Status: checks 1, 2, 3, 6 complete. Checks 4, 5, 7 pending fixtures.

---

## 1. API path format — BOTH work

| Path | Result |
|---|---|
| `/crm/objects/2026-03/contacts` | 200 |
| `/crm/v3/objects/contacts` | 200 |

Date-based versioning is live and `v3` still answers. **Pin `HUBSPOT_API_VERSION=2026-03`**
— forward path, and `v3` will be deprecated first. One constant, never inlined.

## 2. Property volume — larger than assumed

On a portal containing **two sample contacts**:

| | Count |
|---|---|
| Total contact properties | **399** |
| `hs_` system properties | 315 (79%) |
| User-facing | 84 |

Consequences:

- Hiding `hs_` behind a toggle is not a nicety. Four out of five properties are noise.
- A real customer portal with custom properties will exceed 500. The picker in T17 must
  be searchable and virtualised, not a plain `<select>`.
- The `.max(200)` cap in `06-API-CONTRACT.md` is confirmed as necessary.

### RESOLVED — query string length

200 real property names produce a **5,116 character** query string. The GET list endpoint
returned **HTTP 200**. T9 can use the list endpoint; no need for `POST /search`.

Caveat: measured on a portal with **zero custom properties**. A customer with verbose
custom property names will exceed this. Build the fallback: if the assembled query string
exceeds ~7,000 characters, switch to `POST /search` with properties in the body. Ten lines,
and it prevents an incident at the one customer who has 200 long-named properties.

## 3. Values arrive as strings

```json
"associatedcompanyid": "442222359747"
```

A numeric field returned quoted. Treat **every** value in `properties` as `string | null`
and parse according to the property definition. `typeMap.ts` parses, it does not merely
format.

## 4. Empty values are `null`, never absent

25 properties requested, **0 absent from the response**. HubSpot returns the key with
`null` rather than omitting it.

`sanitizeCell` still handles absent keys defensively — cheap, and unverified on other
object types — but `null` is the observed case.

## 5. Records carry a `url` field

```json
"url": "https://app-eu1.hubspot.com/contacts/149063119/record/0-1/840926056668"
```

Outside `properties`, alongside `id`, `createdAt`, `updatedAt`, `archived`. Not in the
original spec. Offer it as a selectable column — a clickable link back to the record is
exactly what a marketing ops person wants in a spreadsheet, and it costs nothing.

## 6. Owners endpoint confirmed

```json
{ "id": "96879917", "email": "...", "type": "PERSON",
  "firstName": "Aymane", "lastName": "Ouirdani",
  "userId": 96879917, "archived": false }
```

`id` is a string, `userId` a number. Match `hubspot_owner_id` against **`id`**, not `userId`.

## 7. Complete type/fieldType inventory — contacts

Every combination present on this portal. `typeMap.ts` must cover all of them.

| type | fieldType | n | Handling |
|---|---|---|---|
| string | text | 111 | Text |
| string | textarea | 4 | Text, `wrapText` |
| string | phonenumber | 6 | Text — never numeric, leading zeros matter |
| string | html | 1 | **DECISION 1** |
| string | calculation_rollup / calculation_equation | 4 | Text |
| phone_number | phonenumber | 2 | Text |
| number | number | 65 | `parseFloat` → number |
| number | calculation_rollup / equation / score | 24 | `parseFloat` → number |
| datetime | date | **70** | parse → Date, `yyyy-mm-dd` |
| datetime | calculation_rollup / equation | 10 | parse → Date |
| date | date | 5 | parse → Date, `yyyy-mm-dd` |
| bool | booleancheckbox | 26 | `"true"`/`"false"` → boolean |
| bool | calculation_equation / calculation_read_time | 3 | → boolean |
| enumeration | select | 36 | internal → label |
| enumeration | checkbox | 13 | multi-select, `;` separated → labels joined `", "` |
| enumeration | radio | 8 | internal → label |
| enumeration | booleancheckbox | 7 | **DECISION 2** |
| enumeration | calculation_rollup | 3 | internal → label |
| object_coordinates | text | 2 | **DECISION 3** — text fallback |

### The rule this inventory establishes

**`type` decides the value semantics. `fieldType` only decides `wrapText` and multi-select
detection.**

70 properties are `datetime/date` — stored as a datetime, displayed as a date picker.
Keying on `fieldType` would treat them as dates and silently drop the time. Key on `type`.

### DECISION 1 — `string/html` — RESOLVED: strip tags

Only one property on this portal: `hs_chat_assistant_summary` (Chat Assistant: Summary),
a system `hs_` property hidden behind the toggle by default. Low stakes.

Strip tags to plain text. Keep the behaviour because a customer can create their own rich
text properties, but it is not a T8 priority.

### DECISION 2 — `enumeration/booleancheckbox`

Sample: `currentlyinworkflow`, options `true → True`, `false → False`. Consistent
enumeration handling yields the string `"True"`. Boolean handling yields `TRUE`.
**Recommendation: coerce to a real Excel boolean.** A column that filters and sorts as a
boolean is more useful than one that sorts alphabetically as text.

### DECISION 3 — `object_coordinates/text` — RESOLVED: text fallback, no special case

The two properties are `hs_notes_last_activity` (Last Activity) and
`hs_notes_next_activity` (Next Activity). Both are system `hs_` properties, and both are
internal pointers to engagement objects with no user-readable value.

The existing rule — unknown type → text, never throw — is sufficient.

## 8. `referencedObjectType` — the third trap

```
COMPANY  (1): associatedcompanyid          [number/number]
SEQUENCE (1): hs_latest_sequence_enrolled  [number/number]
OWNER    (1): hubspot_owner_id             [enumeration/select]
```

**A property that references another object is an identifier, and its declared `type` lies
about that.** Check `referencedObjectType` before the type/fieldType table — see
`05-EXPORT-ENGINE.md` §4.0.

- `hubspot_owner_id` is `enumeration/select` with an **empty** `options` array, because
  owners are dynamic. Enumeration handling emits the raw id `96879917`.
- `associatedcompanyid` is `number/number`. Numeric handling renders `442,222,359,747` —
  an identifier with thousands separators. And Excel keeps 15 significant digits: an id
  longer than that is silently rounded into a *different* id.

Identifiers are always text. Only OWNER is resolved, via the owners cache.

Note: `hubspot_owner_id` matches owner **`id`** (a string), not `userId` (a number).

---

## Still to verify

| # | Check | Blocker |
|---|---|---|
| 4 | Multi-line fields return `\n` | **Seed the fixture contact.** The product depends on this. |
| 5 | Batch associations shape | No deals in the portal. Create one linked to a company. |
| 7 | Real rate limit | Service-key quota ≠ marketplace OAuth quota (110/10s). Re-measure under OAuth before T5. |
| — | Whether these traps also apply to companies / deals / tickets | Re-run the probe per object type. Do not assume the contacts inventory transfers. |
