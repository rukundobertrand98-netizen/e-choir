-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ChoirRole" AS ENUM ('ADMIN', 'DIRECTOR', 'SECTION_LEADER', 'TREASURER', 'MEMBER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'INVITED');

-- CreateEnum
CREATE TYPE "SongStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Choir" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Kigali',
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Choir_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChoirMembership" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "choirId" UUID NOT NULL,
    "role" "ChoirRole" NOT NULL DEFAULT 'MEMBER',
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "sectionId" UUID,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChoirMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VocalSection" (
    "id" UUID NOT NULL,
    "choirId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VocalSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Song" (
    "id" UUID NOT NULL,
    "choirId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "composer" TEXT,
    "category" TEXT,
    "language" TEXT,
    "lyrics" TEXT,
    "musicalKey" TEXT,
    "bpm" INTEGER,
    "durationSec" INTEGER,
    "notes" TEXT,
    "status" "SongStatus" NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Song_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rehearsal" (
    "id" UUID NOT NULL,
    "choirId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "venue" TEXT,
    "description" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rehearsal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" UUID NOT NULL,
    "choirId" UUID NOT NULL,
    "sectionId" UUID,
    "invitedById" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "ChoirRole" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "choirId" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "ChoirMembership_choirId_status_idx" ON "ChoirMembership"("choirId", "status");

-- CreateIndex
CREATE INDEX "ChoirMembership_sectionId_idx" ON "ChoirMembership"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ChoirMembership_userId_choirId_key" ON "ChoirMembership"("userId", "choirId");

-- CreateIndex
CREATE INDEX "VocalSection_choirId_idx" ON "VocalSection"("choirId");

-- CreateIndex
CREATE UNIQUE INDEX "VocalSection_choirId_name_key" ON "VocalSection"("choirId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "VocalSection_id_choirId_key" ON "VocalSection"("id", "choirId");

-- CreateIndex
CREATE INDEX "Song_choirId_title_idx" ON "Song"("choirId", "title");

-- CreateIndex
CREATE INDEX "Song_choirId_status_idx" ON "Song"("choirId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Song_choirId_title_key" ON "Song"("choirId", "title");

-- CreateIndex
CREATE INDEX "Rehearsal_choirId_startsAt_idx" ON "Rehearsal"("choirId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_status_idx" ON "Session"("userId", "status");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_choirId_email_idx" ON "Invitation"("choirId", "email");

-- CreateIndex
CREATE INDEX "Invitation_expiresAt_idx" ON "Invitation"("expiresAt");

-- CreateIndex
CREATE INDEX "Invitation_invitedById_idx" ON "Invitation"("invitedById");

-- CreateIndex
CREATE INDEX "AuditLog_choirId_createdAt_idx" ON "AuditLog"("choirId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_choirId_entityType_entityId_idx" ON "AuditLog"("choirId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "ChoirMembership" ADD CONSTRAINT "ChoirMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChoirMembership" ADD CONSTRAINT "ChoirMembership_choirId_fkey" FOREIGN KEY ("choirId") REFERENCES "Choir"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChoirMembership" ADD CONSTRAINT "ChoirMembership_sectionId_choirId_fkey" FOREIGN KEY ("sectionId", "choirId") REFERENCES "VocalSection"("id", "choirId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VocalSection" ADD CONSTRAINT "VocalSection_choirId_fkey" FOREIGN KEY ("choirId") REFERENCES "Choir"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Song" ADD CONSTRAINT "Song_choirId_fkey" FOREIGN KEY ("choirId") REFERENCES "Choir"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rehearsal" ADD CONSTRAINT "Rehearsal_choirId_fkey" FOREIGN KEY ("choirId") REFERENCES "Choir"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_choirId_fkey" FOREIGN KEY ("choirId") REFERENCES "Choir"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_sectionId_choirId_fkey" FOREIGN KEY ("sectionId", "choirId") REFERENCES "VocalSection"("id", "choirId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_choirId_fkey" FOREIGN KEY ("choirId") REFERENCES "Choir"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Rehearsal" ADD CONSTRAINT "Rehearsal_end_after_start_check" CHECK ("endsAt" > "startsAt");

ALTER TABLE "Song" ADD CONSTRAINT "Song_bpm_range_check" CHECK ("bpm" IS NULL OR ("bpm" >= 20 AND "bpm" <= 400));

ALTER TABLE "Song" ADD CONSTRAINT "Song_duration_positive_check" CHECK ("durationSec" IS NULL OR "durationSec" > 0);
