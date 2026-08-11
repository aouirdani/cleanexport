-- CreateEnum
CREATE TYPE "ObjectType" AS ENUM ('CONTACTS', 'COMPANIES', 'DEALS', 'TICKETS');

-- CreateEnum
CREATE TYPE "HeaderStyle" AS ENUM ('LABEL', 'INTERNAL', 'BOTH');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Trigger" AS ENUM ('MANUAL', 'SCHEDULE');

-- CreateEnum
CREATE TYPE "SubStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- CreateTable
CREATE TABLE "Portal" (
    "id" TEXT NOT NULL,
    "hubspotPortalId" BIGINT NOT NULL,
    "name" TEXT,
    "hubDomain" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT[],
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "disconnectedAt" TIMESTAMP(3),

    CONSTRAINT "Portal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "hubspotUserId" BIGINT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportDefinition" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objectType" "ObjectType" NOT NULL,
    "properties" TEXT[],
    "filters" JSONB,
    "associations" JSONB,
    "headerStyle" "HeaderStyle" NOT NULL DEFAULT 'LABEL',
    "scheduleCron" TEXT,
    "scheduleTz" TEXT NOT NULL DEFAULT 'Europe/Paris',
    "recipients" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),

    CONSTRAINT "ExportDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportRun" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "exportId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "trigger" "Trigger" NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "rowCount" INTEGER,
    "fileKey" TEXT,
    "fileSizeBytes" INTEGER,
    "apiCallCount" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT,
    "status" "SubStatus" NOT NULL DEFAULT 'TRIALING',
    "plan" TEXT NOT NULL DEFAULT 'solo',
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyCache" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "objectType" "ObjectType" NOT NULL,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Portal_hubspotPortalId_key" ON "Portal"("hubspotPortalId");

-- CreateIndex
CREATE INDEX "Portal_tokenExpiresAt_idx" ON "Portal"("tokenExpiresAt");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_portalId_hubspotUserId_key" ON "User"("portalId", "hubspotUserId");

-- CreateIndex
CREATE INDEX "ExportDefinition_portalId_idx" ON "ExportDefinition"("portalId");

-- CreateIndex
CREATE INDEX "ExportDefinition_nextRunAt_isActive_idx" ON "ExportDefinition"("nextRunAt", "isActive");

-- CreateIndex
CREATE INDEX "ExportRun_portalId_createdAt_idx" ON "ExportRun"("portalId", "createdAt");

-- CreateIndex
CREATE INDEX "ExportRun_exportId_createdAt_idx" ON "ExportRun"("exportId", "createdAt");

-- CreateIndex
CREATE INDEX "ExportRun_status_idx" ON "ExportRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_portalId_key" ON "Subscription"("portalId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeCustomerId_key" ON "Subscription"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyCache_portalId_objectType_key" ON "PropertyCache"("portalId", "objectType");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "Portal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportDefinition" ADD CONSTRAINT "ExportDefinition_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "Portal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportRun" ADD CONSTRAINT "ExportRun_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "Portal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportRun" ADD CONSTRAINT "ExportRun_exportId_fkey" FOREIGN KEY ("exportId") REFERENCES "ExportDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "Portal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyCache" ADD CONSTRAINT "PropertyCache_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "Portal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
