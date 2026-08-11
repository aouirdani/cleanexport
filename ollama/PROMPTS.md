# Prompts for the local agent

A 27B model does not infer intent. It executes instructions. The difference between a good
and a useless session is entirely in how the task is framed.

## The template

Every task prompt has the same six blocks, in this order. Do not skip blocks — the order
matters because the model weights the beginning and end of the prompt most heavily.

```
ROLE
You are implementing one task in an existing TypeScript codebase.

CONTEXT
<which spec section is authoritative, one line>

TASK
<one sentence. one file. one behaviour.>

INPUT
<exact function signature, exact types, exact file path>

ACCEPTANCE
<a numbered list of checkable conditions>

FORBIDDEN
<explicit list of what not to touch>
```

Three habits that matter more than the wording:

- **One file per session.** Two files doubles the failure rate, it does not add 10%.
- **Give the signature, never ask for a design.** "Write a function that sanitises values"
  produces garbage. "Implement `sanitizeCell(raw: unknown, def: PropertyDef): CellValue`"
  produces code.
- **Acceptance criteria must be checkable by a test.** If you cannot write the test, the
  model cannot write the code.

---

## T2 — Prisma schema

```
aider --model ollama_chat/cleanexport-dev \
      --read CONVENTIONS.md \
      --read specs/03-DATA-MODEL.md \
      --read .agents/skills/prisma-upgrade-v7/references/schema-changes.md \
      prisma/schema.prisma
```

That third `--read` is the point. The project runs **Prisma 7**, whose syntax post-dates
the model's training data — it will confidently write `provider = "prisma-client-js"` and
put `url` in the datasource block, both of which are wrong now. The reference file is
version-exact ground truth sitting on your disk. Same principle as `recon/FINDINGS.md`.

```
ROLE
You are transcribing a database schema into a Prisma 7 schema file.

CONTEXT
specs/03-DATA-MODEL.md contains the complete schema and is authoritative.
This project uses Prisma 7. Its syntax differs from Prisma 6 and from your training data.
.agents/skills/prisma-upgrade-v7/references/schema-changes.md documents the differences.

TASK
Write prisma/schema.prisma from the schema block in specs/03-DATA-MODEL.md, exactly.

ACCEPTANCE
1. generator block uses provider = "prisma-client" and includes the required output field.
2. datasource block declares provider only. NO url, directUrl or shadowDatabaseUrl —
   those live in prisma.config.ts in v7.
3. No engineType field anywhere. It was removed in v7.
4. Six models: Portal, User, ExportDefinition, ExportRun, Subscription, PropertyCache.
5. Five enums: ObjectType, HeaderStyle, RunStatus, Trigger, SubStatus.
6. hubspotPortalId is BigInt, not Int.
7. Every @@index and @@unique from the spec is present.
8. `pnpm exec prisma validate` passes.

FORBIDDEN
Do not add models. Do not add fields. Do not rename anything. Do not "improve" the schema.
Do not write provider = "prisma-client-js" — it is deprecated and wrong for this project.
This is transcription, not design. If something looks wrong, list it under UNSURE and
transcribe it anyway.
```

Verify yourself, before moving on:

```bash
pnpm exec prisma validate && pnpm exec prisma generate
```

Generation is the real test. `validate` passes on a schema whose generator block is subtly
wrong; `generate` does not.

## T7 — Cell sanitiser (the one that matters)

Run this in two sessions. Tests first, then implementation. Read the tests yourself in
between — that review is where you catch the model misreading the spec.

### Session A — tests

```
aider --model ollama_chat/cleanexport-dev \
      --read CONVENTIONS.md --read specs/05-EXPORT-ENGINE.md \
      tests/export/sanitize.test.ts
```

```
ROLE
You are writing a vitest test suite from a specification. You are NOT implementing.

CONTEXT
specs/05-EXPORT-ENGINE.md section 3 defines six sanitisation rules applied in a fixed
order. That section is authoritative.

TASK
Write tests/export/sanitize.test.ts for a function that does not exist yet:

  sanitizeCell(raw: unknown): string | number | boolean | Date | null

INPUT
The six rules in section 3, in order:
  1. null / undefined / missing -> null (empty cell)
  2. strip control chars U+0000-U+0008, U+000B, U+000C, U+000E-U+001F; KEEP U+0009 and U+000A
  3. normalise \r\n and lone \r to \n
  4. prefix a leading = + - @ with a single quote
  5. truncate above 32760 chars and append " […]"
  6. leave type coercion to a separate function; out of scope here

ACCEPTANCE
1. At least three test cases per rule, including boundary cases.
2. A case where a value contains three line breaks and the output keeps all three as \n.
3. A case with mixed \r\n and \n in one value.
4. A case with the exact string "=SUM(1,1)".
5. A case at exactly 32760 characters and one at 32761.
6. A case where the tab character U+0009 must survive.
7. Table-driven with it.each, not six separate describes.
8. The file compiles under tsc --noEmit even though sanitizeCell does not exist yet
   (import it from '@/lib/export/sanitize').

FORBIDDEN
Do not create lib/export/sanitize.ts. Do not implement anything. Tests only.
```

### Session B — implementation

Start a **fresh** session. Add the implementation file and the test file.

```
ROLE
You are implementing a pure function so that an existing test suite passes.

CONTEXT
tests/export/sanitize.test.ts is the specification. It is authoritative and must not change.

TASK
Implement sanitizeCell in lib/export/sanitize.ts until every test passes.

INPUT
export function sanitizeCell(raw: unknown): string | number | boolean | Date | null

ACCEPTANCE
1. pnpm test tests/export/sanitize.test.ts — all green.
2. pnpm typecheck — clean.
3. The function is pure: no I/O, no Date.now(), no randomness, no logging.
4. The six rules are applied in the documented order, and the code makes that order obvious.

FORBIDDEN
Do not modify the test file. If a test looks wrong, say so under UNSURE and leave it.
Do not add exports beyond sanitizeCell.
```

---

## T8 — Type mapper

```
ROLE
You are implementing a table-driven pure function.

CONTEXT
specs/05-EXPORT-ENGINE.md section 4 contains the complete type mapping table.
recon/FINDINGS.md lists the type/fieldType combinations that actually exist in our portal.

TASK
Implement lib/export/typeMap.ts.

INPUT
export interface PropertyDef { name: string; label: string; type: string; fieldType: string;
                               options?: { value: string; label: string }[] }
export interface MappedCell  { value: string | number | boolean | Date | null;
                               numFmt?: string; wrapText?: boolean }
export function mapCell(raw: unknown, def: PropertyDef): MappedCell

ACCEPTANCE
1. Every row of the table in section 4 is handled.
2. Every combination listed in recon/FINDINGS.md is handled.
3. An unknown type falls back to text and NEVER throws.
4. enumeration values are mapped internal -> label using def.options.
5. Multi-select values separated by ";" map each value and join with ", ".
6. date -> Date with numFmt 'yyyy-mm-dd'; datetime -> Date with numFmt 'yyyy-mm-dd hh:mm'.
7. A table-driven test file covering every row, all green.

FORBIDDEN
Do not infer a type by inspecting the value. The type comes from def only. A value of
"1234" is a string in one portal and a number in another; only def tells you which.
Do not import anything from lib/hubspot/.
```

---

## T17 — a UI component (its comfort zone)

```
ROLE
You are writing a React component in an existing Next.js 15 App Router project.

CONTEXT
shadcn/ui and Tailwind are installed. specs/06-API-CONTRACT.md defines the data shape.

TASK
Create components/PropertyPicker.tsx: a searchable list of HubSpot properties where
selected properties appear in a second list that can be reordered by drag and drop.

INPUT
interface Props {
  properties: { name: string; label: string; isSystem: boolean }[];
  selected: string[];
  onChange: (next: string[]) => void;
}

ACCEPTANCE
1. Search filters on both name and label, case-insensitive.
2. System properties (isSystem) are hidden behind a toggle, off by default.
3. Selected properties render in `selected` order, and dragging changes that order.
4. onChange fires with the new array on every add, remove, and reorder.
5. Client component ('use client'). No data fetching inside it.
6. Empty state when nothing is selected.

FORBIDDEN
Do not fetch data. Do not add a state management library. Do not sort `selected` —
its order IS the user's column order and reordering it silently is a product bug.
```

---

## When it goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| Ignores your instructions | `num_ctx` too small, prompt truncated | Set `num_ctx` in the Modelfile, shorten the context |
| Edits files you did not ask about | Too many files in the session | One file. Specs via `--read` only |
| Invents a HubSpot field | No ground truth in context | `--read recon/FINDINGS.md`, and enforce rule 9 |
| Quality drops mid-session | Context filling up | `/clear`, or quit and restart. Do not push through |
| Rewrites your tests to pass | Ambiguous instruction | State "do not modify the test file" in FORBIDDEN, every time |
| Plausible code, wrong behaviour | The model's characteristic failure | This is why tests come first. There is no other defence |
