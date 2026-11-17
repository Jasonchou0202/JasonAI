// 开票状态配色预览（演示账本）：node scripts/invoice-status-preview-shots.mjs [base]
import { chromium } from "playwright";
import { mkdir, readdir, unlink } from "node:fs/promises";

const base = process.argv[2] || "http://127.0.0.1:5191/JasonAI/";
const out = "/workspace/review/invoice-status-1117";
await mkdir(out, { recursive: true });
for (const name of await readdir(out)) {
  if (name.endsWith(".png")) await unlink(`${out}/${name}`);
}
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
async function open(view, hash, tag) {
  const context = await browser.newContext({
    viewport: { width: view.w, height: view.h },
    isMobile: !!view.mobile,
    hasTouch: !!view.mobile,
    deviceScaleFactor: 2,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(tag + ": " + e));
  await page.goto(`${base}?expense-preview=reset#${hash}`, { waitUntil: "networkidle" });
  return { page, context };
}
try {
  {
    const { page, context } = await open({ w: 1280, h: 900 }, "/invoices", "desk");
    await page.waitForSelector("h1:text('开票')", { timeout: 20000 });
    await page.waitForSelector(".inv-status-select.s-awaiting_info", { timeout: 10000 });
    await page.waitForSelector(".inv-status-select.s-pending", { timeout: 10000 });
    await page.waitForSelector(".inv-status-select.s-issued", { timeout: 10000 });
    await page.waitForSelector(".inv-status-select.s-sent", { timeout: 10000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/01-开票页-电脑1280.png`, fullPage: true });
    await context.close();
  }
  {
    const { page, context } = await open({ w: 390, h: 844, mobile: true }, "/invoices", "phone");
    await page.waitForSelector(".inv-row", { timeout: 20000 });
    await page.waitForSelector(".inv-status-select.s-sent", { timeout: 10000 });
    // 手机页脚里的完整导航会把全页截图拉得很长，预览只留开票内容
    await page.locator(".footer-workspace").evaluate((el) => { el.style.display = "none"; });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/02-开票页-iPhone390.png`, fullPage: true });
    await context.close();
  }
} finally {
  await browser.close();
}
if (errors.length) {
  console.error(JSON.stringify({ errors }, null, 1));
  process.exit(1);
}
console.log("ok", out);
