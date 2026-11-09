/**
 * Fail production builds if a next-server is still bound to the app port AND
 * would write into the same distDir the live process is serving from.
 * With NEXT_DIST_DIR=.next-build this is usually a no-op safety check for
 * accidental `next build` without the env var.
 */
import { execSync } from "node:child_process";

const port = process.env.PORT || "3001";
const distDir = process.env.NEXT_DIST_DIR || ".next";

if (distDir !== ".next") {
  process.exit(0);
}

let listening = false;
try {
  const out = execSync(`ss -ltnp 'sport = :${port}'`, { encoding: "utf8" });
  listening = /next-server|next dev/.test(out);
} catch {
  listening = false;
}

if (listening) {
  console.error(
    `[vm-control] Refusing to write distDir "${distDir}" while a Next process is listening on :${port}.\n` +
      `  That corrupts the running webpack cache (MODULE_NOT_FOUND / Client Manifest errors).\n` +
      `  Use: NEXT_DIST_DIR=.next-build npm run build\n` +
      `  Or stop the dev server first.`,
  );
  process.exit(1);
}
