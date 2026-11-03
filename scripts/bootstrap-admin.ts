#!/usr/bin/env tsx
/**
 * Create or update the admin user.
 * Password is read from ADMIN_PASSWORD env (preferred) or --password argv.
 * The password is never logged.
 *
 * Usage:
 *   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='...' npm run bootstrap:admin
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function readArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return undefined;
}

async function main() {
  const email = (
    process.env.ADMIN_EMAIL ||
    readArg("--email") ||
    ""
  )
    .trim()
    .toLowerCase();
  const password = process.env.ADMIN_PASSWORD || readArg("--password") || "";

  if (!email || !password) {
    console.error(
      "Usage: ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run bootstrap:admin",
    );
    process.exit(1);
  }
  if (password.length < 10) {
    console.error("Password must be at least 10 characters.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash, displayName: "Admin" },
  });

  console.log(`Admin ready: ${user.email} (${user.id})`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "Failed");
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
