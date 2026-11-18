// 小程序第 1 批预览图（iPhone 宽度 390，只用示例数据）。先 npx vite --port 5180，再 node scripts/miniapp-preview-shots.mjs
// 输出目录每次先清空，只保留最新一版。
import { chromium } from "playwright";
import { mkdir, rm } from "node:fs/promises";

const base = (process.env.PREVIEW_BASE || "http://127.0.0.1:5180/JasonAI/") + "tools/miniapp-preview/index.html";
const out = process.env.PREVIEW_OUT || "/workspace/review/miniapp-batch1";
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const shots = [
  { name: "01-看板-首屏", page: "pages/home/index" },
  { name: "02-看板-整页", page: "pages/home/index", long: true },
  { name: "03-看板-点选9月柱", page: "pages/home/index", act: async (p) => { const c = p.locator("#trend"); const b = await c.boundingBox(); await c.click({ position: { x: b.width * 0.26, y: b.height * 0.6 } }); } },
  { name: "04-看板-每日走势", page: "pages/home/index", act: async (p) => p.getByText("每日", { exact: true }).click() },
  { name: "05-记一笔", page: "pages/sale/index", long: true, act: async (p) => p.locator(".pill").first().click() },
  { name: "06-记一笔-顺手建日程", page: "pages/sale/index", long: true, act: async (p) => { await p.locator(".pill").nth(1).click(); await p.locator(".field").nth(1).fill("示例客户 · 小"); await p.locator(".field").nth(1).dispatchEvent("input"); await p.locator(".mp-switch").click(); } },
  { name: "07-销售明细", page: "pages/details/index" },
  { name: "08-销售明细-筛选", page: "pages/details/index", act: async (p) => p.getByText("筛选", { exact: true }).click() },
  { name: "09-客户日程", page: "pages/calendar/index", long: true },
  { name: "10-客户日程-今日明日逾期", page: "pages/calendar/index", long: true, act: async (p) => p.getByText("今日 / 明日 / 逾期").click() },
  { name: "11-新建日程", page: "pages/task/index", q: "customer=" + encodeURIComponent("示例客户 · 小林") },
  { name: "12-铃铛-今日待办", page: "pages/bell/index" },
  { name: "13-我的", page: "pages/me/index" },
  { name: "14-成员申请", page: "pages/applications/index" },
  { name: "15-成员视角-明细", page: "pages/details/index", role: "member" },
];
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "zh-CN", timezoneId: "Asia/Shanghai", isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(s.name + ": " + e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(s.name + " console: " + m.text()));
  const url = `${base}?page=${s.page}${s.q ? "&q=" + encodeURIComponent(s.q) : ""}${s.role ? "&role=" + s.role : ""}${s.long ? "&long=1" : ""}`;
  await page.goto(url);
  await page.waitForTimeout(1500);
  if (s.act) {
    await s.act(page);
    await page.waitForTimeout(700);
  }
  await page.screenshot({ path: `${out}/${s.name}.png`, fullPage: !!s.long });
  await ctx.close();
}
await browser.close();
if (errors.length) {
  console.error("页面错误：\n" + errors.join("\n"));
  process.exit(1);
}
console.log(`✓ ${shots.length} 张预览图 → ${out}`);
