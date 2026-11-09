-- Override completion fields on setup + wipeout checklists
ALTER TABLE "SetupChecklist" ADD COLUMN IF NOT EXISTS "completedWithOverride" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SetupChecklist" ADD COLUMN IF NOT EXISTS "overrideNote" TEXT;
ALTER TABLE "SetupChecklist" ADD COLUMN IF NOT EXISTS "overrideUnresolved" JSONB;

ALTER TABLE "ClosureChecklist" ADD COLUMN IF NOT EXISTS "completedWithOverride" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ClosureChecklist" ADD COLUMN IF NOT EXISTS "overrideNote" TEXT;
ALTER TABLE "ClosureChecklist" ADD COLUMN IF NOT EXISTS "overrideUnresolved" JSONB;

-- Dolphin accounts
CREATE TABLE IF NOT EXISTS "DolphinAccount" (
    "id" UUID NOT NULL,
    "accountName" TEXT NOT NULL,
    "machineId" UUID,
    "walletAddress" TEXT,
    "network" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DolphinAccount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DolphinAccount_accountName_idx" ON "DolphinAccount"("accountName");
CREATE INDEX IF NOT EXISTS "DolphinAccount_machineId_idx" ON "DolphinAccount"("machineId");
CREATE INDEX IF NOT EXISTS "DolphinAccount_walletAddress_idx" ON "DolphinAccount"("walletAddress");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DolphinAccount_machineId_fkey'
  ) THEN
    ALTER TABLE "DolphinAccount"
      ADD CONSTRAINT "DolphinAccount_machineId_fkey"
      FOREIGN KEY ("machineId") REFERENCES "Machine"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Migrate Expired lifecycle → Burned; write system audit events; do not archive or complete wipeouts
WITH expired AS (
  SELECT "id" FROM "Machine" WHERE "lifecycleStatus" = 'EXPIRED'
),
updated AS (
  UPDATE "Machine" m
  SET "lifecycleStatus" = 'BURNED',
      "updatedAt" = CURRENT_TIMESTAMP
  FROM expired e
  WHERE m."id" = e."id"
  RETURNING m."id"
)
INSERT INTO "ActivityEvent" ("id", "machineId", "actorId", "type", "message", "metadata", "createdAt")
SELECT
  gen_random_uuid(),
  u."id",
  NULL,
  'machine.lifecycle_migrated',
  'Migrated lifecycle Expired → Burned',
  '{"from":"EXPIRED","to":"BURNED","reason":"remove_expired_status"}'::jsonb,
  CURRENT_TIMESTAMP
FROM updated u;
