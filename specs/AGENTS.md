# AGENTS.md

Place this file at the repository root. Every coding agent session must load it.

## Project

CleanExport — scheduled, correct Excel exports of HubSpot CRM data. Next.js 15 (App
Router) + TypeScript + Prisma + PostgreSQL + Inngest + ExcelJS + Stripe + Resend.

## Rules

1. **Implement the task given. Nothing else.** Do not add features, do not refactor
   unrelated files, do not "improve" the schema. If something outside the task looks
   wrong, say so in your response and leave it alone.
2. **The specs are authoritative.** `05-EXPORT-ENGINE.md` and `03-DATA-MODEL.md` override
   your instincts. Where a spec seems suboptimal, follow it and flag the concern.
3. **Never invent HubSpot API behaviour.** If a payload shape is not documented in
   `04-HUBSPOT-INTEGRATION.md`, stop and ask. A plausible guess about an external API is
   worse than a question, because it fails silently in production.
4. **No new dependencies** without stating the reason and the alternative you rejected.
5. **TypeScript strict mode. No `any`.** Use `unknown` plus a type guard.
6. **Every exported function has a test.** Pure functions get exhaustive table-driven tests.
7. **Never log, return, or serialise a token**, decrypted or encrypted.
8. **Every database query is scoped by `portalId`.** No exceptions.
9. **Order matters** in `ExportDefinition.properties`. Never sort, never pass it through a
   `Set`, never rebuild it from an object's keys.
10. **Fail loudly.** No empty `catch`. No default value that hides an error. Silent
    truncation of a dataset is the worst possible bug in this product.

## Layout

```
app/
  (auth)/            login, oauth callback pages
  (app)/dashboard/   authenticated UI
  api/               route handlers
lib/
  hubspot/           client.ts, oauth.ts, types.ts
  export/            sanitize.ts, typeMap.ts, fetch.ts, associations.ts, writer.ts
  crypto.ts errors.ts schemas.ts plan.ts
inngest/             functions
prisma/              schema.prisma, migrations
tests/               mirrors lib/
```

## Conventions

- Files `kebab-case.ts`. React components `PascalCase.tsx`. Functions `camelCase`.
- Error codes `SCREAMING_SNAKE`, defined in `lib/errors.ts` and imported. Never inline.
- Dates in UTC internally; convert at the presentation and export boundary only.
- `BigInt` serialised as string in every JSON response.
- Prefer pure functions. Push side effects to the edges.

## Definition of done

- [ ] Task's stated behaviour implemented
- [ ] Tests written and passing
- [ ] `tsc --noEmit` clean
- [ ] No `any`, no `console.log` left behind
- [ ] No secret in code, logs, or test fixtures
- [ ] Nothing outside the task's scope was modified

## When you are unsure

Say so and ask. A question costs one message. A wrong assumption about token refresh or
about pagination costs a customer, and you will not find out for weeks.
