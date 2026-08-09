# T0 — HubSpot API Reconnaissance Kit

Zero dependencies. Node 20.6+ only (uses `--env-file` and native `fetch`).

This is **throwaway tooling**. It does not belong in the product repo. Its only job is to
show you, with your own eyes, the exact shape of every payload the export engine will
consume — before you write a line of product code.

## Why this exists

Every task from T1 onward assumes payload shapes documented in `04-HUBSPOT-INTEGRATION.md`.
Those shapes came from documentation, not from your portal. Documentation and reality
diverge. An error here propagates silently into everything downstream.

It also resolves the one thing I could not verify for you: **which API path format your
portal actually answers on.** HubSpot is migrating from `/crm/v3/objects/contacts` to
date-based versioning like `/crm/objects/2026-03/contacts`. `probe.mjs` tries both and
tells you which works. Whatever it reports is what you pin in `HUBSPOT_API_VERSION`.

## Setup

### 1. Create a HubSpot developer account and a test portal

- Sign up at `developers.hubspot.com` (free).
- Create a **public app** in the developer account.
- In the app's Auth tab, set the redirect URL to `http://localhost:3000/callback`.
- Copy the Client ID and Client Secret.
- Create a **test account** from the developer portal (Testing tab). This gives you a
  sandbox portal with sample CRM data you can install the app into.

### 2. Seed the fixture data by hand

In the test portal, do this manually. It takes five minutes and it is the whole point.

- Open any contact. In a multi-line field (`Notes` / a custom textarea), type three lines
  separated by real line breaks. Save.
- Set another contact's **First name** to exactly `=SUM(1,1)`.
- Create a deal with an `Amount` of `1234.56` and a `Close date`.
- Leave one contact's phone number empty.
- Associate one deal with a company.

### 3. Configure

Create `.env` in this folder:

```
HUBSPOT_CLIENT_ID=xxxx
HUBSPOT_CLIENT_SECRET=xxxx
HUBSPOT_REDIRECT_URI=http://localhost:3000/callback
```

## Run

```bash
node --env-file=.env auth.mjs      # opens the OAuth dance, writes tokens.json
node --env-file=.env probe.mjs     # runs checks 1–5
node --env-file=.env probe.mjs --ratelimit   # check 6, fires 200 requests on purpose
```

`tokens.json` contains a live refresh token. It is gitignored. Do not commit it, do not
paste it into a chat.

## Exit criteria

You may start T1 when you can answer all of these from the output:

1. Which API path format works — date-based or `v3`? → pin it in `HUBSPOT_API_VERSION`.
2. How many properties does a real `contacts` object have in your portal?
3. **Does the multi-line field come back containing `\n`?** Look at the escaped output,
   not the pretty-printed one. This is the single most important observation in T0 —
   the entire product is built on handling it correctly.
4. What does an empty property look like: absent key, `null`, or empty string?
5. What does an owner field return — an ID or an object?
6. What is the exact shape of the batch associations response?
7. Does `429` arrive with a `Retry-After` header, and what value?

If any answer contradicts `04-HUBSPOT-INTEGRATION.md`, **edit that file before continuing.**
The spec serves reality, not the other way round.
