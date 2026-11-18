// 小程序工程的静态核对：页面齐全、事件都有处理函数、require 都能找到、domain 包和源码同步、
// 账本数据不落盘、不传身份字段。真机效果以体验版为准，这里保证「打不开 / 点了没反应」这类错误进不了提交。
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import vm from "node:vm";
// @ts-expect-error 构建脚本是 .mjs
import { bundleMiniappDomain, OUT } from "../scripts/build-miniapp.mjs";

const ROOT = "miniprogram";
const app = JSON.parse(readFileSync(join(ROOT, "app.json"), "utf8")) as {
  pages: string[];
  tabBar: { list: { pagePath: string; iconPath: string; selectedIconPath: string; text: string }[] };
};
const read = (p: string) => readFileSync(p, "utf8");
function allJs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    return d.isDirectory() ? allJs(p) : p.endsWith(".js") ? [p] : [];
  });
}

describe("小程序工程结构", () => {
  it("app.json 里每个页面四个文件齐全；tabBar 页面都已注册、图标都在", () => {
    for (const page of app.pages) for (const ext of ["js", "json", "wxml", "wxss"]) expect(existsSync(join(ROOT, page + "." + ext)), page + "." + ext).toBe(true);
    for (const t of app.tabBar.list) {
      expect(app.pages).toContain(t.pagePath);
      expect(existsSync(join(ROOT, t.iconPath))).toBe(true);
      expect(existsSync(join(ROOT, t.selectedIconPath))).toBe(true);
    }
    expect(app.pages[0]).toBe("pages/gate/index");
  });
  it("WXML 里绑定的每个事件，页面 JS 都有同名方法", () => {
    for (const page of app.pages) {
      const wxml = read(join(ROOT, page + ".wxml"));
      const js = read(join(ROOT, page + ".js"));
      const handlers = [...wxml.matchAll(/\b(?:bind|catch)[a-z]+="([A-Za-z_]\w*)"/g)].map((m) => m[1]);
      for (const h of handlers) expect(new RegExp(`\\n  ${h}\\(`).test(js), `${page} 缺少 ${h}()`).toBe(true);
    }
  });
  it("所有 require 都能找到文件", () => {
    for (const file of allJs(ROOT)) {
      if (file === OUT) continue;
      for (const m of read(file).matchAll(/require\("([^"]+)"\)/g)) {
        if (m[1] === "./config.js") continue; // 本机配置不进仓库，app.js 有回退
        const target = resolve(dirname(file), m[1].endsWith(".js") ? m[1] : m[1] + ".js");
        expect(existsSync(target), `${file} → ${m[1]}`).toBe(true);
      }
    }
  });
  it("reLaunch / switchTab 到 tabBar 页面不带参数（微信不允许）", () => {
    const tabs = new Set(app.tabBar.list.map((t) => "/" + t.pagePath));
    for (const file of allJs(join(ROOT, "pages")))
      for (const m of read(file).matchAll(/(?:switchTab|reLaunch)\(\{ url: "([^"]+)"/g)) {
        const [path, q] = m[1].split("?");
        if (tabs.has(path)) expect(q, file + " " + m[1]).toBeUndefined();
      }
    expect(read(join(ROOT, "pages/gate/index.js"))).toContain("url === ROUTES.owner ? url");
  });
  it("账本数据不落盘：只有草稿工具会写本机缓存；页面不直接调 setStorageSync", () => {
    for (const file of allJs(ROOT)) {
      const text = read(file);
      if (file.endsWith(join("utils", "draft.js")) || file === OUT) continue;
      expect(text, file).not.toMatch(/setStorage(Sync)?\(/);
    }
  });
  it("调用云函数不带任何身份字段（openid 由微信平台注入）", () => {
    for (const file of allJs(ROOT)) {
      if (file === OUT) continue;
      expect(read(file), file).not.toMatch(/\b(openid|openId|userInfo)\s*:/);
    }
  });
  it("数据页都开了截屏遮盖（个人私密账本）", () => {
    for (const page of ["home", "finance", "details", "calendar", "sale", "task", "bell", "applications"])
      expect(read(join(ROOT, `pages/${page}/index.js`)), page).toContain("session.protect(true)");
  });
  it("底部 5 个标签按 看板、财务、明细、日程、我的 排列，图标都在；申请角标打在「我的」", () => {
    expect(app.tabBar.list.map((x) => x.text)).toEqual(["看板", "财务", "明细", "日程", "我的"]);
    const me = app.tabBar.list.findIndex((x) => x.text === "我的");
    expect(read(join(ROOT, "pages/me/index.js"))).toContain("ME_TAB = " + me);
  });
  it("「更多」不再列出已迁到财务标签的账务入口；记一笔有全部客户下拉", () => {
    const hub = read(join(ROOT, "pkg2/hub/index.js"));
    expect(hub).not.toContain('name: "账务"');
    expect(hub).not.toMatch(/item\("报销记账"/);
    const sale = read(join(ROOT, "pages/sale/index.wxml")) + read(join(ROOT, "pages/sale/index.js"));
    expect(sale).toContain("全部客户");
    expect(sale).toContain("pickCustomer");
  });
  it("navigateTo 不指向 tabBar 页（应使用 switchTab）", () => {
    const tabs = new Set(app.tabBar.list.map((x) => "/" + x.pagePath));
    for (const file of allJs(ROOT)) {
      if (file.includes("lib/domain.js") || file.includes("pkg-demo")) continue;
      for (const m of read(file).matchAll(/navigateTo\(\{ url: [`"]([^`"]+)/g)) {
        const path = m[1].split("?")[0];
        expect(tabs.has(path), `${file} navigateTo ${path}`).toBe(false);
      }
    }
  });
});

describe("domain 编译复用", () => {
  it("miniprogram/lib/domain.js 和源码同步（改了 src/domain 或 src/miniapp 要重新 npm run build:miniapp）", async () => {
    expect(read(OUT)).toBe(await bundleMiniappDomain());
  });
  function loadBundle(globals: Record<string, unknown>) {
    const module = { exports: {} as Record<string, any> };
    vm.runInNewContext(read(OUT), { module, exports: module.exports, ...globals });
    return module.exports;
  }
  it("在没有 Intl 的环境里也能算对北京时间日期和千分位", () => {
    const D = loadBundle({ Date, Math, JSON, Number, String, Array, Object, Map, Set, RegExp, Error, Symbol, Promise });
    expect(D.today(new Date("2026-11-17T16:00:00.000Z"))).toBe("2026-11-18");
    expect(D.money(123456700)).toBe("1,234,567");
    expect(D.yuan(-50)).toBe("¥-1");
  });
  it("有原生 Intl 时结果相同；导出页面要用的函数", () => {
    const D = loadBundle({ Intl, Date, Math, JSON, Number, String, Array, Object, Map, Set, RegExp, Error, Symbol, Promise });
    expect(D.today(new Date("2026-11-17T16:00:00.000Z"))).toBe("2026-11-18");
    for (const name of ["homeView", "profitTargetLayout", "bucketBarsLayout", "productBarsLayout", "drawChart", "drawProductBars", "hitBar", "trendSummary", "prepareSave", "pickProduct", "quickProducts", "saleRow", "cleanFilters", "presetRange", "monthGrid", "agenda", "bell", "taskRow", "taskInput", "requestId", "REMINDERS"])
      expect(D[name], name).toBeDefined();
  });
  it("包里不留 ES2018+ 语法（老基础库也能直接跑）、不引外部模块", () => {
    const text = read(OUT);
    // 可选链、空值合并、对象展开（ES2018）都已被降级；ES2019+ 的数组/对象方法也不用
    expect(text).not.toMatch(/\?\.[A-Za-z_(]|\?\?/);
    expect(text).not.toMatch(/\{\s*\.\.\./);
    expect(text).not.toMatch(/\.(flatMap|flat|at|replaceAll|matchAll)\(|Object\.(hasOwn|fromEntries)\(/);
    expect(text).not.toMatch(/\brequire\(/);
    expect(text).not.toMatch(/\bimport\(/);
    expect(text.length).toBeLessThan(200 * 1024);
  });
});
