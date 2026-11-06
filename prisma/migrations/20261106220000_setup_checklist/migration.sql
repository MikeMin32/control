-- CreateEnum
CREATE TYPE "ChecklistTemplateKind" AS ENUM ('WIPEOUT', 'SETUP');

-- AlterTable ChecklistTemplate
ALTER TABLE "ChecklistTemplate" ADD COLUMN IF NOT EXISTS "kind" "ChecklistTemplateKind" NOT NULL DEFAULT 'WIPEOUT';

-- AlterTable ChecklistTemplateItem
ALTER TABLE "ChecklistTemplateItem" ADD COLUMN IF NOT EXISTS "section" TEXT;
ALTER TABLE "ChecklistTemplateItem" ADD COLUMN IF NOT EXISTS "description" TEXT;

-- Optional guidance text on wipeout snapshot items
ALTER TABLE "ClosureChecklistItem" ADD COLUMN IF NOT EXISTS "description" TEXT;

-- CreateTable SetupChecklist
CREATE TABLE "SetupChecklist" (
    "id" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "completedById" UUID,
    "templateName" TEXT NOT NULL,
    "actorId" UUID,
    CONSTRAINT "SetupChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable SetupChecklistItem
CREATE TABLE "SetupChecklistItem" (
    "id" UUID NOT NULL,
    "checklistId" UUID NOT NULL,
    "section" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "ChecklistItemStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "naReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" UUID,
    CONSTRAINT "SetupChecklistItem_pkey" PRIMARY KEY ("id")
);

-- Indexes / uniques
CREATE UNIQUE INDEX "SetupChecklist_machineId_key" ON "SetupChecklist"("machineId");
CREATE INDEX "SetupChecklistItem_checklistId_idx" ON "SetupChecklistItem"("checklistId");
CREATE INDEX "ChecklistTemplate_kind_idx" ON "ChecklistTemplate"("kind");

-- FKs
ALTER TABLE "SetupChecklist" ADD CONSTRAINT "SetupChecklist_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SetupChecklist" ADD CONSTRAINT "SetupChecklist_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SetupChecklistItem" ADD CONSTRAINT "SetupChecklistItem_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "SetupChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SetupChecklistItem" ADD CONSTRAINT "SetupChecklistItem_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Mark existing wipeout templates explicitly
UPDATE "ChecklistTemplate" SET "kind" = 'WIPEOUT' WHERE "kind" IS NULL OR "kind" = 'WIPEOUT';
