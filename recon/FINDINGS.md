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

### OPEN — query string length

The list endpoint takes properties as a comma-separated **query parameter**. 200 property
names at ~25 chars each is a >5,000 character URL. Untested. Verify before T9:

```bash
export $(grep -v '^#' .env | xargs)
P=$(node -e 'console.log(Array.from({length:200},(_,i)=>"hs_test_property_name_"+i).join(","))')
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://api.hubapi.com/crm/objects/2026-03/contacts?limit=1&properties=$P" \
  -H "Authorization: Bearer $HUBSPOT_PRIVATE_APP_TOKEN"
```

If this returns 414 or 400, T9 must use `POST /search` (properties in the body) instead of
the GET list endpoint whenever the column count is high.

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

### DECISION 1 — `string/html`

An HTML property lands in a cell as raw markup: `<p>Hello <b>world</b></p>`. Options:
strip tags to plain text (readable, lossy), or keep raw (faithful, ugly). **Recommendation:
strip tags, and note it in the UI.** A marketing ops person pasting into Excel wants the
text. Revisit only if a customer asks.

### DECISION 2 — `enumeration/booleancheckbox`

Sample: `currentlyinworkflow`, options `true → True`, `false → False`. Consistent
enumeration handling yields the string `"True"`. Boolean handling yields `TRUE`.
**Recommendation: coerce to a real Excel boolean.** A column that filters and sorts as a
boolean is more useful than one that sorts alphabetically as text.

### DECISION 3 — `object_coordinates/text`

Not in the original spec's table. The fallback-to-text rule already covers it and must
never throw. Inspect the two properties in `sample-records.json` before deciding whether
it deserves special handling.

---

## Still to verify

| # | Check | Blocker |
|---|---|---|
| 4 | Multi-line fields return `\n` | **Seed the fixture contact.** The product depends on this. |
| 5 | Batch associations shape | No deals in the portal. Create one linked to a company. |
| 7 | Real rate limit | Service-key quota ≠ marketplace OAuth quota (110/10s). Re-measure under OAuth before T5. |
| — | Query string length at 200 properties | Command in §2 above. |
