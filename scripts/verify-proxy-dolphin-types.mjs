/**
 * Browser smoke + screenshots for proxy VM/Dolphin types + relationships.
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

  // --- Proxies VM tab (default) ---
  await page.goto(`${BASE}/proxies`, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });
  await page.waitForSelector("table", { timeout: 15000 });
  ok("proxies default URL has no tab or tab=vm", !/tab=dolphin/.test(page.url()));

  const tabLabels = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button"))
      .map((b) => b.textContent.trim())
      .filter((t) => t === "VM" || t === "Dolphin"),
  );
  ok("VM + Dolphin tabs present", tabLabels.includes("VM") && tabLabels.includes("Dolphin"), tabLabels.join("|"));

  const vmHeaders = await page.$$eval("thead th", (ths) =>
    ths.map((th) => th.textContent.trim()).filter(Boolean),
  );
  ok(
    "VM tab has Dolphin column",
    vmHeaders.includes("Dolphin") && vmHeaders.includes("Assigned to"),
    vmHeaders.join(" | "),
  );

  const vmBody = await page.$eval("tbody", (el) => el.innerText);
  ok(
    "VM tab shows seeded proxies / purchase hub",
    /Purchase hub|192\.0\.2\.|DocsProxy|ExampleNet/.test(vmBody),
    vmBody.slice(0, 180),
  );

  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent.includes("Add VM proxy"),
    );
    btn?.click();
  });
  await page.waitForSelector("#add-proxy-form", { timeout: 5000 });
  const vmForm = await page.evaluate(() => {
    const form = document.querySelector("#add-proxy-form");
    const ip = form?.querySelector('input[name="ip"]');
    const provider = form?.querySelector('input[name="provider"]');
    const src = form?.querySelector('select[name="purchaseSourceDolphinId"]');
    return {
      ip: ip?.value ?? null,
      provider: provider?.value ?? null,
      purchaseRequired: src?.required === true,
      purchaseEmpty: src?.value === "",
      hasPurchaseHub: Array.from(src?.options || []).some((o) =>
        o.textContent.includes("Purchase hub"),
      ),
    };
  });
  ok("VM create form empty IP/provider", vmForm.ip === "" && vmForm.provider === "", JSON.stringify(vmForm));
  ok(
    "VM create requires purchase-source Dolphin",
    vmForm.purchaseRequired && vmForm.purchaseEmpty && vmForm.hasPurchaseHub,
    JSON.stringify(vmForm),
  );
  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 300));

  await page.screenshot({
    path: path.join(MEDIA, "proxies-vm-tab.png"),
    fullPage: false,
  });
  ok("screenshot proxies-vm-tab.png", true);

  // --- Proxies Dolphin tab ---
  await page.goto(`${BASE}/proxies?tab=dolphin`, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });
  await page.waitForSelector("table", { timeout: 15000 });
  ok("dolphin tab URL persisted", /tab=dolphin/.test(page.url()));

  const dHeaders = await page.$$eval("thead th", (ths) =>
    ths.map((th) => th.textContent.trim()).filter(Boolean),
  );
  ok(
    "Dolphin tab has Connection Dolphin column",
    dHeaders.includes("Connection Dolphin") && !dHeaders.includes("Purchase source"),
    dHeaders.join(" | "),
  );

  const dBody = await page.$eval("tbody", (el) => el.innerText);
  ok(
    "Dolphin tab shows seeded connection proxy",
    /198\.51\.100\.80|gamma-sol|DolphinNet/.test(dBody),
    dBody.slice(0, 200),
  );

  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent.includes("Add Dolphin proxy"),
    );
    btn?.click();
  });
  await page.waitForSelector("#add-proxy-form", { timeout: 5000 });
  const dForm = await page.evaluate(() => {
    const form = document.querySelector("#add-proxy-form");
    return {
      hasPurchase: Boolean(
        form?.querySelector('select[name="purchaseSourceDolphinId"]'),
      ),
      ip: form?.querySelector('input[name="ip"]')?.value ?? null,
    };
  });
  ok("Dolphin create form has no purchase source", !dForm.hasPurchase && dForm.ip === "", JSON.stringify(dForm));
  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 300));

  await page.screenshot({
    path: path.join(MEDIA, "proxies-dolphin-tab.png"),
    fullPage: false,
  });
  ok("screenshot proxies-dolphin-tab.png", true);

  // --- Dolphin page Proxy column ---
  await page.goto(`${BASE}/dolphin`, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });
  await page.waitForSelector("table", { timeout: 15000 });

  const dolphinHeaders = await page.$$eval("thead th", (ths) =>
    ths.map((th) => th.textContent.trim()).filter(Boolean),
  );
  ok(
    "Dolphin page Proxy column present",
    dolphinHeaders[0] === "Account name" && dolphinHeaders[1] === "Proxy",
    dolphinHeaders.join(" | "),
  );

  const dolphinRows = await page.evaluate(() =>
    Array.from(document.querySelectorAll("tbody tr")).map((r) => {
      const tds = r.querySelectorAll("td");
      return {
        account: tds[0]?.textContent.trim(),
        proxy: tds[1]?.innerText.trim(),
      };
    }),
  );
  ok(
    "gamma-sol shows connection proxy IP",
    dolphinRows.some(
      (r) => r.account === "gamma-sol" && r.proxy.includes("198.51.100.80"),
    ),
    JSON.stringify(dolphinRows),
  );
  ok(
    "Purchase hub shows purchase-source count",
    dolphinRows.some(
      (r) =>
        r.account === "Purchase hub" &&
        /Purchase source for \d+ VM prox/.test(r.proxy),
    ),
    JSON.stringify(dolphinRows),
  );

  await page.screenshot({
    path: path.join(MEDIA, "dolphin-proxy-column.png"),
    fullPage: false,
  });
  ok("screenshot dolphin-proxy-column.png", true);

  // Machines rotate list should not include Dolphin-kind proxies
  await page.goto(`${BASE}/machines`, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });
  await page.waitForSelector("table", { timeout: 15000 });
  // Open first machine that has Rotate if available — soft check via page source of available proxies is hard.
  // Confirm Dolphin proxy IP is not listed as available in rotate dialog when opened from an active machine.
  const opened = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      /rotate/i.test(b.textContent || ""),
    );
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
  if (opened) {
    await new Promise((r) => setTimeout(r, 500));
    const opts = await page.evaluate(() =>
      Array.from(document.querySelectorAll("select option")).map((o) =>
        o.textContent.trim(),
      ),
    );
    ok(
      "machine rotate options exclude Dolphin-kind IP",
      !opts.some((t) => t.includes("198.51.100.80")),
      opts.slice(0, 8).join(" | "),
    );
  } else {
    ok("machine rotate dialog (skipped — no rotate button)", true, "soft");
  }
} catch (err) {
  ok("script error", false, String(err));
  console.error(err);
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exit(1);
