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

async function shot(name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log("wrote", file);
}

await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
await shot("01-login");

await page.type('input[name="email"]', "admin@example.com");
await page.type('input[name="password"]', "changeme-admin-pass");
await Promise.all([
  page.click('button[type="submit"]'),
  page.waitForNavigation({ waitUntil: "networkidle0" }),
]);
await shot("02-machines");

await page.goto(`${BASE}/proxies`, { waitUntil: "networkidle0" });
await shot("03-proxies");

await page.goto(`${BASE}/wipeout`, { waitUntil: "networkidle0" });
await shot("04-wipeout");

await page.goto(`${BASE}/archive`, { waitUntil: "networkidle0" });
await shot("05-archive");

await page.goto(`${BASE}/settings`, { waitUntil: "networkidle0" });
await shot("06-settings");

await browser.close();
console.log("smoke screenshots done");
