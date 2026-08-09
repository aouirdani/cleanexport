# 03 — Data Model

Six tables. If the agent proposes a seventh, it has misunderstood the scope.

## Entity overview

```
Portal (1) ──< User (n)
Portal (1) ──< ExportDefinition (n) ──< ExportRun (n)
Portal (1) ──< Subscription (1)
Portal (1) ──< PropertyCache (n)
```

`Portal` is the tenant. Everything is scoped to it.

## Prisma schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Portal {
  id                String   @id @default(cuid())
  hubspotPortalId   BigInt   @unique
  name              String?
  hubDomain         String?

  // AES-256-GCM encrypted. Never select these in a query that reaches an API response.
  accessTokenEnc    String   @db.Text
  refreshTokenEnc   String   @db.Text
  tokenExpiresAt    DateTime

  scopes            String[]
  timezone          String   @default("Europe/Paris")

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  disconnectedAt    DateTime?

  users             User[]
  exports           ExportDefinition[]
  runs              ExportRun[]
  subscription      Subscription?
  properties        PropertyCache[]

  @@index([tokenExpiresAt])
}

model User {
  id              String   @id @default(cuid())
  portalId        String
  hubspotUserId   BigInt
  email           String
  firstName       String?
  lastName        String?
  lastLoginAt     DateTime?
  createdAt       DateTime @default(now())

  portal          Portal   @relation(fields: [portalId], references: [id], onDelete: Cascade)

  @@unique([portalId, hubspotUserId])
  @@index([email])
}

model ExportDefinition {
  id            String   @id @default(cuid())
  portalId      String
  name          String
  objectType    ObjectType

  // Ordered array of HubSpot internal property names. Order IS the column order.
  // This is a core promise of the product — never sort it.
  properties    String[]

  // See 05-EXPORT-ENGINE.md §4 for the exact JSON shape.
  filters       Json?
  associations  Json?

  headerStyle   HeaderStyle @default(LABEL)

  scheduleCron  String?     // null = manual only
  scheduleTz    String      @default("Europe/Paris")
  recipients    String[]    // email addresses
  isActive      Boolean     @default(true)

  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt
  lastRunAt     DateTime?
  nextRunAt     DateTime?

  portal        Portal      @relation(fields: [portalId], references: [id], onDelete: Cascade)
  runs          ExportRun[]

  @@index([portalId])
  @@index([nextRunAt, isActive])
}

model ExportRun {
  id            String    @id @default(cuid())
  portalId      String
  exportId      String
  status        RunStatus @default(QUEUED)
  trigger       Trigger

  startedAt     DateTime?
  finishedAt    DateTime?

  rowCount      Int?
  fileKey       String?   // R2 object key
  fileSizeBytes Int?
  apiCallCount  Int?

  errorCode     String?
  errorMessage  String?   @db.Text

  createdAt     DateTime  @default(now())

  portal        Portal            @relation(fields: [portalId], references: [id], onDelete: Cascade)
  export        ExportDefinition  @relation(fields: [exportId], references: [id], onDelete: Cascade)

  @@index([portalId, createdAt])
  @@index([exportId, createdAt])
  @@index([status])
}

model Subscription {
  id                    String   @id @default(cuid())
  portalId              String   @unique
  stripeCustomerId      String   @unique
  stripeSubscriptionId  String?  @unique
  status                SubStatus @default(TRIALING)
  plan                  String   @default("solo")
  trialEndsAt           DateTime?
  currentPeriodEnd      DateTime?
  cancelAtPeriodEnd     Boolean  @default(false)

  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  portal                Portal   @relation(fields: [portalId], references: [id], onDelete: Cascade)
}

// Property lists are fetched from HubSpot and cached. Refresh on demand and every 24h.
model PropertyCache {
  id            String     @id @default(cuid())
  portalId      String
  objectType    ObjectType
  payload       Json       // full property definitions array from HubSpot
  fetchedAt     DateTime   @default(now())

  portal        Portal     @relation(fields: [portalId], references: [id], onDelete: Cascade)

  @@unique([portalId, objectType])
}

enum ObjectType {
  CONTACTS
  COMPANIES
  DEALS
  TICKETS
}

enum HeaderStyle {
  LABEL      // "First Name"        — human reading
  INTERNAL   // "firstname"         — machine processing
  BOTH       // row 1 label, row 2 internal, data from row 3
}

enum RunStatus {
  QUEUED
  RUNNING
  SUCCESS
  FAILED
  CANCELLED
}

enum Trigger {
  MANUAL
  SCHEDULE
}

enum SubStatus {
  TRIALING
  ACTIVE
  PAST_DUE
  CANCELED
}
```

## Notes for the implementer

- `hubspotPortalId` is `BigInt`. HubSpot portal IDs exceed the JS safe integer range in
  some regions. Do not use `Int`. Serialise as string in every JSON response.
- `properties` is a Postgres text array and its **order is meaningful**. Any code path
  that sorts, dedupes into a Set, or round-trips through an unordered structure is a bug.
- `ExportRun` never stores CRM row data. Only counts and the file key.
- Retention: delete `ExportRun` rows and their R2 objects older than 90 days via a cron.
