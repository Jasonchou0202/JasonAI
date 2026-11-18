import { createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { build } from "esbuild";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/miniapp-b3/sha256";
import { parseGrid } from "../src/domain/import";

/** 按小程序的构建参数打包，放进一个「什么浏览器接口都没有」的 vm 里跑（模拟小程序 JS 环境） */
async function bundle(entry: string) {
  const r = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: "browser",
    format: "cjs",
    target: "es2018",
    minify: true,
    logLevel: "silent",
    define: { "import.meta.env.BASE_URL": '"/"', "process.env.NODE_ENV": '"production"' },
  });
  const code = r.outputFiles[0].text;
  const module = { exports: {} as any };
  const ctx = vm.createContext({ module, exports: module.exports, console: { log() {}, warn() {}, error() {} } });
  vm.runInContext(code, ctx);
  return { lib: module.exports, ctx, size: code.length };
}
const xlsxBytes = (rows: unknown[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "S");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
};

describe("纯 JS SHA-256（小程序里没有 crypto.subtle）", () => {
  it("和 node:crypto 逐字一致：空串、中文、emoji、跨块长度、随机字节", () => {
    for (const s of ["", "abc", "生意手账", "😀 表情", "a".repeat(55), "a".repeat(56), "a".repeat(64), "x".repeat(1000)])
      expect(sha256Hex(s)).toBe(createHash("sha256").update(s).digest("hex"));
    for (const n of [1, 63, 64, 65, 4096]) {
      const b = randomBytes(n);
      expect(sha256Hex(new Uint8Array(b))).toBe(createHash("sha256").update(b).digest("hex"));
    }
  });
});

describe("账本设置分包库 settings-lib（在没有浏览器接口的环境里跑）", () => {
  it("读 Excel：和网页同一个 parseGrid、同一个文件指纹；包体积在分包上限内", async () => {
    const { lib, ctx, size } = await bundle("src/miniapp-b3/settings-lib.ts");
    expect(size).toBeLessThan(1.5 * 1024 * 1024);
    const rows = [
      ["商品名称", "客户名称", "日期", "销售额", "出资", "纯利", "备注"],
      ["示例商品甲", "示例客户 · 小林", "2026/11/1", 100, 40, 60, "虚构"],
      ["示例商品乙", "示例客户 · 阿远", 46000, 200.5, 50, 150.5, ""],
    ];
    const bytes = xlsxBytes(rows);
    ctx.raw = [...bytes];
    const out = JSON.parse(vm.runInContext('JSON.stringify(module.exports.readExcel(new Uint8Array(raw).buffer, "历史.xlsx"))', ctx));
    const grid = XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(bytes, { type: "array" }).Sheets.S, { header: 1, defval: "", raw: true });
    const web = parseGrid(grid, "历史.xlsx", createHash("sha256").update(bytes).digest("hex"));
    expect(out).toEqual(JSON.parse(JSON.stringify(web)));
    expect(out.rows).toHaveLength(2);
    expect(lib.previewSummary(out)).toMatchObject({ rows: 2, errors: 0 });
    expect(() => lib.readExcel(new ArrayBuffer(8), "a.pdf")).toThrow("请选择 Excel");
  });
  it("备份：gzip/base64 和 node:zlib 互通；网页备份格式校验一致", async () => {
    const { lib } = await bundle("src/miniapp-b3/settings-lib.ts");
    const text = JSON.stringify({ format: "zhangyuge-sales", version: 1, exportedAt: "2026-11-18T00:00:00.000Z", sales: [], products: [], note: "中文😀" });
    expect(gunzipSync(Buffer.from(lib.gzipBase64(text), "base64")).toString("utf8")).toBe(text);
    expect(lib.gunzipBase64(gzipSync(Buffer.from(text)).toString("base64"))).toBe(text);
    expect(lib.readBackupText(text)).toMatchObject({ version: 1 });
    expect(() => lib.readBackupText("{}")).toThrow();
    expect(() => lib.readBackupText("不是json")).toThrow("这不是生意手账的备份文件");
    expect(lib.backupFileName("2026-11-18T08:00:00.000Z")).toBe("章鱼哥账本备份-2026-11-18.json");
    for (const n of [0, 1, 2, 3, 100]) {
      const b = randomBytes(n);
      expect(lib.bytesToBase64(new Uint8Array(b))).toBe(b.toString("base64"));
      expect(Buffer.from(lib.base64ToBytes(b.toString("base64"))).equals(b)).toBe(true);
    }
  });
});

describe("示例数据分包库 demo-lib", () => {
  it("进入示例后 callFunction 由本机示例账本回答，一条也不发到云端；退出后还原", async () => {
    const { lib, size } = await bundle("src/miniapp-b3/demo-lib.ts");
    expect(size).toBeLessThan(1024 * 1024);
    const real: unknown[] = [];
    const original = async (o: unknown) => (real.push(o), { result: { ok: true, data: "real" } });
    const wx = { cloud: { callFunction: original } };
    lib.enterDemo(wx, "admin");
    const me = (await wx.cloud.callFunction({ name: "miniapp", data: { action: "miniapp.me" } })) as any;
    expect(me.result.data).toMatchObject({ status: "owner", demo: true });
    const dash = (await wx.cloud.callFunction({ name: "miniapp", data: { action: "dashboard", payload: {} } })) as any;
    expect(dash.result.ok).toBe(true);
    expect(dash.result.data.month.count).toBeGreaterThan(0);
    const imp = (await wx.cloud.callFunction({ name: "miniapp", data: { action: "import.preview", payload: {} } })) as any;
    expect(imp.result).toMatchObject({ ok: false });
    const content = (await wx.cloud.callFunction({ name: "miniapp", data: { action: "content.daily.list" } })) as any;
    expect(content.result).toMatchObject({ ok: false, code: "DEMO_ONLY" });
    expect(real).toHaveLength(0);
    lib.exitDemo(wx);
    expect(wx.cloud.callFunction).toBe(original);
    lib.enterDemo(wx, "member");
    const m = (await wx.cloud.callFunction({ name: "miniapp", data: { action: "miniapp.me" } })) as any;
    expect(m.result.data.status).toBe("member");
    const bin = (await wx.cloud.callFunction({ name: "miniapp", data: { action: "sales.trash", payload: {} } })) as any;
    expect(bin.result.ok).toBe(false); // 成员视角：回收站只给管理员（和真实权限一致）
    lib.exitDemo(wx);
  });
  it("属性只读的基础库：退出示例并提示，不会半开半关", async () => {
    const { lib } = await bundle("src/miniapp-b3/demo-lib.ts");
    const cloud = {};
    const fn = async () => ({});
    Object.defineProperty(cloud, "callFunction", { value: fn, writable: false, configurable: false });
    expect(() => lib.enterDemo({ cloud }, "admin")).toThrow("暂不支持示例数据");
    expect(lib.inDemo()).toBe(false);
  });
});

describe("小程序第 3 批页面：静态检查", () => {
  const root = "miniprogram";
  const app = JSON.parse(readFileSync(join(root, "app.json"), "utf8"));
  const allPages: string[] = (app.subpackages ?? []).flatMap((p: { root: string; pages: string[] }) => p.pages.map((x) => `${p.root}/${x}`));
  const pages = allPages.filter((p) => p.startsWith("pkg-settings/") || p.startsWith("pkg-content/") || p.startsWith("pkg-demo/"));
  it("分包里每个页面四件套齐全，样式都引同一份珊瑚橙样式", () => {
    expect(pages).toEqual(expect.arrayContaining(["pkg-settings/index/index", "pkg-settings/import/index", "pkg-settings/backup/index", "pkg-settings/notify/index", "pkg-settings/avatar/index", "pkg-content/entry/index", "pkg-content/board/index", "pkg-demo/index/index"]));
    for (const p of pages) {
      for (const ext of ["js", "json", "wxml", "wxss"]) expect(existsSync(join(root, p + "." + ext)), p + "." + ext).toBe(true);
      expect(readFileSync(join(root, p + ".wxss"), "utf8")).toContain('@import "/styles/b3.wxss"');
      JSON.parse(readFileSync(join(root, p + ".json"), "utf8"));
    }
    expect(readFileSync(join(root, "styles/b3.wxss"), "utf8")).toContain("#D97757");
  });
  it("不在本机缓存账本数据、不传身份字段、不出现密钥类字样", () => {
    const files = pages.map((p) => join(root, p + ".js")).concat(join(root, "utils/b3.js"));
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      expect(s, f).not.toMatch(/setStorage|getStorage/);
      expect(s, f).not.toMatch(/openid|userInfo|OWNER_UID|AppSecret|SECRET/i);
    }
  });
  it("页面用到的云端调用都在门卫允许的范围里", async () => {
    const { isBatch3Action } = await import("../server/miniapp/batch3");
    const used = new Set<string>();
    for (const p of pages) for (const m of readFileSync(join(root, p + ".js"), "utf8").matchAll(/call\("([\w.]+)"/g)) used.add(m[1]);
    const business = new Set(["members.me", "members.directory", "members.avatar.set", "members.avatar.clear"]);
    for (const a of used) expect(isBatch3Action(a) || business.has(a) || a === "miniapp.me", a).toBe(true);
  });
  it("单个分包源码 < 2MB（库文件构建后另算，见构建脚本的体积检查）", () => {
    const size = (dir: string): number =>
      readdirSync(dir).reduce((n, f) => {
        const p = join(dir, f);
        return n + (statSync(p).isDirectory() ? size(p) : f.endsWith(".js") && dir.endsWith("lib") ? 0 : statSync(p).size);
      }, 0);
    for (const p of app.subpackages) expect(size(join(root, p.root))).toBeLessThan(2 * 1024 * 1024);
  });
});

describe("UTF-8 编解码（无 TextEncoder/TextDecoder 环境）", () => {
  it("中文、emoji、长文本和 Buffer 一致", async () => {
    const { utf8, utf8Decode } = await import("../src/miniapp-b3/sha256");
    for (const s of ["", "abc", "生意手账", "😀👍🏻", "混合 mixed 😀 文本".repeat(3000)]) {
      expect(Buffer.from(utf8(s)).equals(Buffer.from(s, "utf8"))).toBe(true);
      expect(utf8Decode(new Uint8Array(Buffer.from(s, "utf8")))).toBe(s);
    }
  });
});
