-- CreateEnum
CREATE TYPE "ProxyKind" AS ENUM ('VM', 'DOLPHIN');

-- AlterTable Proxy: kind + purchase-source Dolphin (existing rows → VM, purchase unset)
ALTER TABLE "Proxy" ADD COLUMN "kind" "ProxyKind" NOT NULL DEFAULT 'VM';
ALTER TABLE "Proxy" ADD COLUMN "purchaseSourceDolphinId" UUID;

-- AlterTable DolphinAccount: soft retire
ALTER TABLE "DolphinAccount" ADD COLUMN "retiredAt" TIMESTAMP(3);

-- AddForeignKey (Restrict: cannot hard-delete Dolphin while referenced as purchase source)
ALTER TABLE "Proxy" ADD CONSTRAINT "Proxy_purchaseSourceDolphinId_fkey"
  FOREIGN KEY ("purchaseSourceDolphinId") REFERENCES "DolphinAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable DolphinProxyAssignment (connection-proxy history)
CREATE TABLE "DolphinProxyAssignment" (
    "id" UUID NOT NULL,
    "dolphinId" UUID NOT NULL,
    "proxyId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "reason" TEXT,
    "actorId" UUID,

    CONSTRAINT "DolphinProxyAssignment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DolphinProxyAssignment" ADD CONSTRAINT "DolphinProxyAssignment_dolphinId_fkey"
  FOREIGN KEY ("dolphinId") REFERENCES "DolphinAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DolphinProxyAssignment" ADD CONSTRAINT "DolphinProxyAssignment_proxyId_fkey"
  FOREIGN KEY ("proxyId") REFERENCES "Proxy"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "DolphinProxyAssignment_dolphinId_endedAt_idx"
  ON "DolphinProxyAssignment"("dolphinId", "endedAt");

CREATE INDEX "DolphinProxyAssignment_proxyId_endedAt_idx"
  ON "DolphinProxyAssignment"("proxyId", "endedAt");

-- One open connection assignment per Dolphin; one open per proxy
CREATE UNIQUE INDEX dolphin_proxy_assignment_open_dolphin_uniq
  ON "DolphinProxyAssignment" ("dolphinId")
  WHERE "endedAt" IS NULL;

CREATE UNIQUE INDEX dolphin_proxy_assignment_open_proxy_uniq
  ON "DolphinProxyAssignment" ("proxyId")
  WHERE "endedAt" IS NULL;

CREATE INDEX "Proxy_kind_idx" ON "Proxy"("kind");
CREATE INDEX "Proxy_purchaseSourceDolphinId_idx" ON "Proxy"("purchaseSourceDolphinId");
CREATE INDEX "DolphinAccount_retiredAt_idx" ON "DolphinAccount"("retiredAt");
