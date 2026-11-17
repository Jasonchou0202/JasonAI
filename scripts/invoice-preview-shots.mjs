// 开票管理示例数据预览图（只用演示账本里的虚构数据）：node scripts/invoice-preview-shots.mjs [base]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const base = process.argv[2] || "http://127.0.0.1:5191/JasonAI/";
const out = "/workspace/review/invoice-1117";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const report = [];
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
async function overflow(page, tag) {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  report.push({ tag, scrollWidth: w[0], viewport: w[1], overflow: w[0] > w[1] });
}
const DESK = { w: 1280, h: 900 };
const PHONE = { w: 390, h: 844, mobile: true };
try {
  {
    const { page, context } = await open(DESK, "/invoices", "desk-invoices");
    await page.waitForSelector("h1:text('开票')", { timeout: 20000 });
    await page.waitForSelector(".inv-row", { timeout: 10000 });
    await page.waitForTimeout(400);
    await overflow(page, "01");
    await page.screenshot({ path: `${out}/01-开票页-电脑1280.png`, fullPage: true });
    await context.close();
  }
  {
    const { page, context } = await open(DESK, "/customer?id=demo-c-qinghe&month=all", "desk-card");
    await page.waitForSelector(".inv-card", { timeout: 20000 });
    await page.waitForTimeout(400);
    await page.locator(".inv-card").scrollIntoViewIfNeeded();
    await overflow(page, "02");
    await page.screenshot({ path: `${out}/02-客户卡开票信息-资料齐-电脑1280.png`, fullPage: false });
    await page.goto(`${base}#/customer?id=demo-c-mumu&month=all`, { waitUntil: "networkidle" });
    await page.waitForSelector(".inv-card .inv-badge.missing", { timeout: 20000 });
    await page.locator(".inv-card").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/03-客户卡开票信息-缺资料-电脑1280.png`, fullPage: false });
    await context.close();
  }
  {
    const { page, context } = await open(DESK, "/details?from=2026-11-01&to=2026-11-10", "desk-details");
    await page.waitForSelector(".inv-sale-slot", { timeout: 20000 });
    await page.waitForSelector(".inv-chip", { timeout: 10000 });
    await page.waitForTimeout(400);
    await overflow(page, "04");
    await page.screenshot({ path: `${out}/04-销售明细开票栏-电脑1280.png`, fullPage: false });
    // 打开一笔的开票录入（电脑）
    await page.locator(".inv-switch-status").first().click();
    await page.waitForSelector("dialog.modal .inv-steps", { timeout: 10000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/05-开票录入-电脑1280.png`, fullPage: false });
    await context.close();
  }
  {
    const { page, context } = await open(PHONE, "/invoices", "phone-invoices");
    await page.waitForSelector(".inv-row", { timeout: 20000 });
    await page.waitForTimeout(400);
    await overflow(page, "06");
    await page.screenshot({ path: `${out}/06-开票页-iPhone390-首屏.png`, fullPage: false });
    await page.locator(".inv-row.s-pending").first().scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 260));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/06b-开票页-iPhone390-下滑.png`, fullPage: false });
    await page.evaluate(() => window.scrollTo(0, 0));
    // 已开票那笔：录入页（发票号码、日期、原件）
    await page.locator(".inv-row.s-issued .inv-row-main").first().click();
    await page.waitForSelector("dialog.modal #inv-no", { timeout: 10000 });
    await page.waitForTimeout(300);
    await overflow(page, "07");
    await page.screenshot({ path: `${out}/07-开票录入-已开票-iPhone390.png`, fullPage: false });
    await page.locator("dialog.modal button[aria-label='关闭']").click();
    await page.locator(".inv-row.s-sent .inv-row-main").first().click();
    await page.waitForSelector("dialog.modal #inv-sent", { timeout: 10000 });
    await page.locator("dialog.modal .modal-inner").evaluate((el) => el.scrollIntoView({ block: "end" }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/08-开票录入-已寄出-iPhone390.png`, fullPage: false });
    await context.close();
  }
  {
    const { page, context } = await open(PHONE, "/customer?id=demo-c-mumu&month=all", "phone-card");
    await page.waitForSelector(".inv-card", { timeout: 20000 });
    await page.locator(".inv-card").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await overflow(page, "09");
    await page.screenshot({ path: `${out}/09-客户卡开票信息-缺资料-iPhone390.png`, fullPage: false });
    await page.locator(".inv-card button:has-text('开票信息')").click();
    await page.waitForSelector("dialog.modal .inv-seg", { timeout: 10000 });
    await page.waitForTimeout(300);
    await overflow(page, "10");
    await page.screenshot({ path: `${out}/10-开票信息录入-逐项填写-iPhone390.png`, fullPage: false });
    await page.locator("dialog.modal .inv-seg button:has-text('粘贴文字')").click();
    await page.locator("#inv-profile-text").fill("名称：示例 · 木木设计工作室\n税号：92330100MA2DEMO03Z\n收票邮箱：mumu@example.com");
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${out}/11-开票信息录入-粘贴文字-iPhone390.png`, fullPage: false });
    await page.locator("dialog.modal button:has-text('保存')").click();
    await page.waitForSelector(".inv-card .inv-badge.ok", { timeout: 10000 });
    await page.locator(".inv-card").scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/12-保存后资料齐-iPhone390.png`, fullPage: false });
    await context.close();
  }
  {
    const { page, context } = await open(PHONE, "/details?from=2026-11-01&to=2026-11-10", "phone-details");
    await page.waitForSelector(".inv-sale-slot", { timeout: 20000 });
    await page.waitForTimeout(400);
    await overflow(page, "13");
    await page.screenshot({ path: `${out}/13-销售明细开票栏-iPhone390.png`, fullPage: false });
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify({ report, errors }, null, 1));
