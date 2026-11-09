-- Denormalize Company.name onto Machine as a plain-text per-VM label.
-- Preserve existing names; drop the shared-entity FK. No uniqueness on company text.

ALTER TABLE "Machine" ADD COLUMN "company" TEXT;

UPDATE "Machine" AS m
SET "company" = c."name"
FROM "Company" AS c
WHERE m."companyId" = c."id";

ALTER TABLE "Machine" DROP CONSTRAINT "Machine_companyId_fkey";

DROP INDEX "Machine_companyId_idx";

ALTER TABLE "Machine" DROP COLUMN "companyId";
