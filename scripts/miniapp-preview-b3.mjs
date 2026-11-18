// 小程序第 3 批页面的 iPhone 宽度预览图（只用示例数据）：把 WXML/WXSS 按小程序规则渲染成网页（1rpx = 390/750px），用 Playwright 截图。
// 用法：npm run build:server && node scripts/miniapp-preview-b3.mjs [输出目录]
// 这是排版预览，不是真机；真机效果以体验版为准。
import { readFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const OUT = process.argv[2] || "/workspace/review/miniapp-batch3";
const W = 390;
const RPX = W / 750;

// ---------- 极简 WXML 渲染器 ----------
function parse(src) {
  src = src.replace(/<!--[\s\S]*?-->/g, "");
  const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  const re = /<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[\w:.-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1]) stack.pop();
    else if (m[2]) {
      const attrs = {};
      for (const a of m[3].matchAll(/([\w:.-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? "";
      const node = { tag: m[2], attrs, children: [] };
      top.children.push(node);
      if (!m[4] && !["input", "image"].includes(m[2])) stack.push(node);
    } else if (m[5].trim()) top.children.push({ text: m[5] });
  }
  return root;
}
function evalExpr(expr, scope) {
  try {
    return Function("scope", `with (scope) { return (${expr}); }`)(scope);
  } catch {
    return "";
  }
}
function interp(s, scope) {
  const whole = s.match(/^\{\{([\s\S]+)\}\}$/);
  if (whole && s.indexOf("{{", 2) < 0) return evalExpr(whole[1], scope);
  return s.replace(/\{\{([\s\S]+?)\}\}/g, (_, e) => {
    const v = evalExpr(e, scope);
    return v === undefined || v === null ? "" : String(v);
  });
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const rpx = (s) => String(s).replace(/(-?\d*\.?\d+)rpx/g, (_, n) => `${+(n * RPX).toFixed(2)}px`);
const TAGS = { view: "div", text: "span", button: "button", image: "img", picker: "div", "scroll-view": "div", label: "label" };
function renderChildren(children, scope) {
  let out = "";
  let chain = null; // null: 不在 if 链；true: 链里已有分支命中；false: 还没命中
  for (const n of children) {
    if (n.text !== undefined) {
      out += esc(interp(n.text, scope));
      chain = null;
      continue;
    }
    const a = n.attrs;
    if ("wx:if" in a) {
      const ok = !!interp(a["wx:if"], scope);
      chain = ok;
      if (!ok) continue;
    } else if ("wx:elif" in a) {
      if (chain !== false) continue;
      const ok = !!interp(a["wx:elif"], scope);
      chain = ok;
      if (!ok) continue;
    } else if ("wx:else" in a) {
      const skip = chain !== false;
      chain = null;
      if (skip) continue;
    } else chain = null;
    if ("wx:for" in a) {
      const list = interp(a["wx:for"], scope) || [];
      const item = a["wx:for-item"] || "item";
      const index = a["wx:for-index"] || "index";
      const arr = Array.isArray(list) ? list : Object.values(list);
      arr.forEach((v, i) => (out += renderNode(n, Object.assign(Object.create(scope), { [item]: v, [index]: i }))));
    } else out += renderNode(n, scope);
  }
  return out;
}
function renderNode(n, scope) {
  if (n.tag === "block") return renderChildren(n.children, scope);
  if (["privacy-popup", "canvas", "checkbox"].includes(n.tag)) return "";
  const tag = TAGS[n.tag] || n.tag;
  let attrs = "";
  const a = n.attrs;
  if (a.class) attrs += ` class="${esc(interp(a.class, scope))}"`;
  if (a.style) attrs += ` style="${esc(rpx(interp(a.style, scope)))}"`;
  if (n.tag === "image") return `<img src="${esc(interp(a.src || "", scope))}" style="width:100%;height:100%;object-fit:cover"${attrs}>`;
  if (n.tag === "input") {
    const v = interp(a.value || "", scope);
    return `<div${attrs.replace('class="', 'class="wx-input ')}>${v !== "" && v !== undefined ? esc(v) : `<span class="ph">${esc(interp(a.placeholder || "", scope))}</span>`}</div>`;
  }
  if (n.tag === "button" && a.disabled && interp(a.disabled, scope)) attrs += " disabled";
  return `<${tag}${attrs}>${renderChildren(n.children, scope)}</${tag}>`;
}
function css(file, seen = new Set()) {
  if (seen.has(file)) return "";
  seen.add(file);
  return readFileSync(file, "utf8").replace(/@import\s+"([^"]+)";/g, (_, p) => css(join("miniprogram", p.replace(/^\//, "")), seen));
}

// ---------- 示例数据（全部虚构） ----------
const boardMod = await build({ entryPoints: ["server/miniapp/board.ts"], bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent" });
const { boardSummary } = await import("data:text/javascript;base64," + Buffer.from(boardMod.outputFiles[0].text).toString("base64"));
const board = boardSummary();
const maxStage = Math.max(1, ...board.stages.map((s) => s.count));
board.stages = board.stages.map((s) => ({ ...s, pct: Math.round((s.count / maxStage) * 100) }));

const SHOTS = [
  { file: "01-设置与更多-管理员", page: "pkg-settings/index/index", data: { admin: true, demo: null, error: "" } },
  { file: "02-设置与更多-成员", page: "pkg-settings/index/index", data: { admin: false, demo: null, error: "" } },
  {
    file: "03-导入Excel-预检",
    page: "pkg-settings/import/index",
    data: {
      busy: false, status: "", done: "", error: "", total: 0, percent: 0,
      preview: {
        fileName: "示例-飞书历史销售.xlsx", rows: 128, errors: 0, warnings: 1, duplicates: 3, already: false,
        issues: ["第 57 行：备注超过 200 字，已截断"], revenueText: "¥186,400", profitText: "¥98,250",
        months: [{ key: "2026-08", label: "2026-08", count: 41 }, { key: "2026-09", label: "2026-09", count: 46 }, { key: "2026-10", label: "2026-10", count: 41 }],
      },
    },
  },
  { file: "04-导入Excel-进行中", page: "pkg-settings/import/index", data: { busy: true, status: "已处理 80 / 128 条", total: 128, percent: 63, done: "", error: "", preview: { fileName: "示例-飞书历史销售.xlsx", rows: 128, errors: 0, warnings: 0, duplicates: 0, issues: [], revenueText: "¥186,400", profitText: "¥98,250", months: [] } } },
  {
    file: "05-备份与恢复",
    page: "pkg-settings/backup/index",
    data: { busy: "", status: "", percent: 0, exported: "备份已发出，请在聊天里保存好", restored: "", error: "", backup: { fileName: "章鱼哥账本备份-2026-11-18.json", exportedAt: "2026-11-18 09:30", sales: 243, products: 6, customers: 18, tasks: 16 } },
  },
  {
    file: "06-微信服务通知-已开放",
    page: "pkg-settings/notify/index",
    data: { enabled: true, admin: true, busy: false, ok: "已记下，到点会发到微信", error: "", kinds: [{ key: "task", title: "日程提醒", desc: "日程到点（或提前 15 分钟）发到微信", left: 3 }, { key: "apply", title: "新申请提醒", desc: "有人在小程序里申请使用时提醒你", left: 1 }] },
  },
  { file: "07-微信服务通知-未开放", page: "pkg-settings/notify/index", data: { enabled: false, admin: true, kinds: [], busy: false, ok: "", error: "" } },
  { file: "08-头像", page: "pkg-settings/avatar/index", data: { enabled: true, current: "", preview: "", initial: "林", busy: false, error: "" } },
  {
    file: "09-今日获客录入",
    page: "pkg-content/entry/index",
    data: {
      today: "2026-11-18", date: "2026-11-18", wechat: "5", leads: { 抖音: "3", 视频号: "1", 公众号: "0", 小红书: "1" }, note: "示例：抖音第 97 集评论区引流", revision: 1, sum: 5, wechatNum: 5,
      sources: ["抖音", "视频号", "公众号", "小红书"], busy: false, ok: "2026-11-18 已保存", error: "",
      recent: [
        { date: "2026-11-18", wechat_adds: 5, detail: "抖音 3 · 视频号 1 · 公众号 0 · 小红书 1" },
        { date: "2026-11-17", wechat_adds: 2, detail: "抖音 1 · 视频号 0 · 公众号 0 · 小红书 1" },
        { date: "2026-11-16", wechat_adds: 4, detail: "抖音 2 · 视频号 2 · 公众号 0 · 小红书 0" },
      ],
    },
  },
  { file: "10-内容闭环看板-只读", page: "pkg-content/board/index", data: { b: board, error: "" } },
  { file: "11-看示例数据", page: "pkg-demo/index/index", data: { role: "admin", active: "", allowed: true, error: "" } },
  { file: "12-设置与更多-示例模式", page: "pkg-settings/index/index", data: { admin: true, demo: { role: "admin" }, error: "" } },
];

// ---------- 渲染 + 截图 ----------
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith(".png") || f.endsWith(".html")) rmSync(join(OUT, f)); // 只保留最新版
const appCss = css("miniprogram/app.wxss");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: 844 }, deviceScaleFactor: 3 });
const page = await ctx.newPage();
for (const s of SHOTS) {
  const json = JSON.parse(readFileSync(`miniprogram/${s.page}.json`, "utf8"));
  const body = renderChildren(parse(readFileSync(`miniprogram/${s.page}.wxml`, "utf8")).children, s.data);
  const style = rpx((appCss + "\n" + css(`miniprogram/${s.page}.wxss`)).replace(/(^|[\s,}])page(?=[\s{,])/g, "$1body"));
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    html, body { margin: 0; font-family: -apple-system, "PingFang SC", "Noto Sans CJK SC", "Helvetica Neue", sans-serif; -webkit-font-smoothing: antialiased; }
    button { display: block; border: 0; font-family: inherit; line-height: 1.4; cursor: pointer; }
    button[disabled] { opacity: 1; }
    .wx-input { display: block; color: #1F1A17; } .wx-input .ph { color: #B9ABA1; }
    .status { height: 47px; display: flex; justify-content: space-between; align-items: flex-end; padding: 0 30px 6px; font-size: 15px; font-weight: 600; background: #FBF3E4; }
    .nav { height: 44px; display: flex; align-items: center; justify-content: center; font-size: 17px; font-weight: 600; background: #FBF3E4; position: relative; }
    .nav .back { position: absolute; left: 14px; font-size: 26px; font-weight: 300; color: #1F1A17; }
    .nav .capsule { position: absolute; right: 8px; width: 87px; height: 32px; border-radius: 16px; border: 0.5px solid #E2D9D2; background: rgba(255,255,255,.7); }
    ${style}
  </style></head><body><div class="status"><span>15:06</span><span>●●● ▮</span></div><div class="nav"><span class="back">‹</span>${esc(json.navigationBarTitleText || "生意手账")}<span class="capsule"></span></div>${body}</body></html>`;
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: join(OUT, `${s.file}.png`), fullPage: true });
  // 长页面另存一张首屏（iPhone 一屏 390×844），方便一眼看清
  if ((await page.evaluate(() => document.body.scrollHeight)) > 1200) await page.screenshot({ path: join(OUT, `${s.file}-首屏.png`) });
}
await browser.close();
console.log(`✓ ${SHOTS.length} 张预览图 → ${OUT}`);
