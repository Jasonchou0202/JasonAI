// 财务标签第二版预览图（iPhone 390×844，dpr 2，只用示例数据）。输出目录每次只保留最新一版正式 PNG。
import { chromium } from "playwright";
import { mkdir, rm, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const origin = process.env.PREVIEW_ORIGIN || "http://127.0.0.1:5188/JasonAI/";
const out = process.env.PREVIEW_OUT || "/workspace/review/finance-tab";
const avatarPath = join(out, "_avatar-sample.png");
const notifyHtml = join(out, "_notify-mock.html");

const avatarDataUrl = `data:image/png;base64,${(await readFile(avatarPath)).toString("base64")}`;

const browser = await chromium.launch({ headless: true });
const errors = [];

async function context() {
  return browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    isMobile: true,
    hasTouch: true,
  });
}

async function openPage(tool, pagePath, { long = false, q = "", role = "" } = {}) {
  const ctx = await context();
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${pagePath}: ${e.message}`));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(`${pagePath} console: ${m.text()}`);
  });
  const url = `${origin}tools/${tool}/index.html?page=${pagePath}${q ? "&q=" + encodeURIComponent(q) : ""}${role ? "&role=" + role : ""}${long ? "&long=1" : ""}`;
  await p.goto(url, { waitUntil: "networkidle" });
  await p.waitForTimeout(1800);
  const err = await p.locator(".err, .error").allTextContents();
  if (err.some((t) => t.trim())) errors.push(`${pagePath} 页面报错：${err.join(" / ")}`);
  return { ctx, p };
}

async function scrollToHeading(p, text) {
  await p.evaluate((t) => {
    const body = document.getElementById("mp-body");
    const el = [...document.querySelectorAll(".h2, .h1, .panel-title")].find((e) => (e.textContent || "").includes(t));
    if (el && body) {
      const top = el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 16;
      body.scrollTop = Math.max(0, top);
    }
  }, text);
  await p.waitForTimeout(400);
}

async function shot(name, tool, pagePath, opts = {}) {
  const { ctx, p } = await openPage(tool, pagePath, opts);
  if (opts.act) {
    await opts.act(p);
    await p.waitForTimeout(opts.after || 700);
  }
  await p.evaluate(() => {
    const alias = { 周诗懿: "示例伙伴 · 小懿", 奈奈: "示例客户甲", 孙超: "示例客户乙" };
    const swap = (s) => Object.entries(alias).reduce((t, [a, b]) => t.replaceAll(a, b), s);
    const walk = (n) => {
      if (n.nodeType === 3 && n.nodeValue) n.nodeValue = swap(n.nodeValue);
      for (const c of n.childNodes) walk(c);
    };
    walk(document.body);
  });
  const forbidden = await p.evaluate(() => document.body.innerText);
  for (const bad of ["周诗懿", "奈奈", "孙超"]) {
    if (forbidden.includes(bad)) errors.push(`${name} 出现不应出现的人名：${bad}`);
  }
  await p.screenshot({ path: `${out}/${name}.png`, fullPage: !!opts.long });
  await ctx.close();
  console.log("shot", name);
}

// 清空旧正式预览图，保留辅助文件
const keep = new Set(["_avatar-sample.png", "_notify-mock.html", "shots.mjs", "REPORT.md"]);
await mkdir(out, { recursive: true });
for (const f of await readdir(out)) {
  if (f.endsWith(".png") && !keep.has(f)) await rm(join(out, f));
}

await shot("01-看板首屏", "miniapp-preview", "pages/home/index");

await shot("02-财务页", "miniapp-preview-b2", "pages/finance/index");

await shot("03-利润对照", "miniapp-preview-b2", "pkg2/expenses/index", {
  act: async (p) => {
    await p.waitForTimeout(800);
    await scrollToHeading(p, "利润对照");
  },
  after: 200,
});

await shot("04-报销明细", "miniapp-preview-b2", "pkg2/expenses/index", {
  act: async (p) => {
    await p.waitForTimeout(400);
    await scrollToHeading(p, "本月报销明细");
  },
  after: 200,
});

await shot("05-开票明细", "miniapp-preview-b2", "pkg2/invoices/index", {
  act: async (p) => {
    await p.waitForTimeout(400);
    await p.evaluate(() => {
      const body = document.getElementById("mp-body");
      const el = document.querySelector(".inv-item, .card");
      if (el && body) {
        const top = el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 20;
        body.scrollTop = Math.max(0, top);
      }
    });
  },
  after: 200,
});

await shot("06-经营图表", "miniapp-preview-b2", "pkg2/charts/index", {
  act: async (p) => p.waitForTimeout(1000),
  after: 200,
});

await shot("07-记一笔", "miniapp-preview", "pages/sale/index", {
  long: true,
  act: async (p) => {
    const pill = p.locator(".pill").first();
    if (await pill.count()) await pill.click();
  },
});

await shot("08-记一笔-客户选择", "miniapp-preview", "pages/sale/index", {
  act: async (p) => {
    const names = await p.evaluate(() => (window.__mp?.page?.data?.customerNames || []).slice(0, 8));
    const list = names.length ? names : ["示例客户 · 小林", "示例客户 · 阿远", "示例客户 · 木木", "示例客户 · 陈同学"];
    await p.evaluate((list) => {
      const host = document.getElementById("phone") || document.body;
      const wrap = document.createElement("div");
      wrap.id = "mock-picker";
      wrap.innerHTML = `
        <div style="position:absolute;inset:0;background:rgba(0,0,0,.45);z-index:80;display:flex;align-items:flex-end;">
          <div style="width:100%;background:#f6f3ef;border-radius:14px 14px 0 0;padding-bottom:28px;">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;font-size:16px;color:#D97757;">
              <span style="color:#8A7B70">取消</span>
              <b style="color:#1D1D1F;font-weight:600">选择客户</b>
              <span>完成</span>
            </div>
            <div style="height:220px;overflow:hidden;background:#fff;mask-image:linear-gradient(to bottom, transparent, #000 18%, #000 82%, transparent);">
              ${list
                .map(
                  (n, i) =>
                    `<div style="height:44px;display:flex;align-items:center;justify-content:center;font-size:18px;color:${i === 0 ? "#1D1D1F" : "#6B5A50"};font-weight:${i === 0 ? 600 : 400}">${n}</div>`,
                )
                .join("")}
            </div>
          </div>
        </div>`;
      host.appendChild(wrap);
    }, list);
  },
  after: 200,
});

await shot("09-我的-未设头像", "miniapp-preview", "pages/me/index");

await shot("10-我的-已设头像", "miniapp-preview", "pages/me/index", {
  act: async (p) => {
    await p.evaluate((url) => {
      const page = window.__mp?.page;
      if (page?.setData) page.setData({ avatarUrl: url });
    }, avatarDataUrl);
  },
  after: 400,
});

await shot("11-服务通知设置", "miniapp-preview", "pkg-settings/notify/index");

{
  const ctx = await context();
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push("消息示意: " + e.message));
  await p.goto("file://" + notifyHtml);
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/12-服务通知-消息示意.png` });
  await ctx.close();
  console.log("shot 12-服务通知-消息示意");
}

await shot("13-更多页", "miniapp-preview-b2", "pkg2/hub/index");

await browser.close();
if (errors.length) {
  console.error("页面错误：\n" + errors.join("\n"));
  process.exit(1);
}
console.log(`✓ 预览图已写入 ${out}`);
