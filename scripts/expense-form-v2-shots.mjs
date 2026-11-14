import { chromium } from "playwright";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";

const base = process.env.PREVIEW_BASE || "http://127.0.0.1:5179/JasonAI/";
const out = "/workspace/review/expense-form-v2-1115";
const AS_OF = "2026-11-15";
await mkdir(out, { recursive: true });
for (const name of await readdir(out)) if (name.endsWith(".png")) await rm(`${out}/${name}`);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];

// 假凭证：一张示例支付截图（PNG）、一份示例发票（PDF）、一张 HEIC（只看文件名和图标）
const fakeDir = "/tmp/expense-v2-fakes";
await mkdir(fakeDir, { recursive: true });
{
  const p = await browser.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1 });
  await p.setContent(`<body style="margin:0;font-family:sans-serif;background:#f5f5f7">
    <div style="background:#d97757;color:#fff;padding:28px 20px;font-size:22px">支付成功 · 示例</div>
    <div style="padding:40px 20px;text-align:center;font-size:44px;font-weight:700">¥1,280.00</div>
    <div style="margin:0 20px;background:#fff;border-radius:12px;padding:16px;color:#555;line-height:2">示例商户<br>示例凭证 · 非真实数据</div></body>`);
  await p.screenshot({ path: `${fakeDir}/支付截图-示例.png` });
  await p.close();
}
await writeFile(`${fakeDir}/发票-示例.pdf`, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
await writeFile(`${fakeDir}/IMG_0815-示例.heic`, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(16)]));

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
async function open(context, hash, tag) {
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${tag}: ${e}`));
  await page.clock.install({ time: new Date(`${AS_OF}T04:00:00.000Z`) });
  await page.goto(`${base}?expense-preview=reset#${hash}`, { waitUntil: "networkidle" });
  return page;
}
async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}
async function fillForm(page) {
  await page.waitForSelector("h1:text('记一笔报销')", { timeout: 20000 });
  await page.fill("#exp-amount", "1280");
  await page.getByRole("button", { name: "话费", exact: true }).click();
  await page.locator('input[aria-label="上传发票"]').setInputFiles(`${fakeDir}/发票-示例.pdf`);
  await page.locator('input[aria-label="支付凭证"]').setInputFiles([`${fakeDir}/支付截图-示例.png`, `${fakeDir}/IMG_0815-示例.heic`]);
  await page.fill("#exp-note", "十一月话费 · 示例");
  await page.waitForTimeout(300);
}
const results = [];
async function shot(page, name, opts = {}) {
  await page.screenshot({ path: `${out}/${name}`, ...opts });
  results.push(name);
}
try {
  // 记一笔：桌面 1440
  {
    const ctx = await contextOf({ width: 1440, height: 1000 });
    const page = await open(ctx, "/expense-entry", "form-desktop");
    await fillForm(page);
    await shot(page, "01-记一笔-桌面1440-已选文件.png", { fullPage: true });
    await page.locator(".exp-fields").screenshot({ path: `${out}/02-金额¥输入-桌面1440.png` });
    results.push("02");
    await page.locator(".exp-block").first().screenshot({ path: `${out}/03-分类选区-桌面1440.png` });
    results.push("03");
    results.push({ desktopOverflow: await overflow(page), amountPad: await page.evaluate(() => {
      const pre = document.querySelector(".exp-amount-prefix").getBoundingClientRect();
      const inp = document.querySelector("#exp-amount").getBoundingClientRect();
      return { prefixRight: pre.right, inputLeft: inp.left };
    }) });
    await ctx.close();
  }
  // 记一笔：iPhone 390
  {
    const ctx = await contextOf({ width: 390, height: 844, mobile: true });
    const page = await open(ctx, "/expense-entry", "form-mobile");
    await fillForm(page);
    // 手机底部有固定导航，整页截图会把它叠在中间；改成两屏视口截图
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    await shot(page, "04a-记一笔-iPhone390-上半屏.png");
    await page.evaluate(() => {
      const el = document.querySelector(".exp-receipts");
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70);
    });
    await page.waitForTimeout(200);
    await shot(page, "04b-记一笔-iPhone390-凭证已选与提交.png");
    await page.locator(".exp-fields").screenshot({ path: `${out}/05-金额¥输入-iPhone390.png` });
    await page.locator(".exp-block").first().screenshot({ path: `${out}/06-分类选区-iPhone390.png` });
    results.push({ mobileOverflow: await overflow(page), amountPad: await page.evaluate(() => {
      const pre = document.querySelector(".exp-amount-prefix").getBoundingClientRect();
      const inp = document.querySelector("#exp-amount").getBoundingClientRect();
      return { prefixRight: pre.right, inputLeft: inp.left };
    }) });
    await ctx.close();
  }
  // 合账页：11/1–11/20 已出账合计
  {
    const ctx = await contextOf({ width: 1440, height: 1200 });
    const page = await open(ctx, "/expenses", "settle-desktop");
    await page.waitForSelector("h1:text('报销记账')", { timeout: 20000 });
    await page.waitForTimeout(300);
    await page.locator(".exp-posted").screenshot({ path: `${out}/07-合账-已出账合计-桌面1440.png` });
    await shot(page, "08-合账页-全页-桌面1440.png", { fullPage: true });
    await ctx.close();
  }
  {
    const ctx = await contextOf({ width: 390, height: 844, mobile: true });
    const page = await open(ctx, "/expenses", "settle-mobile");
    await page.waitForSelector("h1:text('报销记账')", { timeout: 20000 });
    await page.waitForTimeout(300);
    await page.locator(".exp-overview").screenshot({ path: `${out}/09-合账-三段与合计-iPhone390.png` });
    await shot(page, "10-合账页-全页-iPhone390.png", { fullPage: true });
    results.push({ settleMobileOverflow: await overflow(page) });
    await ctx.close();
  }
  // 看板十天应得（口径一致）
  for (const [w, h, mobile, name] of [[1440, 1000, false, "11-看板十天应得-桌面1440.png"], [390, 844, true, "12-看板十天应得-iPhone390.png"]]) {
    const ctx = await contextOf({ width: w, height: h, mobile });
    const page = await open(ctx, "/dashboard", name);
    await page.waitForSelector("h2:text('十天应得利润')", { timeout: 20000 });
    await page.locator("section.exp-shares").screenshot({ path: `${out}/${name}` });
    results.push(name);
    await ctx.close();
  }
} catch (e) {
  errors.push(String(e));
  console.error(e);
}
await browser.close();
console.log(JSON.stringify({ results, errors }, null, 2));
if (errors.length) process.exit(1);
