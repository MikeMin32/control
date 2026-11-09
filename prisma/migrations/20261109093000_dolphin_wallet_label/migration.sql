-- Optional wallet label; existing public addresses stay in walletAddress (Address column).
-- Do not rewrite networks; wallet label left empty for existing rows.
ALTER TABLE "DolphinAccount" ADD COLUMN IF NOT EXISTS "wallet" TEXT;

CREATE INDEX IF NOT EXISTS "DolphinAccount_wallet_idx" ON "DolphinAccount"("wallet");
