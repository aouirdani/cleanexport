# 02 — Architecture and Stack

## 1. Constraints that drive every choice

1. Solo maintainer, part-time.
2. Must run reliable **scheduled background jobs** that may exceed 60 seconds.
3. Must store OAuth refresh tokens securely and refresh them without user action.
4. Near-zero fixed cost until revenue exists.
5. Must be implementable by AI coding agents, including weaker local models.

Constraint 5 is a real engineering constraint. It rules out exotic frameworks: pick the
stack with the largest volume of conventional public code, because that is what the models
were trained on. Novelty costs you correctness here.

## 2. The stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 16, App Router, TypeScript** | One repo for UI and API. Largest training corpus of any full-stack framework. Turbopack is the default bundler in 16. |
| UI | **Tailwind CSS + shadcn/ui** | Copy-paste components; agents generate them reliably. |
| DB | **PostgreSQL (Supabase or Neon)** | Free tier, standard SQL, connection pooling. |
| ORM | **Prisma** | Chosen over Drizzle deliberately: more training data, clearer errors, schema file doubles as documentation for the agent. |
| Background jobs | **Inngest** | Durable steps, automatic retries, cron triggers, survives serverless timeouts. This is the piece you must not hand-roll. |
| XLSX generation | **ExcelJS** (`WorkbookWriter` streaming API) | Streams to disk instead of building the workbook in memory. Required for 100k-row exports. |
| File storage | **Cloudflare R2** (S3-compatible) | No egress fees. Signed URLs with TTL. |
| Email | **Resend** | Simple API, good deliverability, React Email templates. |
| Payments | **Stripe Checkout + Customer Portal** | Do not build billing UI. Stripe hosts both. |
| Hosting | **Vercel** (app) + **Inngest Cloud** (jobs) | Both have usable free tiers. |
| Error tracking | **Sentry** | Free tier. Non-optional: you will not be watching logs at 3am. |

### Fallback if you prefer to own everything

Single Docker Compose on a €6/month VPS: Next.js + Postgres + BullMQ worker + Redis +
MinIO + Caddy. Cheaper and no vendor lock-in, but you now own uptime, backups, and TLS.
Choose this only if you already run infrastructure comfortably. **Do not host a B2B SaaS
on a home server** — a customer's scheduled export failing because your fibre dropped is
the fastest way to lose the customer.

## 3. Authentication decision

**HubSpot OAuth is the only login.** There is no email/password, no magic link, no
separate user table with credentials.

A user arriving at the app clicks "Connect HubSpot", completes the OAuth flow, and a
session is created keyed to the HubSpot `portalId` + `userId` returned by the token
introspection endpoint. This removes an entire subsystem — password reset, email
verification, session security — from the MVP.

## 4. Job execution model

Three Inngest functions, no more.

```
export.run.requested   (event)  → runs one export, writes file, sends email
export.schedule.tick   (cron)   → every 15 min, finds due schedules, emits run.requested
hubspot.token.refresh  (cron)   → hourly, refreshes tokens expiring in < 2h
```

`export.run.requested` must be written as discrete Inngest steps so a failure retries only
the failed step:

```
step 1: load export definition + decrypt token
step 2: fetch pages from HubSpot (loop, rate-limited)
step 3: resolve associations
step 4: write XLSX to temp file
step 5: upload to R2
step 6: send email
step 7: mark run complete
```

## 5. Security requirements

- HubSpot `refresh_token` is **encrypted at rest** with AES-256-GCM using a key from the
  environment, never stored in plaintext, never logged, never returned by any API endpoint.
- Generated files are stored under a non-guessable key and served only via signed URLs
  with a 7-day TTL.
- Every database query involving portal data is scoped by `portalId`. There is no endpoint
  that can return another portal's data. Write this as a Prisma middleware, not as
  discipline in each handler.
- No customer CRM data is persisted beyond the generated file. Do not build a data
  warehouse. Row-level CRM data lives in the XLSX and nowhere else.

## 5b. Node version, and why it matters here

Next.js 16 requires Node **>= 20.9**. Your Node 25 satisfies that, but 25 is an
odd-numbered release: it is not LTS, and native modules — Prisma's query engine in
particular — routinely lag behind it. Fighting the toolchain is not what this project is
for.

```bash
nvm install 22 && nvm use 22
echo "22" > .nvmrc
```

Node 22 LTS. Pin it in `.nvmrc` so the version is part of the repo rather than part of
your memory.

## 5c. Next.js 16 ships its own agent instructions — use them

From 16.2, the Next.js docs are bundled inside `node_modules/next/dist/docs/`, and
`next dev` writes a block into `AGENTS.md` at the project root. Its opening line is
essentially: this is not the Next.js in your training data, read the bundled guide before
writing any code.

This is written for exactly your situation. A local 27B model's Next.js knowledge is
Next.js 14/15 era at best, and it will confidently produce App Router patterns that were
removed. Two consequences:

1. **Do not delete or overwrite the `nextjs-agent-rules` block** in the generated
   `AGENTS.md`. `next dev` re-adds it anyway.
2. When a task touches routing, caching, or server components, pass the relevant file from
   `node_modules/next/dist/docs/` to the agent with `--read`. It is version-exact
   documentation sitting on your disk — better ground truth than anything the model
   remembers, and the same principle as `recon/FINDINGS.md`.

## 6. Using Ollama and local models for the build

You asked specifically about this. Practical guidance:

**Split the work by difficulty, not by convenience.**

| Do with a frontier model or by hand | Safe for a local model |
|---|---|
| OAuth flow and token refresh logic | React components and forms |
| Rate limiter and pagination loop | Prisma schema from `03-DATA-MODEL.md` |
| XLSX cell-typing and sanitisation rules | CRUD API route handlers |
| Stripe webhook handling | Tailwind styling, empty states, loading states |
| Anything touching encryption | Unit tests from a given signature |

The left column is where a subtle bug costs you a customer silently. The right column is
where a bug is visible immediately.

**Model selection.** Check `ollama.com/library` for current versions rather than trusting
any list — this space moves monthly. As of early-mid 2026 the credible local coding
families are Qwen Coder, DeepSeek Coder, Codestral/Devstral, and GLM. Rules of thumb:

- A 30B-class model at 4-bit quantisation needs roughly 20 GB of VRAM. Below that you are
  in 7–14B territory, which is fine for single-function tasks and unreliable for anything
  spanning multiple files.
- Set `num_ctx` explicitly. Ollama's default context is small and silently truncates your
  spec, which is the number one cause of "the model ignored my instructions".
- Quantisation below Q4 degrades code output sharply. Prefer a smaller model at Q5/Q8 over
  a larger one at Q2.

**Feed it correctly.** One task from `07-TASKS.md` per session. Attach `AGENTS.md`,
`03-DATA-MODEL.md`, and only the files being modified. Do not attach the whole repo —
you will blow the context window and get worse output than a 7B model deserves.

**Tests are the contract.** For each task, have the model write the test first from the
spec, confirm the test is right yourself, then have it implement until the test passes.
This is the single highest-leverage habit with weak models, because it converts vague
instructions into a machine-checkable target.
