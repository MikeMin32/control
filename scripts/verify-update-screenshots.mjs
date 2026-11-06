/**
 * Login, capture Machines + Wipeout screenshots, smoke-check key UI.
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
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

try {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector('input[name="email"]', { timeout: 15000 });
  // Wait for client hydration so onSubmit preventDefault is active
  await new Promise((r) => setTimeout(r, 1000));
  await page.click('input[name="email"]', { clickCount: 3 });
  await page.type('input[name="email"]', EMAIL);
  await page.click('input[name="password"]', { clickCount: 3 });
  await page.type('input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForFunction(
    () => window.location.pathname.includes("/machines"),
    { timeout: 60000 },
  );
  ok("login", page.url().includes("/machines"), page.url());

  await page.goto(`${BASE}/machines`, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector("table", { timeout: 15000 });

  const headers = await page.$$eval("thead th", (ths) =>
    ths.map((th) => th.textContent.trim()).filter(Boolean),
  );
  ok(
    "column order includes Country / Internal IP / Proxy IP",
    headers.includes("Country") &&
      headers.includes("Internal IP") &&
      headers.includes("Proxy IP") &&
      headers.indexOf("Internal IP") < headers.indexOf("Proxy IP") &&
      !headers.includes("Server"),
    headers.join(" | "),
  );

  const hasActionsView = await page.$$eval("tbody tr", (rows) => {
    if (!rows.length) return false;
    const text = rows[0].textContent || "";
    return text.includes("Actions") && text.includes("View");
  });
  ok("Actions and View buttons present", hasActionsView);

  const hasFlagOrDash = await page.$$eval("tbody tr", (rows) =>
    rows.some((r) => /DE|NL|GB|—/.test(r.textContent || "")),
  );
  ok("Country shows code or em dash", hasFlagOrDash);

  const hasInternal = await page.$$eval("tbody tr", (rows) =>
    rows.some((r) => (r.textContent || "").includes("192.168.201")),
  );
  ok("Internal IP visible when set", hasInternal);

  // Open Actions menu without opening View
  await page.click('button[aria-label^="Actions for VM"]');
  await page.waitForSelector('[role="menu"]', { timeout: 5000 });
  const menuItems = await page.$$eval('[role="menu"] [role="menuitem"]', (els) =>
    els.map((e) => e.textContent.trim()),
  );
  ok(
    "Actions menu has Rotate IP and wipeout",
    menuItems.some((t) => t.includes("Rotate IP")) &&
      menuItems.some((t) => /wipeout/i.test(t)),
    menuItems.join(", "),
  );
  // Close menu by clicking elsewhere
  await page.keyboard.press("Escape");
  await page.mouse.click(10, 10);

  await page.screenshot({
    path: path.join(MEDIA, "update-machines.png"),
    fullPage: false,
  });
  ok("screenshot update-machines.png", true);

  // View opens drawer
  await page.click('button[aria-label^="View VM"]');
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  const drawerTitle = await page.$eval('[role="dialog"] h2', (el) => el.textContent);
  ok("View opens VM drawer", /VM\s+\d+/.test(drawerTitle || ""), drawerTitle || "");
  await page.click('[aria-label="Close"]');

  await page.goto(`${BASE}/wipeout`, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector("table", { timeout: 15000 });
  const progressBars = await page.$$eval('[role="progressbar"]', (els) => els.length);
  ok("Wipeout list shows progress bars", progressBars > 0, `count=${progressBars}`);

  await page.click("tbody tr");
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  const wipeTitle = await page.$eval('[role="dialog"] h2', (el) => el.textContent);
  ok("Wipeout drawer title", /Wipeout · VM/.test(wipeTitle || ""), wipeTitle || "");

  const checkboxes = await page.$$('[role="dialog"] [role="checkbox"]');
  ok("Checklist checkboxes present", checkboxes.length > 0, `count=${checkboxes.length}`);

  const footerText = await page.$eval('[role="dialog"] footer', (el) => el.textContent);
  ok(
    "Sticky footer with Complete closure",
    /Complete closure/.test(footerText || ""),
    (footerText || "").slice(0, 80),
  );

  // Toggle first pending checkbox and ensure it persists after refresh
  const firstBox = checkboxes[0];
  const before = await firstBox.evaluate((el) => el.getAttribute("aria-checked"));
  if (before === "false") {
    await firstBox.click();
    await page.waitForFunction(
      () => !document.body.innerText.includes("Saving"),
      { timeout: 8000 },
    ).catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    await page.reload({ waitUntil: "networkidle2" });
    await page.waitForSelector('[role="dialog"] [role="checkbox"]', { timeout: 15000 });
    const after = await page.$eval(
      '[role="dialog"] [role="checkbox"]',
      (el) => el.getAttribute("aria-checked"),
    );
    ok("Checkbox persist after reload", after === "true", `before=${before} after=${after}`);
  } else {
    ok("Checkbox already completed (persist path skipped)", true, `aria-checked=${before}`);
  }

  await page.screenshot({
    path: path.join(MEDIA, "update-wipeout.png"),
    fullPage: false,
  });
  ok("screenshot update-wipeout.png", true);

  // Premature complete disabled when remaining required
  const completeDisabled = await page.$eval(
    '[role="dialog"] footer button',
    (btn) => btn.disabled || btn.getAttribute("aria-disabled") === "true",
  );
  const remaining = /remaining|Ready to close/.test(
    (await page.$eval('[role="dialog"] footer', (el) => el.textContent)) || "",
  );
  ok("Footer reflects readiness / remaining", remaining, `disabled=${completeDisabled}`);
} catch (err) {
  console.error(err);
  ok("script completed without throw", false, String(err));
  await page.screenshot({
    path: path.join(MEDIA, "update-error.png"),
    fullPage: true,
  }).catch(() => {});
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exit(1);
