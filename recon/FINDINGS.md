# recon/FINDINGS.md — observed HubSpot behaviour

Portal 149063119 (EU, `app-eu1`), service key auth, probed 9 August 2026.
**This file outranks every spec.** If a spec contradicts it, the spec is wrong.

Status: checks 1-6 complete. Only check 7 (OAuth rate limit) remains — it needs the project app.

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

### The trap has a second half: a record's OWN id has no `referencedObjectType` at all

`referencedObjectType` only fires for a property that points at ANOTHER object. It says
nothing about `hs_object_id` — every object's own id, always present whether requested or
not (§10) — which HubSpot declares `number/number`, exactly like `associatedcompanyid`,
but with **no `referencedObjectType` flag to catch it**. Found the hard way: a portal
selecting `hs_object_id` as an export column got it silently `parseFloat`'d like any other
number — a 17-digit id (well past the 15-16 significant digits IEEE-754 doubles keep)
comes back as a *different* id, same corruption as above, just with no metadata guard
watching for it.

The fix (`lib/export/typeMap.ts`'s `looksLikeIdentifierName`) is a property-NAME check,
not a hardcoded `hs_object_id` special case: anything ending in `_id` or `_key` is forced
to text before the type/fieldType table ever runs, checked right after the
`referencedObjectType` check above. That catches `hs_object_id` and
`hs_unique_creation_key` on every object type, and any custom property a portal names
`whatever_id`, with no per-name list to maintain. It deliberately does **not** catch
`associatedcompanyid`/`associateddealid` themselves — those predate the `_id` naming
convention and have no underscore before "id" — which is exactly why the
`referencedObjectType` check above still has to exist and run first; the name check is an
addition to this trap, not a replacement for it.

**Anyone reading this section and only checking `referencedObjectType`, as the original
version of this note said, will reproduce this exact bug on the next id-shaped property
that doesn't happen to carry that flag.** Check both.

## 9. Multi-line values — CONFIRMED

The observation the entire product rests on. Property `message` (`string/textarea`),
three lines typed into the HubSpot UI:

```
escaped: "Première ligne\nDeuxième ligne\nTroisième ligne"
census:  CRLF=0   bare LF=2   bare CR=0
```

**HubSpot returns bare `\n` inside a property value.** In CSV that character terminates a
record — which is why one contact becomes three rows in HubSpot's own export. In an XLSX
cell it is legal. Preserve it, set `wrapText`, and the record stays one row.

`sanitizeCell` rule 3 still normalises `\r\n` and lone `\r`: not observed here, but the
values originate from browsers, pasted content and imports, so all three will appear in
customer data.

Other textarea/html properties on contacts, all system `hs_`:
`hs_chat_assistant_summary`, `hs_content_membership_notes`, `hs_cross_account_note`,
`hs_quarantined_emails`.

## 10. Three properties are always returned, requested or not

Requesting only the textarea/html properties still returned `createdate`, `hs_object_id`
and `lastmodifieddate` on every record.

**Consequence for `writer.ts`: never build columns by iterating `Object.keys(record.properties)`.**
Doing so adds three columns the user never selected and destroys the configured column
order. Iterate `ExportDefinition.properties` — the user's ordered array — and look each
name up in the payload. This is the concrete reason behind invariant 2.

## 11. Batch associations return **207**, not 200

```
POST /crm/v4/associations/deals/companies/batch/read  →  HTTP 207
{
  "status": "COMPLETE",
  "results": [],
  "errors": [{
    "status": "error",
    "category": "OBJECT_NOT_FOUND",
    "subCategory": "crm.associations.NO_ASSOCIATIONS_FOUND",
    "message": "No company is associated with deal 515690208449.",
    "context": { "fromObjectId": ["515690208449"], "fromObjectType": ["deal"],
                 "toObjectType": ["company"] }
  }],
  "numErrors": 1
}
```

**207 Multi-Status is a success.** Some inputs resolved, some did not. A client that treats
anything other than 200 as a failure will break every export containing a single record
without an association — which is most real exports.

Three requirements for T10:

1. Accept **200 and 207**. Only other statuses are failures.
2. **`results` does not align with `inputs`.** Records with no association are omitted from
   `results` entirely and listed in `errors`. Never zip the two arrays by index.
3. Build a `Map` keyed by `fromObjectId`; any input id absent from that map is `null`, and
   `null` means an empty cell, not a failed run.

The error entry carries `fromObjectId` in `context`, so a partial failure is fully
attributable. Parse `errors`, do not merely log it.

Note the endpoint is `/crm/v4/associations/...` — associations still use v4, not the
date-based versioning used by `/crm/objects/`. Two version schemes coexist.

## 12. Association success shape — two traps

```json
{
  "from": { "id": "515690208449" },
  "to": [
    { "toObjectId": 442222359747,
      "associationTypes": [
        { "category": "HUBSPOT_DEFINED", "typeId": 341, "label": null },
        { "category": "HUBSPOT_DEFINED", "typeId": 5, "label": "Primary" } ] },
    { "toObjectId": 442488735948,
      "associationTypes": [
        { "category": "HUBSPOT_DEFINED", "typeId": 341, "label": null } ] }
  ]
}
```

### Trap A — `from.id` is a string, `toObjectId` is a number

Same response, two types. `"515690208449"` quoted, `442222359747` not.

A `Map` keyed by one and looked up with the other never matches, and the failure is silent:
every association column comes out empty, no error, no exception. **Normalise with
`String()` on both sides of every key operation.**

Related hazard: `JSON.parse` turns `toObjectId` into a JS `Number`. Current HubSpot ids are
12 digits; `Number.MAX_SAFE_INTEGER` is 16. There is headroom, but the moment an id crosses
it the value is silently corrupted. Convert to string immediately on receipt and never do
arithmetic on an id.

### Trap B — "first" is not "primary"

`associationTypes` carries the answer: **`typeId: 5, label: "Primary"`** marks the primary
company. The second company has only the unlabelled `typeId: 341`.

Taking `to[0]` is guessing. Array order is not documented as stable, and the primary
association is the one the customer means when they write "Company" in a spreadsheet
header. In this payload `to[0]` happens to be primary — which is exactly how this bug
survives testing.

**`cardinality: "FIRST"` in the original spec is wrong. It becomes `"PRIMARY"`:** select the
entry whose `associationTypes` contains a type labelled `Primary`; if none is labelled,
fall back to `to[0]`.

Confirmed real: this portal already has 1 deal with 2 companies, from two clicks in the UI.
Multi-association is the normal case, not an edge case.

### And a third thing: associations return ids only

There are **no company names in this response.** Resolving `Company · Name` takes a second
call — `POST /crm/objects/2026-03/companies/batch/read` with the ids and the requested
properties.

T10 is therefore two batched calls per page, not one. Budget for it in the rate limiter:
an export with associations costs roughly double the API calls of one without.

## 13. Currency is per-record, not per-portal

`deals.amount` observed on the real portal:

```json
{
  "name": "amount", "type": "number", "fieldType": "number",
  "showCurrencySymbol": true,
  "currencyPropertyName": "deal_currency_code",
  "calculated": false, "hidden": false, "hubspotDefined": true
}
```

Two fields the original `PropertyDef` did not carry:

- **`showCurrencySymbol`** — the property is money, not a plain number. Without it,
  amounts export as bare numbers and the customer sees `1234.56` where they expect a
  currency-formatted cell.
- **`currencyPropertyName`** — names *another property* holding this record's currency
  code. Currency is therefore **per record**, not per portal: one export can contain a
  EUR deal and a USD deal, and a single hardcoded symbol would mislabel one of them.

### Consequences

1. Add both fields to `PropertyDef`.
2. When `showCurrencySymbol` is true, `numFmt` becomes `'#,##0.00'` rather than
   `'#,##0.###'`.
3. When `currencyPropertyName` is set, the fetcher (T9) must request that property
   alongside the amount, even if the user did not select it — otherwise the currency
   is unknowable at write time.
4. The header should name the currency, or an adjacent column should carry the code.
   **Do not embed a currency symbol in `numFmt`**: the format is per column, the
   currency is per row, so a column-level symbol is wrong the moment two currencies
   appear.

### Other useful flags on the same payload

| Field | Use |
|---|---|
| `hidden` | Hidden in the HubSpot UI. Candidate for the system-properties toggle alongside `hs_`. |
| `calculated` | Read-only computed. Exports normally; useful to mark in the picker. |
| `hubspotDefined` | Distinguishes stock properties from a customer's custom ones. |
| `description` | Free tooltip text for the property picker in T17. |

---

## Still to verify

| # | Check | Blocker |
|---|---|---|
| 4 | Multi-line fields return `\n` | **Seed the fixture contact.** The product depends on this. |
| 5 | Batch associations shape | No deals in the portal. Create one linked to a company. |
| 7 | Real rate limit | Service-key quota ≠ marketplace OAuth quota (110/10s). Re-measure under OAuth before T5. |
| — | Whether these traps also apply to companies / deals / tickets | Re-run the probe per object type. Do not assume the contacts inventory transfers. |
