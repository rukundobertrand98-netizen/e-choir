-- Introduce name-based sign-in and per-user language preferences.
BEGIN;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT lower(regexp_replace(btrim("name"), '[[:space:]]+', ' ', 'g'))
    FROM "Choir"
    GROUP BY lower(regexp_replace(btrim("name"), '[[:space:]]+', ' ', 'g'))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Choir names must be unique (ignoring case and repeated spaces) before enabling name-based sign-in.';
  END IF;
END;
$migration$;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT cm."choirId",
           lower(regexp_replace(btrim(u."name"), '[[:space:]]+', ' ', 'g'))
    FROM "ChoirMembership" cm
    JOIN "User" u ON u."id" = cm."userId"
    GROUP BY cm."choirId",
             lower(regexp_replace(btrim(u."name"), '[[:space:]]+', ' ', 'g'))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Member full names must be unique (ignoring case and repeated spaces) within each choir before enabling name-based sign-in.';
  END IF;
END;
$migration$;

CREATE TYPE "Language" AS ENUM ('EN', 'RW', 'FR');

ALTER TABLE "User"
ADD COLUMN "language" "Language" NOT NULL DEFAULT 'EN';

ALTER TABLE "Choir"
ADD COLUMN "nameKey" TEXT;

UPDATE "Choir"
SET "nameKey" = lower(regexp_replace(btrim("name"), '[[:space:]]+', ' ', 'g'));

ALTER TABLE "Choir"
ALTER COLUMN "nameKey" SET NOT NULL;

CREATE UNIQUE INDEX "Choir_nameKey_key" ON "Choir"("nameKey");

ALTER TABLE "ChoirMembership"
ADD COLUMN "loginName" TEXT;

UPDATE "ChoirMembership" cm
SET "loginName" = lower(regexp_replace(btrim(u."name"), '[[:space:]]+', ' ', 'g'))
FROM "User" u
WHERE u."id" = cm."userId";

ALTER TABLE "ChoirMembership"
ALTER COLUMN "loginName" SET NOT NULL;

CREATE UNIQUE INDEX "ChoirMembership_choirId_loginName_key"
ON "ChoirMembership"("choirId", "loginName");

DROP TABLE "Invitation";

CREATE TYPE "MembershipStatus_new" AS ENUM ('ACTIVE', 'INACTIVE');

ALTER TABLE "ChoirMembership"
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" TYPE "MembershipStatus_new"
USING (
  CASE
    WHEN "status"::TEXT IN ('ACTIVE', 'INACTIVE') THEN "status"::TEXT
    ELSE 'INACTIVE'
  END
)::"MembershipStatus_new";

DROP TYPE "MembershipStatus";
ALTER TYPE "MembershipStatus_new" RENAME TO "MembershipStatus";

ALTER TABLE "ChoirMembership"
ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

DROP INDEX IF EXISTS "User_email_key";
ALTER TABLE "User" DROP COLUMN "email";

COMMIT;
