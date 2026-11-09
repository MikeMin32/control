/**
 * Browser smoke: create forms start empty; no placeholders.
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
  ok("login", true);

  await page.goto(`${BASE}/machines`, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector("table", { timeout: 15000 });

  const searchPh = await page.$eval(
    'input[aria-label="Search machines"]',
    (el) => el.getAttribute("placeholder"),
  );
  ok("machines search has no placeholder", !searchPh, String(searchPh));

  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent.includes("Add VM"),
    );
    btn?.click();
  });
  await page.waitForSelector("#add-vm-form", { timeout: 5000 });

  const addVm = await page.evaluate(() => {
    const form = document.querySelector("#add-vm-form");
    const vals = {};
    for (const el of form.querySelectorAll("input, select, textarea")) {
      if (!el.name || el.type === "hidden") continue;
      vals[el.name] = el.value;
    }
    const placeholders = Array.from(
      form.querySelectorAll("[placeholder]"),
    ).map((el) => `${el.name || el.tagName}:${el.getAttribute("placeholder")}`);
    const statusOpts = Array.from(
      form.querySelectorAll('select[name="lifecycleStatus"] option'),
    ).map((o) => o.value);
    return { vals, placeholders, statusOpts };
  });

  ok(
    "Add VM fields start empty",
    !addVm.vals.vmid &&
      !addVm.vals.displayName &&
      !addVm.vals.serverId &&
      !addVm.vals.companyId &&
      !addVm.vals.lifecycleStatus &&
      !addVm.vals.internalIp &&
      !addVm.vals.os &&
      !addVm.vals.notes,
    JSON.stringify(addVm.vals),
  );
  ok(
    "Add VM has no placeholders",
    addVm.placeholders.length === 0,
    addVm.placeholders.join(", "),
  );
  ok(
    "Add VM status blank then Preparing|Active|Burned",
    addVm.statusOpts[0] === "" &&
      addVm.statusOpts.slice(1).join(",") === "PREPARING,ACTIVE,BURNED",
    addVm.statusOpts.join(","),
  );

  await page.screenshot({
    path: path.join(MEDIA, "form-empty-defaults.png"),
    fullPage: false,
  });
  ok("screenshot form-empty-defaults.png", true);

  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 300));

  await page.goto(`${BASE}/dolphin`, { waitUntil: "networkidle2", timeout: 60000 });
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent.includes("Add account"),
    );
    btn?.click();
  });
  await page.waitForSelector("#add-dolphin-form", { timeout: 5000 });
  const dolphin = await page.evaluate(() => {
    const form = document.querySelector("#add-dolphin-form");
    const vals = {};
    for (const el of form.querySelectorAll("input, select, textarea")) {
      if (!el.name) continue;
      vals[el.name] = el.value;
    }
    const placeholders = Array.from(
      form.querySelectorAll("[placeholder]"),
    ).map((el) => el.getAttribute("placeholder"));
    return { vals, placeholders };
  });
  ok(
    "Add Dolphin fields start empty (no TRC20)",
    !dolphin.vals.accountName &&
      !dolphin.vals.machineId &&
      !dolphin.vals.wallet &&
      !dolphin.vals.walletAddress &&
      !dolphin.vals.network &&
      !dolphin.vals.notes,
    JSON.stringify(dolphin.vals),
  );
  ok(
    "Add Dolphin has no placeholders",
    dolphin.placeholders.length === 0,
    dolphin.placeholders.join(", "),
  );

  await page.keyboard.press("Escape");
  await page.goto(`${BASE}/proxies`, { waitUntil: "networkidle2", timeout: 60000 });
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent.includes("Add proxy"),
    );
    btn?.click();
  });
  await page.waitForSelector("#add-proxy-form", { timeout: 5000 });
  const proxy = await page.evaluate(() => {
    const form = document.querySelector("#add-proxy-form");
    const placeholders = Array.from(
      form.querySelectorAll("[placeholder]"),
    ).map((el) => el.getAttribute("placeholder"));
    const ip = form.querySelector('input[name="ip"]')?.value;
    return { placeholders, ip };
  });
  ok("Add proxy no placeholders / empty IP", proxy.placeholders.length === 0 && !proxy.ip, JSON.stringify(proxy));
} catch (err) {
  ok("script error", false, String(err));
  console.error(err);
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exit(1);
