/**
 * Browser smoke + screenshot for Dolphin polish.
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
const checks = [];

function ok(name, pass, detail = "") {
  checks.push({ name, pass, detail });
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
  );
}

try {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector('input[name="email"]', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 800));
  await page.click('input[name="email"]', { clickCount: 3 });
  await page.type('input[name="email"]', EMAIL);
  await page.click('input[name="password"]', { clickCount: 3 });
  await page.type('input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForFunction(
    () => window.location.pathname.includes("/machines"),
    { timeout: 60000 },
  );
  ok("login", true);

  const navLabels = await page.$$eval("aside a, nav a", (els) =>
    els.map((e) => e.textContent.trim()),
  );
  const expected = [
    "Machines",
    "Proxies",
    "Dolphin",
    "Wipeout",
    "Archive",
    "Settings",
  ];
  ok(
    "nav order Machines → Proxies → Dolphin → …",
    expected.every((l, i) => navLabels[i] === l),
    navLabels.join(" | "),
  );

  await page.goto(`${BASE}/dolphin`, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });
  await page.waitForSelector("table", { timeout: 15000 });

  const subtitle = await page.$eval(".page-subtitle", (el) =>
    el.textContent.trim(),
  );
  ok(
    "subtitle",
    subtitle === "Manage Dolphin accounts, linked VMs, and wallets.",
    subtitle,
  );

  const headers = await page.$$eval("thead th", (ths) =>
    ths.map((th) => th.textContent.trim()).filter(Boolean),
  );
  ok(
    "columns Account|Linked VM|Wallet|Address|Network|Actions",
    headers.join("|") ===
      "Account name|Linked VM|Wallet|Address|Network|Actions",
    headers.join(" | "),
  );

  const bodyText = await page.$eval("tbody", (el) => el.innerText);
  ok(
    "no DE DE / US US duplication",
    !/\bDE\s+DE\b/.test(bodyText) && !/\bUS\s+US\b/.test(bodyText) && !/\bGB\s+GB\b/.test(bodyText),
    bodyText.slice(0, 200),
  );

  const linkedUsesCompany = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll("tbody tr td:nth-child(2)"));
    return cells.some((c) => /101\s*·\s*[A-Za-z]/.test(c.innerText));
  });
  ok("linked VM shows VMID · company", linkedUsesCompany);

  const noArchivedDup = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll("tbody tr td:nth-child(2)"));
    // Lifecycle pill may say Archived once; line itself must not also say "archived"
    return cells.every((c) => {
      const link = c.querySelector("a");
      const line = link?.innerText || "";
      return !/\barchived\b/i.test(line);
    });
  });
  ok("no duplicate archived text in linked line", noArchivedDup);

  const walletCol = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tbody tr"));
    return rows.map((r) => {
      const tds = r.querySelectorAll("td");
      return {
        account: tds[0]?.textContent.trim(),
        wallet: tds[2]?.textContent.trim(),
        address: tds[3]?.textContent.trim(),
        network: tds[4]?.textContent.trim(),
      };
    });
  });
  ok(
    "wallet label / address split (em dash when empty)",
    walletCol.some((r) => r.account === "alpha-eth" && r.wallet === "Trading") &&
      walletCol.some((r) => r.account === "gamma-sol" && (r.wallet === "—" || r.wallet === "–")) &&
      walletCol.every((r) => r.address && r.address !== "—" ? r.address.includes("…") || r.address.length > 8 : true),
    JSON.stringify(walletCol),
  );
  ok(
    "existing networks preserved (ETH/SOL)",
    walletCol.some((r) => r.network === "ETH") &&
      walletCol.some((r) => r.network === "SOL"),
    JSON.stringify(walletCol.map((r) => r.network)),
  );

  // Add form: default network TRC20, selector uses company
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent.includes("Add account"),
    );
    btn?.click();
  });
  await page.waitForSelector("#add-dolphin-form", { timeout: 5000 });
  const formBits = await page.evaluate(() => {
    const net = document.querySelector('#add-dolphin-form input[name="network"]');
    const opts = Array.from(
      document.querySelectorAll('#add-dolphin-form select[name="machineId"] option'),
    ).map((o) => o.textContent.trim());
    return {
      networkDefault: net?.value,
      hasCompanyOption: opts.some((t) => /^\d+\s*·\s+/.test(t) && !/web-alpha|staging/.test(t)),
      sampleOptions: opts.slice(0, 4),
    };
  });
  ok(
    "new account network defaults to TRC20",
    formBits.networkDefault === "TRC20",
    formBits.networkDefault,
  );
  ok(
    "VM selector uses VMID · company (not display name)",
    formBits.hasCompanyOption,
    formBits.sampleOptions.join(" | "),
  );

  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 300));

  await page.screenshot({
    path: path.join(MEDIA, "dolphin-polish.png"),
    fullPage: false,
  });
  ok("screenshot dolphin-polish.png", true);
} catch (err) {
  ok("script error", false, String(err));
  console.error(err);
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exit(1);
