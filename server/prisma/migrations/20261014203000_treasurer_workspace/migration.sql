CREATE TYPE "FinancialApprovalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "ChoirMembership"
  ADD CONSTRAINT "ChoirMembership_id_choirId_key" UNIQUE ("id", "choirId");

ALTER TABLE "FinancialRecord"
  ADD COLUMN "membershipId" UUID,
  ADD COLUMN "approvalStatus" "FinancialApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "contributionMonth" TIMESTAMP(3),
  ADD COLUMN "payerName" TEXT,
  ADD COLUMN "beneficiary" TEXT,
  ADD COLUMN "receiptStorageName" TEXT,
  ADD COLUMN "receiptContentType" TEXT,
  ADD COLUMN "receiptSizeBytes" INTEGER,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvedById" UUID;

ALTER TABLE "FinancialRecord"
  ADD CONSTRAINT "FinancialRecord_membershipId_choirId_fkey"
    FOREIGN KEY ("membershipId", "choirId") REFERENCES "ChoirMembership"("id", "choirId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FinancialRecord_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FinancialRecord_receiptSizeBytes_check"
    CHECK ("receiptSizeBytes" IS NULL OR "receiptSizeBytes" > 0);

CREATE TABLE "ContributionPolicy" (
  "id" UUID NOT NULL,
  "choirId" UUID NOT NULL,
  "monthlyAmount" DECIMAL(14,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'RWF',
  "effectiveFrom" DATE NOT NULL,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContributionPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContributionPolicy_monthlyAmount_check" CHECK ("monthlyAmount" >= 0)
);

CREATE TABLE "ContributionExemption" (
  "id" UUID NOT NULL,
  "choirId" UUID NOT NULL,
  "membershipId" UUID NOT NULL,
  "startsAt" DATE NOT NULL,
  "endsAt" DATE,
  "reason" TEXT NOT NULL,
  "authorizedById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContributionExemption_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContributionExemption_date_range_check" CHECK ("endsAt" IS NULL OR "endsAt" >= "startsAt")
);

CREATE TABLE "FinancialBudget" (
  "id" UUID NOT NULL,
  "choirId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'RWF',
  "startsAt" DATE NOT NULL,
  "endsAt" DATE NOT NULL,
  "eventId" UUID,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinancialBudget_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialBudget_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "FinancialBudget_date_range_check" CHECK ("endsAt" >= "startsAt")
);

CREATE UNIQUE INDEX "ContributionPolicy_choirId_effectiveFrom_key"
  ON "ContributionPolicy"("choirId", "effectiveFrom");
CREATE INDEX "ContributionPolicy_choirId_effectiveFrom_idx"
  ON "ContributionPolicy"("choirId", "effectiveFrom");
CREATE INDEX "ContributionExemption_choirId_membershipId_startsAt_endsAt_idx"
  ON "ContributionExemption"("choirId", "membershipId", "startsAt", "endsAt");
CREATE INDEX "FinancialBudget_choirId_startsAt_endsAt_idx"
  ON "FinancialBudget"("choirId", "startsAt", "endsAt");
CREATE INDEX "FinancialBudget_choirId_category_currency_idx"
  ON "FinancialBudget"("choirId", "category", "currency");
CREATE INDEX "FinancialRecord_choirId_membershipId_contributionMonth_idx"
  ON "FinancialRecord"("choirId", "membershipId", "contributionMonth");
CREATE INDEX "FinancialRecord_choirId_approvalStatus_transactionDate_idx"
  ON "FinancialRecord"("choirId", "approvalStatus", "transactionDate");
CREATE INDEX "FinancialRecord_membershipId_idx"
  ON "FinancialRecord"("membershipId");
CREATE INDEX "FinancialRecord_approvedById_idx"
  ON "FinancialRecord"("approvedById");

ALTER TABLE "ContributionPolicy"
  ADD CONSTRAINT "ContributionPolicy_choirId_fkey"
    FOREIGN KEY ("choirId") REFERENCES "Choir"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContributionExemption"
  ADD CONSTRAINT "ContributionExemption_choirId_fkey"
    FOREIGN KEY ("choirId") REFERENCES "Choir"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ContributionExemption_membershipId_choirId_fkey"
    FOREIGN KEY ("membershipId", "choirId") REFERENCES "ChoirMembership"("id", "choirId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinancialBudget"
  ADD CONSTRAINT "FinancialBudget_choirId_fkey"
    FOREIGN KEY ("choirId") REFERENCES "Choir"("id") ON DELETE CASCADE ON UPDATE CASCADE;
