# CONVENTIONS

<!--
Deliberately short. A 27B model reliably follows roughly 10-15 rules, not 40.
Every rule you add here dilutes the others. Resist growing this file.
Detail belongs in the spec you pass with --read for that specific task.
-->

Project: CleanExport. Scheduled Excel exports of HubSpot CRM data.
Stack: Next.js 16 App Router, TypeScript strict, Prisma, PostgreSQL, ExcelJS, Inngest.

## The eleven rules

1. Do only the task asked. Change no other file. Add no extra feature.
2. TypeScript strict. Never use `any`. Use `unknown` plus a type guard.
3. Every exported function has a test in `tests/`, mirroring its path.
4. Every database query filters on `portalId`.
5. Never log, return, or serialise a token.
6. Never sort or deduplicate `ExportDefinition.properties`. Its order is the user's column order.
7. Never write an empty `catch`. Never return a default value that hides an error.
8. Never truncate data silently. Throw instead.
9. Never invent a HubSpot API field or response shape. If it is not in `recon/FINDINGS.md`, stop and ask.
10. Never edit `prisma/schema.prisma`. Ask first.
11. Next.js 16 differs from your training data. Before writing routing, caching or server
    component code, read the relevant file in `node_modules/next/dist/docs/`. Do not rely
    on remembered Next.js patterns.

## Commands

```
pnpm test          run tests
pnpm typecheck     tsc --noEmit
pnpm lint          eslint
```

Run `pnpm typecheck && pnpm test` before saying a task is finished.

## Answer format

When you finish, reply with exactly:

```
CHANGED: <list of files>
TESTS: <pass|fail> — <n> passing
UNSURE: <anything you guessed, or "nothing">
```

If you had to guess anything, put it under UNSURE. Do not hide a guess.
