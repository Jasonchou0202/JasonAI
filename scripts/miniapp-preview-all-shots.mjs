import { chromium } from "playwright";
import { mkdir, rm, copyFile } from "node:fs/promises";

const origin = process.env.PREVIEW_ORIGIN || "http://127.0.0.1:5182/JasonAI/";
const out = process.env.PREVIEW_OUT || "/workspace/review/miniapp-all";
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const errors = [];
const shots = [
  { name: "01-看板-首屏", tool: "miniapp-preview", page: "pages/home/index" },
  { name: "02-记一笔", tool: "miniapp-preview", page: "pages/sale/index", long: true, act: async (p) => { const pill = p.locator(".pill").first(); if (await pill.count()) await pill.click(); } },
  { name: "03-销售明细", tool: "miniapp-preview", page: "pages/details/index", long: true },
  { name: "04-我的", tool: "miniapp-preview", page: "pages/me/index" },
  { name: "05-更多", tool: "miniapp-preview-b2", page: "pkg2/hub/index" },
  { name: "06-报销记账", tool: "miniapp-preview-b2", page: "pkg2/expenses/index", long: true },
  { name: "07-开票", tool: "miniapp-preview-b2", page: "pkg2/invoices/index", long: true },
  { name: "08-成员管理", tool: "miniapp-preview-b2", page: "pkg2/members/index", long: true },
];

for (const s of shots) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(s.name + ": " + e.message));
  const url = `${origin}tools/${s.tool}/index.html?page=${s.page}${s.long ? "&long=1" : ""}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  if (s.act) {
    await s.act(page);
    await page.waitForTimeout(500);
  }
  const err = await page.locator(".err, .error").allTextContents();
  if (err.some((t) => t.trim())) errors.push(s.name + " 页面报错：" + err.join(" / "));
  await page.screenshot({ path: `${out}/${s.name}.png`, fullPage: !!s.long });
  await ctx.close();
  console.log("shot", s.name);
}
await browser.close();
if (errors.length) {
  console.error("页面错误：\n" + errors.join("\n"));
  process.exit(1);
}
console.log(`✓ ${shots.length} 张预览图 → ${out}`);
