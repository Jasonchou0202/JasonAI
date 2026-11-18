// 小程序第 2 批预览图（iPhone 宽度 390，只用示例数据）。先 npx vite --port 5181，再 node scripts/miniapp-preview-b2-shots.mjs
// 输出目录每次先清空，只保留最新一版。
import { chromium } from "playwright";
import { mkdir, rm } from "node:fs/promises";

const base = (process.env.PREVIEW_BASE || "http://127.0.0.1:5181/JasonAI/") + "tools/miniapp-preview-b2/index.html";
const out = process.env.PREVIEW_OUT || "/workspace/review/miniapp-batch2";
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
/** 按客户名找编号再打开（示例账本每次重新生成） */
const byCustomer = (path, name, key = "id") => async (p) => {
  const id = await p.evaluate(async (n) => (await window.__mp.call("customers.list", {})).data.find((c) => c.name === n && !c.mergedInto)?.id, name);
  await p.evaluate((u) => window.__mp.open(u), `/${path}?${key}=${id}`);
};
const shots = [
  { name: "01-更多-管理员", page: "pkg2/hub/index" },
  { name: "02-报销记账", page: "pkg2/expenses/index", long: true },
  { name: "03-记一笔报销", page: "pkg2/expenses/form", long: true },
  { name: "04-报销待确认", page: "pkg2/expenses/pending", long: true },
  { name: "05-报销分类", page: "pkg2/expenses/categories", long: true },
  { name: "06-开票", page: "pkg2/invoices/index", long: true },
  { name: "07-开票详情-已寄出", page: "pkg2/invoices/edit", q: "saleId=n1o-0", long: true },
  { name: "08-开票详情-待开票", page: "pkg2/invoices/edit", q: "saleId=n1o-2", long: true },
  { name: "09-客户开票资料", page: "pkg2/invoices/profile", long: true, act: byCustomer("pkg2/invoices/profile", "示例公司 · 远山科技", "customerId") },
  { name: "10-客户详情", page: "pkg2/hub/index", long: true, act: byCustomer("pkg2/customer/detail", "示例公司 · 青禾文化") },
  { name: "11-客户合并与别名", page: "pkg2/hub/index", long: true, act: byCustomer("pkg2/customer/merge", "示例公司 · 青禾文化") },
  { name: "12-回收站", page: "pkg2/trash/index", long: true },
  { name: "13-导出CSV", page: "pkg2/export/index", long: true },
  { name: "14-成员管理", page: "pkg2/members/index", long: true },
  { name: "15-成员管理-生成邀请", page: "pkg2/members/index", long: true, act: async (p) => { await p.locator("input").first().fill("示例 · 小周"); await p.locator("input").first().dispatchEvent("input"); await p.getByText("生成邀请", { exact: true }).click(); } },
  { name: "16-操作日志", page: "pkg2/audit/index", long: true },
  { name: "17-经营图表", page: "pkg2/charts/index", long: true },
  { name: "18-成员视角-更多", page: "pkg2/hub/index", role: "member" },
  { name: "19-成员视角-报销", page: "pkg2/expenses/index", role: "member", long: true },
  { name: "20-成员视角-我的操作记录", page: "pkg2/audit/index", role: "member", long: true },
];
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "zh-CN", timezoneId: "Asia/Shanghai", isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(s.name + ": " + e.message));
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(s.name + " console: " + m.text()));
  const url = `${base}?page=${s.page}${s.q ? "&q=" + encodeURIComponent(s.q) : ""}${s.role ? "&role=" + s.role : ""}${s.long ? "&long=1" : ""}`;
  await page.goto(url);
  await page.waitForTimeout(1500);
  if (s.act) {
    await s.act(page);
    await page.waitForTimeout(1200);
  }
  const err = await page.locator(".error").allTextContents();
  if (err.some((t) => t.trim())) errors.push(s.name + " 页面报错：" + err.join(" / "));
  await page.screenshot({ path: `${out}/${s.name}.png`, fullPage: !!s.long });
  await ctx.close();
}
await browser.close();
if (errors.length) {
  console.error("页面错误：\n" + errors.join("\n"));
  process.exit(1);
}
console.log(`✓ ${shots.length} 张预览图 → ${out}`);
