import { chromium } from "playwright";
import { mkdir, readdir, rm } from "node:fs/promises";

const base = process.env.PREVIEW_BASE || "http://127.0.0.1:5173/JasonAI/";
const out = "/workspace/review/split-start-preview-1114";
await mkdir(out, { recursive: true });
for (const name of await readdir(out)) {
  if (name.endsWith(".png")) await rm(`${out}/${name}`);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];

function attach(page, tag) {
  page.on("pageerror", (e) => errors.push(`${tag}: ${e}`));
}

async function contextOf({ width, height, mobile }) {
  return browser.newContext({
    viewport: { width, height },
    isMobile: !!mobile,
    hasTouch: !!mobile,
    deviceScaleFactor: 2,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  });
}

async function open(context, { hash, asOf, tag }) {
  const page = await context.newPage();
  attach(page, tag);
  if (asOf) await page.clock.install({ time: new Date(`${asOf}T04:00:00.000Z`) });
  await page.goto(`${base}?expense-preview=reset#${hash}`, { waitUntil: "networkidle" });
  return page;
}

const jobs = [
  { name: "01-看板三段-1114-mobile.png", width: 390, height: 1200, mobile: true, hash: "/dashboard", asOf: "2026-11-14", wait: "text=11 月 21 日起开始分成", scroll: "section.exp-shares" },
  { name: "02-看板三段-1114-desktop.png", width: 1440, height: 1100, mobile: false, hash: "/dashboard", asOf: "2026-11-14", wait: "text=11 月 21 日起开始分成", scroll: "section.exp-shares" },
  { name: "03-看板三段-1122-mobile.png", width: 390, height: 1200, mobile: true, hash: "/dashboard", asOf: "2026-11-22", wait: "h2:text('十天应得利润')", scroll: "section.exp-shares" },
  { name: "04-看板三段-1122-desktop.png", width: 1440, height: 1100, mobile: false, hash: "/dashboard", asOf: "2026-11-22", wait: "h2:text('十天应得利润')", scroll: "section.exp-shares" },
  { name: "05-记一笔-日期限制-mobile.png", width: 390, height: 844, mobile: true, hash: "/expense-entry", asOf: "2026-11-14", wait: "text=从 11 月 14 日起记" },
  { name: "06-记一笔-日期限制-desktop.png", width: 1440, height: 1100, mobile: false, hash: "/expense-entry", asOf: "2026-11-14", wait: "text=从 11 月 14 日起记" },
  { name: "07-报销记账-1114-mobile.png", width: 390, height: 1200, mobile: true, hash: "/expenses", asOf: "2026-11-14", wait: "h1:text('报销记账')" },
  { name: "08-报销记账-1114-desktop.png", width: 1440, height: 1400, mobile: false, hash: "/expenses", asOf: "2026-11-14", wait: "h1:text('报销记账')" },
  { name: "09-报销记账-1122-mobile.png", width: 390, height: 1200, mobile: true, hash: "/expenses", asOf: "2026-11-22", wait: "h1:text('报销记账')" },
  { name: "10-报销记账-1122-desktop.png", width: 1440, height: 1400, mobile: false, hash: "/expenses", asOf: "2026-11-22", wait: "h1:text('报销记账')" },
];

const results = [];
try {
  for (const job of jobs) {
    const context = await contextOf(job);
    const page = await open(context, job);
    await page.waitForSelector(job.wait, { timeout: 20000 });
    if (job.hash === "/dashboard") {
      await page.waitForSelector("h2:text('十天应得利润')", { timeout: 20000 });
    }
    if (job.scroll) {
      const el = page.locator(job.scroll).first();
      if (await el.count()) await el.scrollIntoViewIfNeeded();
    } else {
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    await page.waitForTimeout(400);
    const fullPage = job.hash === "/expenses";
    await page.screenshot({ path: `${out}/${job.name}`, fullPage });
    const min = job.hash === "/expense-entry" ? await page.locator("#exp-date").getAttribute("min") : null;
    results.push({ name: job.name, asOf: job.asOf, min });
    await context.close();
  }
} catch (e) {
  errors.push(String(e));
  console.error(e);
}
await browser.close();
console.log(JSON.stringify({ results, errors }, null, 2));
if (errors.length) process.exit(1);
