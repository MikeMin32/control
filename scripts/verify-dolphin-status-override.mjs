/**
 * Browser smoke + screenshots for Dolphin / Add-VM status / checklist override.
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
  ok("login", page.url().includes("/machines"), page.url());

  // Sidebar Dolphin between Machines and Proxies
  const nav = await page.$$eval("aside a, nav a", (els) =>
    els.map((e) => ({ href: e.getAttribute("href"), text: e.textContent.trim() })),
  );
  const labels = nav.map((n) => n.text);
  const mIdx = labels.indexOf("Machines");
  const dIdx = labels.indexOf("Dolphin");
  const pIdx = labels.indexOf("Proxies");
  ok(
    "sidebar Dolphin between Machines and Proxies",
    dIdx > -1 && mIdx > -1 && pIdx > -1 && mIdx < dIdx && dIdx < pIdx,
    labels.join(" | "),
  );

  await page.goto(`${BASE}/dolphin`, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector("table", { timeout: 15000 });
  const dolphinHeaders = await page.$$eval("thead th", (ths) =>
    ths.map((th) => th.textContent.trim()).filter(Boolean),
  );
  ok(
    "Dolphin columns",
    dolphinHeaders.includes("Account name") &&
      dolphinHeaders.includes("Linked VM") &&
      dolphinHeaders.includes("Crypto wallet"),
    dolphinHeaders.join(" | "),
  );
  const hasAccount = await page.$$eval("tbody tr", (rows) =>
    rows.some((r) => (r.textContent || "").includes("alpha-eth")),
  );
  ok("seeded Dolphin account visible", hasAccount);
  await page.screenshot({
    path: path.join(MEDIA, "dolphin.png"),
    fullPage: false,
  });

  // Add VM status selector
  await page.goto(`${BASE}/machines`, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector("table", { timeout: 15000 });
  const statusOptions = await page.$$eval(
    'select[value], select',
    (sels) => {
      const filter = sels.find((s) =>
        Array.from(s.options).some((o) => o.value === "ALL"),
      );
      return filter
        ? Array.from(filter.options).map((o) => o.textContent.trim())
        : [];
    },
  );
  ok(
    "status filter has no Expired",
    statusOptions.length > 0 && !statusOptions.includes("Expired"),
    statusOptions.join(", "),
  );

  const clickedAdd = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent.includes("Add VM"),
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  ok("Add VM button", clickedAdd);
  if (clickedAdd) {
    await page.waitForSelector("#add-vm-form", { timeout: 5000 });
    const createStatuses = await page.$eval(
      '#add-vm-form select[name="lifecycleStatus"]',
      (sel) =>
        Array.from(sel.options).map((o) => ({
          value: o.value,
          text: o.textContent.trim(),
          disabled: sel.disabled,
        })),
    );
    ok(
      "Add VM status Preparing|Active|Burned enabled",
      !createStatuses[0]?.disabled &&
        createStatuses.map((o) => o.value).join(",") ===
          "PREPARING,ACTIVE,BURNED" &&
        !createStatuses.some((o) => o.value === "EXPIRED"),
      JSON.stringify(createStatuses),
    );
    await page.screenshot({
      path: path.join(MEDIA, "add-vm-status.png"),
      fullPage: false,
    });
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 400));
  }

  // Open a Preparing VM (prefer staging-beta) and trigger override dialog
  const opened = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tbody tr"));
    const prep =
      rows.find((r) => /Preparing|staging/i.test(r.textContent || "")) ||
      rows[0];
    if (!prep) return false;
    const view = Array.from(prep.querySelectorAll("button")).find((b) =>
      b.textContent.includes("View"),
    );
    if (!view) return false;
    view.click();
    return true;
  });
  ok("opened machine drawer", opened);
  await new Promise((r) => setTimeout(r, 800));

  await page.evaluate(() => {
    const tab = Array.from(document.querySelectorAll("button")).find((b) =>
      /^Setup$/.test(b.textContent.trim()),
    );
    tab?.click();
  });
  await new Promise((r) => setTimeout(r, 600));

  const finishClicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent.includes("Finish setup"),
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  ok("Finish setup available on open checklist", finishClicked);
  if (finishClicked) {
    await page.waitForFunction(
      () =>
        document.body.innerText.includes("Complete with unfinished tasks") ||
        document.body.innerText.includes("Ready to finish"),
      { timeout: 8000 },
    ).catch(() => {});
    const overrideVisible = await page.evaluate(() =>
      document.body.innerText.includes("Complete with unfinished tasks"),
    );
    ok("override confirm dialog for unfinished setup", overrideVisible);
    await page.screenshot({
      path: path.join(MEDIA, "checklist-override.png"),
      fullPage: false,
    });
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent.includes("Go back"),
      );
      btn?.click();
    });
  }

  // Expired gone from edit lifecycle if drawer open
  const expiredInUi = await page.evaluate(() =>
    Array.from(document.querySelectorAll("option")).some(
      (o) => o.textContent.trim() === "Expired" && o.value === "EXPIRED",
    ),
  );
  ok("Expired not offered in visible selects", !expiredInUi);
} catch (err) {
  ok("script error", false, String(err));
  console.error(err);
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exit(1);
