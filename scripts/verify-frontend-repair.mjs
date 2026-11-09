/**
 * Authenticated smoke: login, Machines, Wipeout; capture console/page errors.
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.APP_URL || "http://127.0.0.1:3001";
const MEDIA =
  process.env.MEDIA_DIR ||
  "/home/mikemin/.local/state/cursor/agent-stores/cursor_agent_stores/bc-85821822-22a1-4f19-b3a1-5809c4a327cc/files/media";
const EMAIL = process.env.ADMIN_EMAIL || "admin@example.com";
const PASS = process.env.ADMIN_PASSWORD || "changeme-admin-pass";

fs.mkdirSync(MEDIA, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome-stable",
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1440,900"],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => pageErrors.push(String(err)));

const checks = [];
function ok(name, pass, detail = "") {
  checks.push({ name, pass, detail });
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
  );
}

try {
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  ok("api/health", health?.ok === true && health?.db === "up", JSON.stringify(health));

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector('input[name="email"]', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 600));
  await page.click('input[name="email"]', { clickCount: 3 });
  await page.type('input[name="email"]', EMAIL);
  await page.click('input[name="password"]', { clickCount: 3 });
  await page.type('input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForFunction(
    () => window.location.pathname.includes("/machines"),
    { timeout: 60000 },
  );
  ok("login → machines", page.url().includes("/machines"), page.url());

  await page.waitForSelector("table", { timeout: 15000 });
  const machinesTitle = await page.$eval("h1", (el) => el.textContent.trim());
  ok("Machines page title", machinesTitle === "Machines", machinesTitle);
  await page.screenshot({
    path: path.join(MEDIA, "frontend-repaired.png"),
    fullPage: false,
  });
  ok("screenshot frontend-repaired.png", true);

  await page.goto(`${BASE}/wipeout`, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });
  await page.waitForSelector("h1", { timeout: 15000 });
  const wipeoutTitle = await page.$eval("h1", (el) => el.textContent.trim());
  ok("Wipeout checklist page", wipeoutTitle === "Wipeout", wipeoutTitle);

  // Open first wipeout row if present to exercise checklist UI
  const opened = await page.evaluate(() => {
    const row = document.querySelector("tbody tr");
    if (!row) return false;
    row.click();
    return true;
  });
  if (opened) {
    await new Promise((r) => setTimeout(r, 800));
    ok("opened wipeout drawer/row", true);
  } else {
    ok("no open wipeouts (page still loads)", true);
  }

  const serious = [...consoleErrors, ...pageErrors].filter(
    (t) =>
      /Cannot find module|SegmentViewNode|MODULE_NOT_FOUND|webpack_modules|Application error|Unhandled/i.test(
        t,
      ),
  );
  ok(
    "no Node/webpack/manifest console errors",
    serious.length === 0,
    serious.slice(0, 5).join(" | ") || `(console errors: ${consoleErrors.length})`,
  );
} catch (err) {
  ok("script error", false, String(err));
  console.error(err);
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exit(1);
