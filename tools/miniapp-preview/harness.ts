/**
 * 小程序本地预览（只用示例数据，不连云端）：在浏览器里跑 miniprogram/ 下真实的页面 JS、WXML、WXSS 和 lib/domain.js，
 * 用最小的 wx / Page 模拟和一个 WXML 渲染器出 iPhone 宽度的预览图，给 Jason 先看界面。
 * 不是微信开发者工具的替代品：真机效果以体验版为准。
 * 打开：npm run dev → http://127.0.0.1:5173/JasonAI/tools/miniapp-preview/index.html?page=pages/home/index
 */
import { createDemo } from "../../src/lib/demo";

const files = import.meta.glob("/miniprogram/**/*.{js,wxml,wxss,json}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const images = import.meta.glob("/miniprogram/assets/*.png", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const VW = window.innerWidth || 390;
const RPX = VW / 750;
const params = new URLSearchParams(location.search);
const ROLE = params.get("role") === "member" ? "member" : "admin";

// ───────── 示例数据 API（与网页演示账本同一套 server 代码） ─────────
sessionStorage.setItem("zhangyuge-demo-role", ROLE);
const api = createDemo(ROLE);
let seeded: Promise<void> | null = null;
function seedTasks() {
  if (!seeded)
    seeded = (async () => {
      const existing = await api.call<unknown[]>("tasks.list", {});
      if (existing.length) return;
      const customers = await api.call<{ id: string; name: string }[]>("customers.list", {});
      const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
      const add = (d: number, hm: string, ci: number, title: string, next = "") => {
        const date = new Date(Date.parse(day + "T00:00:00Z") + d * 86400e3).toISOString().slice(0, 10);
        return api.call("tasks.create", {
          requestId: `pv-${d}-${hm.replace(":", "")}-${ci}`,
          task: { customerId: customers[ci % customers.length].id, at: new Date(Date.parse(`${date}T${hm}:00+08:00`)).toISOString(), title, feedback: "", nextAction: next, reminder: "both" },
        });
      };
      await add(0, "09:30", 0, "续费提醒：Plus 会员", "发续费链接");
      await add(0, "15:00", 1, "回访使用情况");
      await add(0, "20:00", 2, "确认交付时间");
      await add(1, "10:00", 3, "报价：AI 工具年卡");
      await add(-2, "11:00", 1, "补发使用指南");
      await add(3, "16:30", 0, "约下次沟通");
      await add(9, "10:00", 2, "节前问候");
      const done = (await api.call<{ id: string; revision: number; title: string }[]>("tasks.list", {})).find((t) => t.title === "回访使用情况");
      if (done) await api.call("tasks.complete", { id: done.id, revision: done.revision, requestId: "pv-done-1" });
    })();
  return seeded;
}
async function cloudCall(action: string, payload: unknown) {
  await seedTasks();
  try {
    if (action === "miniapp.me")
      return {
        ok: true,
        data: {
          status: ROLE === "admin" ? "owner" : "member",
          name: ROLE === "admin" ? "章鱼哥" : "演示成员",
          avatarUrl: params.get("avatar") === "1" ? (window as any).__previewAvatar : undefined,
        },
      };
    if (action === "miniapp.subscribe.config" || action === "miniapp.subscribe.record")
      return {
        ok: true,
        data: {
          enabled: false,
          templates: { task: "wsMYvp0ssfye_srTUreOx8zJy1SQqFlF20ZIGOVKC7o" },
          quota: { task: 3 },
          recorded: action.endsWith("record") ? 1 : 0,
        },
      };
    if (action === "miniapp.apply.list")
      return {
        ok: true,
        data: {
          pending: [{ id: "a_demo1", name: "示例申请人 · 小周", phone: "13800000000", lastAppliedAt: new Date().toISOString(), maybe: [] }],
          blocked: [],
          rejected: [],
        },
      };
    if (action.startsWith("miniapp.")) return { ok: true, data: {} };
    return { ok: true, data: await api.call(action, payload) };
  } catch (e) {
    return { ok: false, error: (e as Error).message, code: (e as { code?: string }).code };
  }
}

// ───────── 模块加载（CommonJS） ─────────
const cache = new Map<string, unknown>();
function resolve(from: string, req: string) {
  const parts = from.split("/").slice(0, -1);
  for (const seg of req.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  let p = parts.join("/");
  if (!p.endsWith(".js")) p += ".js";
  return p;
}
function load(path: string): unknown {
  if (cache.has(path)) return cache.get(path);
  const src = files[path];
  if (src === undefined) throw new Error("找不到模块 " + path);
  const module = { exports: {} as unknown };
  cache.set(path, module.exports);
  new Function("require", "module", "exports", "Page", "App", "getApp", "wx", src)(
    (r: string) => load(resolve(path, r)),
    module,
    module.exports,
    (def: PageDef) => (pendingPage = def),
    (def: Record<string, unknown>) => (appDef = def),
    () => appDef,
    wx,
  );
  cache.set(path, module.exports);
  return module.exports;
}

// ───────── wx 模拟 ─────────
type PageDef = Record<string, any> & { data?: Record<string, unknown> };
let pendingPage: PageDef | null = null;
let appDef: Record<string, any> = { globalData: {} };
let current: PageInstance | null = null;
let navTitle = "";
const toastLayer = () => document.getElementById("mp-toast")!;
const wx: Record<string, any> = {
  cloud: {
    init() {},
    callFunction: ({ data }: { data: { action: string; payload: unknown } }) => cloudCall(data.action, data.payload).then((result) => ({ result })),
  },
  getStorageSync: (k: string) => {
    const v = localStorage.getItem("mp:" + k);
    return v ? JSON.parse(v) : "";
  },
  setStorageSync: (k: string, v: unknown) => localStorage.setItem("mp:" + k, JSON.stringify(v)),
  removeStorageSync: (k: string) => localStorage.removeItem("mp:" + k),
  setVisualEffectOnCapture() {},
  stopPullDownRefresh() {},
  getWindowInfo: () => ({ pixelRatio: window.devicePixelRatio || 2, windowWidth: VW }),
  setNavigationBarTitle: ({ title }: { title: string }) => {
    navTitle = title;
    const el = document.getElementById("mp-title");
    if (el) el.textContent = title;
  },
  showToast: ({ title }: { title: string }) => {
    const el = toastLayer();
    el.textContent = title;
    el.style.display = "block";
    setTimeout(() => (el.style.display = "none"), 1200);
  },
  showModal: (o: { success?: (r: { confirm: boolean }) => void }) => o.success?.({ confirm: false }),
  showActionSheet() {},
  setTabBarBadge({ index, text }: { index: number; text: string }) {
    const b = document.querySelector(`[data-tab-badge="${index}"]`) as HTMLElement | null;
    if (b) (b.textContent = text), (b.style.display = "block");
  },
  removeTabBarBadge() {},
  navigateTo: ({ url }: { url: string }) => open(url),
  redirectTo: ({ url }: { url: string }) => open(url),
  reLaunch: ({ url }: { url: string }) => open(url),
  switchTab: ({ url }: { url: string }) => open(url),
  navigateBack() {},
  createSelectorQuery: () => {
    let sel = "";
    const q = {
      select(s: string) {
        sel = s;
        return q;
      },
      fields() {
        return q;
      },
      exec(cb: (r: unknown[]) => void) {
        setTimeout(() => {
          const el = document.querySelector("#mp-body " + sel) as HTMLCanvasElement | null;
          if (!el) return cb([null]);
          const r = el.getBoundingClientRect();
          cb([{ node: el, width: r.width, height: r.height }]);
        }, 0);
      },
    };
    return q;
  },
};

// ───────── WXML 渲染 ─────────
type Scope = Record<string, unknown>;
const exprCache = new Map<string, (s: Scope) => unknown>();
function evalExpr(expr: string, scope: Scope) {
  let fn = exprCache.get(expr);
  if (!fn) {
    fn = new Function("s", `with(s){return (${expr});}`) as (s: Scope) => unknown;
    exprCache.set(expr, fn);
  }
  const proxy = new Proxy(scope, { has: (_t, k) => typeof k === "string", get: (t, k) => (k === Symbol.unscopables ? undefined : (t as any)[k]) });
  try {
    return fn(proxy);
  } catch {
    return undefined;
  }
}
const MUSTACHE = /\{\{([\s\S]+?)\}\}/g;
function interp(text: string, scope: Scope): unknown {
  const single = text.match(/^\s*\{\{([\s\S]+?)\}\}\s*$/);
  if (single && !single[1].includes("{{")) return evalExpr(single[1], scope);
  return text.replace(MUSTACHE, (_m, e) => {
    const v = evalExpr(e, scope);
    return v === undefined || v === null ? "" : String(v);
  });
}
const TAG: Record<string, string> = { view: "div", "scroll-view": "div", picker: "div", text: "span", button: "button", image: "img", navigator: "a", label: "label" };
const canvases = new Map<string, HTMLCanvasElement>();
function camel(s: string) {
  return s.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
}
function renderNodes(nodes: NodeListOf<ChildNode> | ChildNode[], scope: Scope, parent: Node) {
  let chain: "none" | "taken" | "open" = "none";
  for (const node of Array.from(nodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = String(interp(node.textContent || "", scope) ?? "");
      if (t.trim()) parent.appendChild(document.createTextNode(t));
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    if (el.hasAttribute("wx-if")) {
      const ok = !!interp(el.getAttribute("wx-if")!, scope);
      chain = ok ? "taken" : "open";
      if (!ok) continue;
    } else if (el.hasAttribute("wx-elif")) {
      if (chain !== "open") continue;
      const ok = !!interp(el.getAttribute("wx-elif")!, scope);
      if (ok) chain = "taken";
      else continue;
    } else if (el.hasAttribute("wx-else")) {
      if (chain !== "open") {
        chain = "none";
        continue;
      }
      chain = "none";
    } else chain = "none";
    if (el.hasAttribute("wx-for")) {
      const list = (interp(el.getAttribute("wx-for")!, scope) as unknown[]) || [];
      const itemName = el.getAttribute("wx-for-item") || "item";
      const indexName = el.getAttribute("wx-for-index") || "index";
      list.forEach((item, index) => renderElement(el, { ...scope, [itemName]: item, [indexName]: index }, parent));
    } else renderElement(el, scope, parent);
  }
}
function renderElement(el: Element, scope: Scope, parent: Node) {
  const tag = el.tagName;
  if (tag === "privacy-popup") return;
  if (tag === "block") return renderNodes(el.childNodes, scope, parent);
  if (tag === "canvas") {
    const id = el.getAttribute("id") || "";
    const c = canvases.get(id) || document.createElement("canvas");
    canvases.set(id, c);
    c.id = id;
    c.className = String(interp(el.getAttribute("class") || "", scope));
    const style = el.getAttribute("style");
    if (style) c.setAttribute("style", rpx(String(interp(style, scope))));
    c.onclick = (ev) => current?.__invoke(el.getAttribute("bindtouchend") || "", { changedTouches: [{ x: ev.offsetX, y: ev.offsetY }], currentTarget: { dataset: {} } });
    parent.appendChild(c);
    return;
  }
  let out: HTMLElement;
  if (tag === "switch") {
    out = document.createElement("div");
    const on = !!interp(el.getAttribute("checked") || "", scope);
    out.className = "mp-switch" + (on ? " on" : "");
    out.onclick = () => current?.__invoke(el.getAttribute("bindchange") || "", { detail: { value: !on }, currentTarget: { dataset: {} } });
    parent.appendChild(out);
    return;
  }
  out = document.createElement(tag === "input" || tag === "textarea" ? tag : TAG[tag] || "div");
  const dataset: Record<string, unknown> = {};
  for (const a of Array.from(el.attributes)) {
    const name = a.name;
    if (name.startsWith("wx-")) continue;
    const value = interp(a.value, scope);
    if (name.startsWith("data-")) dataset[camel(name.slice(5))] = value;
    else if (name === "class") out.className = "wx-" + tag + " " + String(value ?? "");
    else if (name === "style") out.setAttribute("style", rpx(String(value ?? "")));
    else if (name === "value" && (tag === "input" || tag === "textarea")) (out as HTMLInputElement).value = String(value ?? "");
    else if (name === "src") out.setAttribute("src", String(value ?? ""));
    else if (name === "placeholder") out.setAttribute("placeholder", String(value ?? ""));
    else if (name === "hidden" && value) out.style.display = "none";
  }
  if (!out.className) out.className = "wx-" + tag;
  const handler = (attr: string) => el.getAttribute(attr) || "";
  const tap = handler("bindtap") || handler("catchtap");
  if (tap)
    out.addEventListener("click", (ev) => {
      if (el.hasAttribute("catchtap")) ev.stopPropagation();
      current?.__invoke(tap, { currentTarget: { dataset }, detail: {} });
    });
  if (handler("bindinput")) out.addEventListener("input", (ev) => current?.__invoke(handler("bindinput"), { currentTarget: { dataset }, detail: { value: (ev.target as HTMLInputElement).value } }));
  if (handler("bindconfirm")) out.addEventListener("keydown", (ev) => (ev as KeyboardEvent).key === "Enter" && current?.__invoke(handler("bindconfirm"), { currentTarget: { dataset }, detail: {} }));
  if (tag === "textarea") (out as HTMLTextAreaElement).rows = 2;
  parent.appendChild(out);
  if (tag !== "input" && tag !== "textarea") renderNodes(el.childNodes, scope, out);
}
function parseWxml(src: string): Element {
  const xml = ("<root>" + src + "</root>")
    .replace(/\bwx:/g, "wx-")
    // WXML 允许不带值的布尔属性，XML 不允许
    .replace(/\s(wx-else|auto-height|scroll-x|scroll-y|disabled)(?=[\s/>])/g, ' $1=""')
    .replace(/&(?!amp;|lt;|gt;|quot;|#)/g, "&amp;");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error("WXML 解析失败：" + err.textContent);
  return doc.documentElement;
}
function rpx(css: string) {
  return css.replace(/(-?\d*\.?\d+)rpx/g, (_m, n) => `${+(Number(n) * RPX).toFixed(2)}px`);
}
function wxss(path: string, seen = new Set<string>()): string {
  if (seen.has(path)) return "";
  seen.add(path);
  const src = files[path] || "";
  return rpx(
    src
      .replace(/@import\s+"([^"]+)";/g, (_m, p) => wxss(p.startsWith("/") ? "/miniprogram" + p : resolve(path, p).replace(/\.js$/, ""), seen))
      .replace(/(^|[\s,}])page(\s*[{,])/g, "$1.mp-page$2")
      .replace(/(^|[\s,}])(view|text|input|textarea|button|picker|canvas|switch)(?=[\s.,:{#[>])/g, "$1.wx-$2"),
  );
}

// ───────── 页面实例 ─────────
class PageInstance {
  data: Record<string, unknown>;
  constructor(
    public route: string,
    private def: PageDef,
    private tpl: Element,
  ) {
    this.data = JSON.parse(JSON.stringify(def.data || {}));
    for (const [k, v] of Object.entries(def)) if (typeof v === "function") (this as any)[k] = v.bind(this);
  }
  setData(patch: Record<string, unknown>, cb?: () => void) {
    Object.assign(this.data, patch);
    this.__paint();
    if (cb) setTimeout(cb, 0);
  }
  __invoke(name: string, e: unknown) {
    const fn = (this as any)[name];
    if (typeof fn === "function") fn(e);
  }
  __paint() {
    const body = document.getElementById("mp-body")!;
    const y = body.scrollTop;
    body.textContent = "";
    const root = document.createElement("div");
    root.className = "mp-page";
    renderNodes(this.tpl.childNodes, this.data, root);
    body.appendChild(root);
    body.scrollTop = y;
  }
}
const TABS = JSON.parse(files["/miniprogram/app.json"]).tabBar.list as { pagePath: string; text: string; iconPath: string; selectedIconPath: string }[];
function open(url: string) {
  const [path, query = ""] = url.replace(/^\//, "").split("?");
  const q = Object.fromEntries(new URLSearchParams(query));
  const base = "/miniprogram/" + path;
  canvases.clear();
  pendingPage = null;
  cache.delete(base + ".js");
  load(base + ".js");
  const def = pendingPage as PageDef | null;
  if (!def) throw new Error("页面没有调用 Page()：" + path);
  const json = JSON.parse(files[base + ".json"] || "{}");
  navTitle = json.navigationBarTitleText || "生意手账";
  const isTab = TABS.some((t) => t.pagePath === path);
  shell(isTab, path);
  document.getElementById("mp-style")!.textContent = wxss("/miniprogram/app.wxss") + "\n" + wxss(base + ".wxss");
  const page = new PageInstance(path, def, parseWxml(files[base + ".wxml"]));
  current = page;
  page.__paint();
  page.__invoke("onLoad", q);
  page.__invoke("onShow", undefined);
  history.replaceState(null, "", "?page=" + path + (query ? "&" + query : "") + (ROLE === "member" ? "&role=member" : ""));
}
function shell(isTab: boolean, path: string) {
  const phone = document.getElementById("phone")!;
  phone.innerHTML = `
    <div class="mp-status"><span>9:41</span><span class="mp-status-r"><i class="sig"></i><i class="bat"></i></span></div>
    <div class="mp-nav"><span id="mp-title"></span><span class="mp-capsule"><i>•••</i><b></b><i>◎</i></span></div>
    <div id="mp-body" class="${isTab ? "with-tab" : ""}"></div>
    ${
      isTab
        ? `<div class="mp-tabbar">${TABS.map(
            (t, i) =>
              `<div class="mp-tab ${t.pagePath === path ? "on" : ""}" data-path="${t.pagePath}"><img src="${images["/miniprogram/" + (t.pagePath === path ? t.selectedIconPath : t.iconPath)]}"/><span>${t.text}</span><em data-tab-badge="${i}"></em></div>`,
          ).join("")}</div>`
        : ""
    }
    <div id="mp-toast"></div>`;
  document.getElementById("mp-title")!.textContent = navTitle;
  phone.querySelectorAll<HTMLElement>(".mp-tab").forEach((t) => (t.onclick = () => open("/" + t.dataset.path)));
}

const chrome = document.createElement("style");
chrome.textContent = `
  html, body { margin: 0; background: #FBF3E4; -webkit-font-smoothing: antialiased; }
  body { font-family: -apple-system, "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", "Helvetica Neue", sans-serif; }
  #phone { width: ${VW}px; height: 100vh; display: flex; flex-direction: column; position: relative; overflow: hidden; }
  body.long #phone { height: auto; overflow: visible; }
  .mp-status { height: 47px; display: flex; align-items: flex-end; justify-content: space-between; padding: 0 28px 4px; font: 600 15px -apple-system, sans-serif; color: #000; background: #FBF3E4; box-sizing: border-box; }
  .mp-status-r { display: flex; align-items: center; gap: 6px; padding-bottom: 3px; }
  .mp-status-r .sig { width: 17px; height: 11px; background: linear-gradient(90deg, #000 0 3px, transparent 3px 4.5px, #000 4.5px 7.5px, transparent 7.5px 9px, #000 9px 12px, transparent 12px 13.5px, #000 13.5px); clip-path: polygon(0 75%, 25% 75%, 25% 50%, 50% 50%, 50% 25%, 75% 25%, 75% 0, 100% 0, 100% 100%, 0 100%); }
  .mp-status-r .bat { width: 22px; height: 11px; border: 1px solid rgba(0,0,0,.4); border-radius: 3px; box-sizing: border-box; background: linear-gradient(90deg, #000 0 80%, transparent 80%); background-clip: content-box; padding: 1px; }
  .mp-nav { height: 44px; display: flex; align-items: center; justify-content: center; position: relative; background: #FBF3E4; font: 600 17px -apple-system, "PingFang SC", sans-serif; color: #000; }
  .mp-capsule { position: absolute; right: 7px; top: 6px; width: 87px; height: 32px; border-radius: 16px; border: 0.5px solid rgba(0,0,0,.12); background: rgba(255,255,255,.6); display: flex; align-items: center; justify-content: space-around; font-style: normal; font-size: 13px; }
  .mp-capsule i { font-style: normal; } .mp-capsule b { width: 0.5px; height: 18px; background: rgba(0,0,0,.15); }
  #mp-body { flex: 1; overflow-y: auto; position: relative; transform: translateZ(0); color: #2B2522; font-size: ${30 * RPX}px; }
  body.long #mp-body { overflow: visible; flex: none; }
  .mp-tabbar { height: 83px; display: flex; background: #fff; border-top: 0.5px solid rgba(0,0,0,.08); padding-bottom: 34px; box-sizing: border-box; }
  .mp-tab { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 10px; color: #8A7B70; position: relative; }
  .mp-tab.on { color: #D97757; } .mp-tab img { width: 26px; height: 26px; margin-bottom: 2px; }
  .mp-tab em { display: none; position: absolute; top: 2px; left: 54%; background: #E5484D; color: #fff; font-style: normal; font-size: 10px; border-radius: 8px; padding: 0 5px; line-height: 16px; }
  #mp-toast { display: none; position: absolute; left: 50%; top: 45%; transform: translate(-50%, -50%); background: rgba(0,0,0,.75); color: #fff; padding: 14px 20px; border-radius: 10px; font-size: 15px; z-index: 99; }
  .mp-page { min-height: 100%; }
  .wx-view, .wx-scroll-view, .wx-picker { display: block; }
  .wx-scroll-view { overflow-x: auto; }
  .wx-input, .wx-textarea { border: none; outline: none; font: inherit; color: inherit; display: block; box-sizing: content-box; resize: none; }
  .wx-input, .wx-textarea { width: 100%; min-width: 0; box-sizing: border-box; }
  .wx-canvas, canvas { display: block; }
  .mp-switch { width: 51px; height: 31px; border-radius: 16px; background: #E9E3DE; position: relative; flex-shrink: 0; }
  .mp-switch::after { content: ""; position: absolute; left: 2px; top: 2px; width: 27px; height: 27px; border-radius: 50%; background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,.2); }
  .mp-switch.on { background: #D97757; } .mp-switch.on::after { left: 22px; }
`;
document.head.appendChild(chrome);
const pageStyle = document.createElement("style");
pageStyle.id = "mp-style";
document.head.appendChild(pageStyle);
if (params.get("long") === "1") document.body.classList.add("long");

load("/miniprogram/app.js");
appDef.globalData.config = { envId: "preview", functionName: "miniapp" };
(window as any).__mp = { open, wx, get page() { return current; } };
open("/" + (params.get("page") || "pages/home/index") + (params.get("q") ? "?" + params.get("q") : ""));
