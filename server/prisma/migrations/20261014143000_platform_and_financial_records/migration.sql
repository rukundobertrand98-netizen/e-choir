CREATE TYPE "PlatformRole" AS ENUM ('USER', 'SUPER_ADMIN');
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "ChoirStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE "FinanceType" AS ENUM ('INCOME', 'EXPENSE');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID');
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

ALTER TABLE "User"
  ADD COLUMN "platformRole" "PlatformRole" NOT NULL DEFAULT 'USER',
  ADD COLUMN "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Choir"
  ADD COLUMN "status" "ChoirStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "statusReason" TEXT,
  ADD COLUMN "statusChangedAt" TIMESTAMP(3);

CREATE TABLE "PlatformAudit" (
  "id" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "reason" TEXT,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinancialRecord" (
  "id" UUID NOT NULL,
  "choirId" UUID NOT NULL,
  "recordedById" UUID NOT NULL,
  "type" "FinanceType" NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "transactionDate" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'RWF',
  "category" TEXT NOT NULL,
  "paymentMethod" TEXT,
  "referenceNumber" TEXT,
  "description" TEXT NOT NULL,
  "receiptReference" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinancialRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialRecord_amount_positive" CHECK ("amount" > 0)
);

CREATE TABLE "FinancialAudit" (
  "id" UUID NOT NULL,
  "financialRecordId" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT,
  "before" JSONB,
  "after" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancialAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Announcement" (
  "id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "maintenance" BOOLEAN NOT NULL DEFAULT false,
  "publishedAt" TIMESTAMP(3),
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnnouncementChoir" (
  "announcementId" UUID NOT NULL,
  "choirId" UUID NOT NULL,
  CONSTRAINT "AnnouncementChoir_pkey" PRIMARY KEY ("announcementId", "choirId")
);

CREATE TABLE "SupportTicket" (
  "id" UUID NOT NULL,
  "choirId" UUID,
  "createdById" UUID NOT NULL,
  "assignedToId" UUID,
  "subject" TEXT NOT NULL,
  "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
  "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportReply" (
  "id" UUID NOT NULL,
  "ticketId" UUID NOT NULL,
  "authorId" UUID NOT NULL,
  "body" TEXT NOT NULL,
  "internal" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportReply_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SystemSetting" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedById" UUID NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "SecurityEvent" (
  "id" UUID NOT NULL,
  "userId" UUID,
  "event" TEXT NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlatformAudit_createdAt_idx" ON "PlatformAudit"("createdAt");
CREATE INDEX "PlatformAudit_entityType_entityId_idx" ON "PlatformAudit"("entityType", "entityId");
CREATE INDEX "PlatformAudit_actorId_createdAt_idx" ON "PlatformAudit"("actorId", "createdAt");
CREATE INDEX "FinancialRecord_choirId_transactionDate_idx" ON "FinancialRecord"("choirId", "transactionDate");
CREATE INDEX "FinancialRecord_choirId_type_status_idx" ON "FinancialRecord"("choirId", "type", "status");
CREATE INDEX "FinancialRecord_referenceNumber_idx" ON "FinancialRecord"("referenceNumber");
CREATE INDEX "FinancialAudit_financialRecordId_createdAt_idx" ON "FinancialAudit"("financialRecordId", "createdAt");
CREATE INDEX "Announcement_publishedAt_idx" ON "Announcement"("publishedAt");
CREATE INDEX "AnnouncementChoir_choirId_idx" ON "AnnouncementChoir"("choirId");
CREATE INDEX "SupportTicket_status_priority_updatedAt_idx" ON "SupportTicket"("status", "priority", "updatedAt");
CREATE INDEX "SupportTicket_choirId_createdAt_idx" ON "SupportTicket"("choirId", "createdAt");
CREATE INDEX "SupportReply_ticketId_createdAt_idx" ON "SupportReply"("ticketId", "createdAt");
CREATE INDEX "SecurityEvent_createdAt_idx" ON "SecurityEvent"("createdAt");
CREATE INDEX "SecurityEvent_userId_createdAt_idx" ON "SecurityEvent"("userId", "createdAt");
CREATE INDEX "SecurityEvent_event_createdAt_idx" ON "SecurityEvent"("event", "createdAt");

ALTER TABLE "PlatformAudit" ADD CONSTRAINT "PlatformAudit_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialRecord" ADD CONSTRAINT "FinancialRecord_choirId_fkey"
  FOREIGN KEY ("choirId") REFERENCES "Choir"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinancialRecord" ADD CONSTRAINT "FinancialRecord_recordedById_fkey"
  FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialAudit" ADD CONSTRAINT "FinancialAudit_financialRecordId_fkey"
  FOREIGN KEY ("financialRecordId") REFERENCES "FinancialRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinancialAudit" ADD CONSTRAINT "FinancialAudit_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnnouncementChoir" ADD CONSTRAINT "AnnouncementChoir_announcementId_fkey"
  FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnnouncementChoir" ADD CONSTRAINT "AnnouncementChoir_choirId_fkey"
  FOREIGN KEY ("choirId") REFERENCES "Choir"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_choirId_fkey"
  FOREIGN KEY ("choirId") REFERENCES "Choir"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assignedToId_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportReply" ADD CONSTRAINT "SupportReply_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportReply" ADD CONSTRAINT "SupportReply_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SystemSetting" ADD CONSTRAINT "SystemSetting_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
