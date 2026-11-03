import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";

const BASE = process.env.APP_URL || "http://127.0.0.1:3001";
const OUT =
  process.env.SCREENSHOT_DIR ||
  "/home/mikemin/.local/state/cursor/agent-stores/cursor_agent_stores/bc-85821822-22a1-4f19-b3a1-5809c4a327cc/files/media";

fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1440,900"],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();
page.setDefaultNavigationTimeout(60000);

async function go(url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 600));
}

async function shot(name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log("wrote", file);
}

await go(`${BASE}/login`);
await shot("slate-01-login");

await page.type('input[name="email"]', "admin@example.com");
await page.type('input[name="password"]', "changeme-admin-pass");
await Promise.all([
  page.click('button[type="submit"]'),
  page.waitForNavigation({ waitUntil: "domcontentloaded" }),
]);
await new Promise((r) => setTimeout(r, 800));
await shot("slate-02-machines");

const clicked = await page.evaluate(() => {
  const tabs = [...document.querySelectorAll("button")];
  const t = tabs.find((b) => (b.textContent || "").includes("1tech2"));
  if (t) {
    t.click();
    return true;
  }
  return false;
});
if (clicked) {
  await new Promise((r) => setTimeout(r, 1200));
  await shot("slate-02b-machines-server-tab");
}

await go(`${BASE}/proxies`);
await shot("slate-03-proxies");

await go(`${BASE}/wipeout`);
await shot("slate-04-wipeout");

await go(`${BASE}/archive`);
await shot("slate-05-archive");

await go(`${BASE}/settings`);
await shot("slate-06-settings");

await browser.close();
console.log("smoke screenshots done");
