import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const base = "http://127.0.0.1:5173/JasonAI/";
const out = "/workspace/review/expense-local-preview-1114";
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];

function attach(page, tag) {
  page.on("pageerror", (e) => errors.push(tag + ": " + e));
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

const results = [];
try {
  // 1) 手机记一笔报销
  {
    const context = await contextOf({ width: 390, height: 844, mobile: true });
    const page = await context.newPage();
    attach(page, "form");
    await page.goto(`${base}?expense-preview=reset#/expense-entry`, { waitUntil: "networkidle" });
    await page.waitForSelector("h1:text('记一笔报销')", { timeout: 20000 });
    await page.locator("#exp-amount").fill("600");
    await page.getByRole("button", { name: /软件订阅/ }).click();
    await page.locator("#exp-note").fill("Claude、ChatGPT 十一月订阅");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("h1:text('记一笔报销')").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/01-记一笔报销-mobile.png`, fullPage: false });
    results.push({ name: "01", h1: await page.locator("h1").innerText() });
    await context.close();
  }
  // 2) 电脑生意看板
  {
    const context = await contextOf({ width: 1440, height: 1100, mobile: false });
    const page = await context.newPage();
    attach(page, "dash");
    await page.goto(`${base}?expense-preview=1#/dashboard`, { waitUntil: "networkidle" });
    await page.waitForSelector("h2:text('十天应得利润')", { timeout: 20000 });
    await page.waitForSelector("text=¥6,480", { timeout: 10000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/02-生意看板-desktop.png`, fullPage: false });
    results.push({ name: "02", shares: true });
    await context.close();
  }
  // 3) 电脑报销记账
  {
    const context = await contextOf({ width: 1440, height: 1400, mobile: false });
    const page = await context.newPage();
    attach(page, "ledger");
    await page.goto(`${base}?expense-preview=1#/expenses`, { waitUntil: "networkidle" });
    await page.waitForSelector("h1:text('报销记账')", { timeout: 20000 });
    await page.waitForSelector("text=已出账合计", { timeout: 10000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/03-报销记账-desktop.png`, fullPage: true });
    results.push({ name: "03" });
    await context.close();
  }
  // 4) 手机待确认
  {
    const context = await contextOf({ width: 390, height: 844, mobile: true });
    const page = await context.newPage();
    attach(page, "pending");
    await page.goto(`${base}?expense-preview=1#/expense-pending`, { waitUntil: "networkidle" });
    await page.waitForSelector("h1:text('待你确认')", { timeout: 20000 });
    await page.waitForSelector("text=确认入账", { timeout: 10000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/04-待确认-mobile.png`, fullPage: false });
    results.push({ name: "04" });
    await context.close();
  }
  // 5) 开关关闭
  {
    const context = await contextOf({ width: 1440, height: 900, mobile: false });
    const page = await context.newPage();
    attach(page, "off");
    await page.addInitScript(() => {
      sessionStorage.setItem("zhangyuge-demo", "true");
      sessionStorage.removeItem("zhangyuge-demo-expense");
      sessionStorage.removeItem("zhangyuge-demo-role");
    });
    await page.goto(`${base}#/dashboard`, { waitUntil: "networkidle" });
    await page.waitForSelector("h1:text('生意概览')", { timeout: 20000 });
    await page.waitForTimeout(500);
    const hasExpenseNav = await page.getByRole("button", { name: "报销记账" }).count();
    const hasShares = await page.locator("h2", { hasText: "十天应得利润" }).count();
    await page.screenshot({ path: `${out}/05-开关关闭-看板-desktop.png`, fullPage: false });
    results.push({ name: "05", hasExpenseNav, hasShares });
    await context.close();
  }
} catch (e) {
  errors.push(String(e));
  console.error(e);
}
await browser.close();
console.log(JSON.stringify({ results, errors }, null, 2));
