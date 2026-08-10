# 05 — Export Engine

This file is the product. Everything else is packaging.

The customer is paying because HubSpot's own export is wrong. If ours is also wrong, we
have no business. Implement this file literally.

## 1. Contract

Given an `ExportDefinition` and a portal token, produce an `.xlsx` where:

1. One CRM record produces **exactly one row**. Always. Regardless of content.
2. Columns appear in the exact order the user configured. No sorting, ever.
3. Dates are Excel date values. Numbers are Excel numbers. Text is text.
4. No cell contains `null`, `undefined`, `NaN`, or `[object Object]`.
5. The file opens in Excel, LibreOffice, and Google Sheets without a repair prompt.

## 2. Generation approach

Use **ExcelJS `WorkbookWriter`** (streaming), not the in-memory `Workbook`.

```
const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename, useStyles: true });
const sheet = workbook.addWorksheet('Export');
// ... row by row ...
await workbook.commit();
```

Rationale: a 100k-row export built in memory will exhaust the process. Stream rows to disk,
then upload the file. Never hold the full dataset in an array.

**Fetch and write concurrently is out of scope for the MVP.** Fetch a page of 100, write
100 rows, discard, next page. Simple and correct beats fast.

## 3. Cell sanitisation rules — the core defect fix

Apply in this exact order to every value before writing:

```
1. null | undefined            → empty cell (not the string "")
2. Strip control characters     → remove U+0000–U+0008, U+000B, U+000C, U+000E–U+001F
                                  KEEP U+0009 (tab), U+000A (LF)
3. Normalise line endings       → replace \r\n and \r with \n
4. Leading = + - @              → prefix with a single quote (formula-injection defence)
5. Length > 32767               → truncate to 32760 and append " […]"
6. Type coercion                → see §4
```

Rule 3 is the entire reason the customer is paying. HubSpot's CSV export lets a line break
inside a Notes field split one record into several rows. In XLSX a newline inside a cell is
legal and safe. Preserve it, set `alignment: { wrapText: true }` on the column, and the
record stays one row.

Rule 4 matters: a HubSpot text field beginning with `=` becomes a live formula in Excel.
That is a CSV/XLSX injection vector and a support ticket waiting to happen.

Rule 5: Excel's hard cell limit is 32,767 characters. Exceeding it corrupts the file.

## 4. Type mapping

### 4.0 Dispatch order — identifiers first

Check `referencedObjectType` **before** consulting the type/fieldType table. A property
that references another object is an identifier, and its declared `type` is misleading.

```
if (def.referencedObjectType) {
  if (def.referencedObjectType === 'OWNER') -> resolve via owners cache
  else                                      -> TEXT, unresolved
} else {
  -> type/fieldType table below
}
```

Observed on contacts (`recon/FINDINGS.md` §8):

| Property | Declared | References | Correct handling |
|---|---|---|---|
| `hubspot_owner_id` | `enumeration/select` | OWNER | Resolve to `"Firstname Lastname"` |
| `associatedcompanyid` | `number/number` | COMPANY | **Text.** Not a number |
| `hs_latest_sequence_enrolled` | `number/number` | SEQUENCE | **Text.** Not a number |

Two failure modes this prevents, neither of which any spec-derived unit test would catch:

1. `hubspot_owner_id` is declared `enumeration/select`, but its `options` array is empty —
   owners are dynamic. Naive enumeration handling emits the raw id `96879917` into the
   "Owner" column. The customer receives a spreadsheet of meaningless numbers.
2. `associatedcompanyid` is declared `number/number`. Numeric handling applies
   `numFmt '#,##0.###'` and renders `442,222,359,747`. An identifier with thousands
   separators is nonsense — **and Excel stores numbers as IEEE-754 doubles, keeping only
   15 significant digits.** An id longer than that is silently rounded and becomes a
   different id. Identifiers are always text.

`associatedcompanyid` returns only an id. To give the customer the company *name*, they use
the associations feature (§7), which is exactly what it exists for. Say so in the UI when
they select a referencing property, rather than letting them export a column of numbers.


**`type` decides the value semantics. `fieldType` only decides `wrapText` and multi-select
detection.** Keying on `fieldType` is the trap: 70 contact properties are `datetime/date`
— stored as a datetime, shown as a date picker. Treating them as dates silently drops the
time.

Every value arrives from HubSpot as `string | null`, including numbers. This function
**parses**, it does not merely format.

The table below is the complete inventory observed on a real portal
(`recon/FINDINGS.md` §7). It is exhaustive for contacts; re-run the probe for other
object types before assuming it transfers.

| type | fieldType | Excel output |
|---|---|---|
| `string` | `text` | Text |
| `string` | `textarea` | Text, `wrapText: true` |
| `string` | `phonenumber` | Text. **Never numeric** — leading zeros and `+` matter |
| `string` | `html` | Strip tags to plain text (see FINDINGS decision 1) |
| `string` | `calculation_*` | Text |
| `phone_number` | `phonenumber` | Text |
| `number` | `number` | `parseFloat` → number, `numFmt '#,##0.###'` |
| `number` | `calculation_*` | `parseFloat` → number |
| `number` + `showCurrencySymbol` | any | number, `numFmt '#,##0.00'`, currency in the header |
| `datetime` | `date` or `calculation_*` | parse → `Date`, `numFmt 'yyyy-mm-dd hh:mm'`, converted to the export timezone |
| `date` | `date` | parse → `Date`, `numFmt 'yyyy-mm-dd'` |
| `bool` | `booleancheckbox`, `calculation_*` | `"true"`/`"false"` → real boolean |
| `enumeration` | `select`, `radio`, `calculation_rollup` | internal value → label from `options`. If `options` is empty and `referencedObjectType` is set, §4.0 already handled it |
| `enumeration` | `checkbox` | multi-select, `;`-separated → each mapped to label, joined `", "` |
| `enumeration` | `booleancheckbox` | → real boolean (see FINDINGS decision 2) |
| `object_coordinates` | `text` | Text fallback |
| anything else | anything | Text. **Never throw.** |

`calculation_*` covers `calculation_rollup`, `calculation_equation`, `calculation_score`,
and `calculation_read_time`. These are read-only computed properties; they export normally.

Unknown or unmapped type → text. A new HubSpot property type must never break an export.

## 5. Header rows

Driven by `ExportDefinition.headerStyle`.

- `LABEL` — row 1 contains property labels ("First Name"). Data from row 2.
- `INTERNAL` — row 1 contains internal names ("firstname"). Data from row 2.
- `BOTH` — row 1 labels, row 2 internal names, data from row 3.

Header row formatting: bold, white text on `FF2E3B4E`, frozen pane at the first data row,
autofilter across the used range. Column width = `min(max(headerLength, 12), 50)`.

`BOTH` is the option that wins the "headers formatted for humans break my automation"
complaint. Make it visible in the UI, not buried.

## 6. Filter JSON shape

```json
{
  "operator": "AND",
  "conditions": [
    { "property": "createdate", "operator": "BETWEEN", "value": "2026-01-01", "highValue": "2026-03-31" },
    { "property": "hs_lead_status", "operator": "IN", "values": ["NEW", "OPEN"] },
    { "property": "email", "operator": "HAS_PROPERTY" }
  ]
}
```

Maximum 5 conditions, `AND` only, in the MVP. Maps directly to HubSpot Search
`filterGroups[0].filters`. If a filter is present the engine uses the Search endpoint and
must handle its 10,000-record cap: if the result count reaches 10,000, split the query by
date range and merge, or fail loudly with a clear message. **Do not silently truncate.**
Silent truncation is the one failure mode that destroys trust permanently.

## 7. Association JSON shape

```json
{
  "toObjectType": "COMPANIES",
  "columns": ["name", "domain"],
  "cardinality": "PRIMARY"
}
```

- `cardinality: "PRIMARY"` — MVP behaviour. One column per requested property, taken from
  the **primary** associated record. See `recon/FINDINGS.md` §12: primary is identified by
  an entry in `associationTypes` labelled `Primary` (`typeId: 5` for deal→company), **not**
  by array position. Fall back to `to[0]` only when nothing is labelled.
- `cardinality: "JOIN"` — values from all associated records joined with `"; "` in one
  cell. Ship only if a customer asks.

Association columns are appended after the primary object's columns, with headers prefixed
by the object name: `Company · Name`, `Company · Domain`.

### Resolution is two calls, not one

1. `POST /crm/v4/associations/{from}/{to}/batch/read` — returns **ids only**, 100 inputs
   per call. Accept HTTP **200 and 207**; 207 is multi-status, not failure. Records with no
   association are absent from `results` and listed in `errors` — never zip the arrays by
   index. Build a `Map` keyed by `String(from.id)`; a missing id means an empty cell.
2. `POST /crm/objects/{version}/{toObjectType}/batch/read` — fetch the requested properties
   for the selected ids.

Note the version mismatch: associations are on `/crm/v4/`, objects on date-based
versioning. Two schemes coexist; do not unify them.

**`String()` every id on both sides.** `from.id` arrives as a string, `toObjectId` as a
number. A `Map` keyed by one and read with the other silently yields empty columns.

One call per row on a 50k export is 50,000 calls and a guaranteed rate-limit incident.
Batch, always.

## 8. Failure handling

| Situation | Behaviour |
|---|---|
| Token revoked mid-run | Fail run, `errorCode: TOKEN_REVOKED`, disable schedules, email reconnect link |
| Rate limited | Back off and retry within the step, up to 5 attempts, then fail with `RATE_LIMITED` |
| Property no longer exists in portal | Skip that column, complete the run, list skipped columns in the email |
| Zero rows matched | Still produce the file with headers only. Email says "0 records matched". Never send an empty attachment silently. |
| Run exceeds 30 minutes | Fail with `TIMEOUT`. Suggest adding a filter. |

Every failure sends an email to the export's recipients. A scheduled export that fails
silently is worse than no scheduled export, because the customer builds a Monday meeting
around a file that never arrives.

## 9. Delivery

- File ≤ 8 MB → attach to the email **and** include the download link.
- File > 8 MB → link only, with the size stated in the email body.
- Signed URL TTL: 7 days.
- Filename: `{export-name}_{YYYY-MM-DD}.xlsx`, slugified, no spaces.

## 10. Mandatory test fixtures

Do not consider the engine done until these pass. Build the fixture portal by hand in a
free HubSpot developer account.

1. A contact whose `notes_last_contacted` contains three line breaks → produces one row.
2. A contact whose first name is `=SUM(1,1)` → cell displays the literal text.
3. A deal with `amount = 1234.56` → numeric cell, right-aligned, not text.
4. A deal with `closedate` set → real Excel date, sortable as a date.
5. A contact with an empty `phone` → empty cell, not `"null"`.
6. A multi-select enumeration with 3 values → labels joined with `", "` in one cell.
7. An export of 25,000+ records → completes, memory stays flat, one row per record.
8. A property containing 40,000 characters → truncated cleanly, file opens without repair.
9. A deal with 3 associated companies, `cardinality: FIRST` → one company's data.
10. An export whose configured column order is reverse-alphabetical → order preserved.
