import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { ContentMemoryStore } from "../server/content/memory-store";
import { contentOnly } from "../server/content/guard";
import { CONTENT_ACTIONS, executeContent } from "../server/content/service";
import type { ListOptions, RawStore, RawTx } from "../server/content/types";

const SALES_COLLECTIONS = [
  "sales",
  "products",
  "batches",
  "customers",
  "tasks",
  "subscriptions",
  "deliveries",
];
const hash = async (s: string) => createHash("sha256").update(s).digest("hex");
const ctx = {
  uid: "o",
  ownerUid: "o",
  hash,
  now: () => "2026-10-19T13:00:00.000Z",
};

/** 记录每一次底层访问的集合名 */
function spy() {
  const inner = new ContentMemoryStore();
  const touched = new Set<string>();
  const wrapTx = (tx: RawTx): RawTx => ({
    get: (c, id) => (touched.add(c), tx.get(c, id)),
    put: (c, id, v) => (touched.add(c), tx.put(c, id, v)),
    del: (c, id) => (touched.add(c), tx.del(c, id)),
  });
  const raw: RawStore = {
    ...wrapTx(inner),
    list: <T>(c: string, o: ListOptions) => (
      touched.add(c),
      inner.list<T>(c, o)
    ),
    transaction: (fn) => inner.transaction((tx) => fn(wrapTx(tx))),
  };
  return { raw, touched };
}

describe("集合白名单 contentOnly()", () => {
  it("跑遍全部动作，只碰到 3 个 content_ 集合", async () => {
    const { raw, touched } = spy();
    const store = contentOnly(raw);
    const day = {
      date: "2026-10-19",
      wechat_adds: 2,
      leads: { 抖音: 1, 视频号: 1, 公众号: 0, 小红书: 0 },
      note: "",
    };
    const calls: [string, unknown][] = [
      ["session", {}],
      ["content.daily.save", { ...day, requestId: "req-00000001" }],
      ["content.daily.get", { date: day.date }],
      ["content.daily.list", { from: "2026-10-01", to: "2026-10-19" }],
      [
        "content.daily.delete",
        { date: day.date, revision: 1, requestId: "req-00000002" },
      ],
      [
        "content.daily.restore",
        { date: day.date, revision: 2, requestId: "req-00000003" },
      ],
      ["content.export.publishable", { from: "2026-10-13", to: "2026-10-19" }],
      ["content.backup", {}],
    ];
    expect(calls.map(([a]) => a).sort()).toEqual([...CONTENT_ACTIONS].sort());
    for (const [action, p] of calls)
      await executeContent(store, ctx, action, p);
    expect([...touched].sort()).toEqual([
      "content_audit",
      "content_daily",
      "content_receipts",
    ]);
  });
  it.each(SALES_COLLECTIONS)(
    "访问销售集合 %s 一律抛错，底层一次都没被调用",
    async (c) => {
      const { raw, touched } = spy();
      const store = contentOnly(raw) as any;
      await expect(store.get(c, "x")).rejects.toThrow(
        "内容函数不能访问这个集合",
      );
      await expect(store.put(c, "x", {})).rejects.toThrow("不能访问");
      await expect(store.del(c, "x")).rejects.toThrow("不能访问");
      await expect(store.list(c, { max: 1 })).rejects.toThrow("不能访问");
      await expect(
        store.transaction((tx: any) => tx.put(c, "x", {})),
      ).rejects.toThrow("不能访问");
      await expect(
        store.transaction((tx: any) => tx.get(c, "x")),
      ).rejects.toThrow("不能访问");
      await expect(
        store.transaction((tx: any) => tx.del(c, "x")),
      ).rejects.toThrow("不能访问");
      expect(touched.size).toBe(0);
    },
  );
  it("看起来像的名字也不行：content_ 前缀但不在清单里、大小写、空格", async () => {
    const store = contentOnly(spy().raw) as any;
    for (const c of [
      "content_other",
      "Content_daily",
      "content_daily ",
      "",
      "content_",
      null,
    ])
      await expect(store.get(c, "x")).rejects.toThrow("不能访问");
  });
  it("编号和读取条数也有上限", async () => {
    const store = contentOnly(spy().raw) as any;
    await expect(store.get("content_daily", "../sales")).rejects.toThrow(
      "编号无效",
    );
    await expect(store.list("content_daily", { max: 0 })).rejects.toThrow(
      "上限",
    );
    await expect(store.list("content_daily", { max: 5001 })).rejects.toThrow(
      "上限",
    );
    expect(Object.isFrozen(contentOnly(spy().raw))).toBe(true);
  });
});

describe("源码隔离", () => {
  it("content 云函数打包进来的源码只有内容自己的文件，不含任何销售代码", async () => {
    const result = await build({
      entryPoints: ["server/content-cloud.ts"],
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node18",
      write: false,
      metafile: true,
      logLevel: "silent",
      alias: {
        "lodash.set": resolve("vendor/lodash-set/index.cjs"),
        "lodash.unset": resolve("vendor/lodash-unset/index.cjs"),
      },
    });
    const own = Object.keys(result.metafile!.inputs)
      .map((f) => relative(process.cwd(), resolve(f)))
      .filter((f) => !f.includes("node_modules") && !f.startsWith("vendor/"))
      .sort();
    expect(own).toEqual([
      "server/content-cloud.ts",
      "server/content/cloud-store.ts",
      "server/content/guard.ts",
      "server/content/handler.ts",
      "server/content/service.ts",
      "server/content/types.ts",
      "src/domain/content.ts",
    ]);
  });
  const files = [
    "server/content-cloud.ts",
    "server/content/cloud-store.ts",
    "server/content/guard.ts",
    "server/content/handler.ts",
    "server/content/memory-store.ts",
    "server/content/service.ts",
    "server/content/types.ts",
    "src/domain/content.ts",
    "src/lib/content-api.ts",
    "src/lib/content-demo.ts",
    "src/components/ContentEntry.tsx",
  ];
  // 前端文件另外允许用公共的登录连接（src/lib/cloud.ts）和通用界面组件（src/components/ui.tsx）
  const ALLOWED = new Set([
    "server/content/cloud-store.ts",
    "server/content/guard.ts",
    "server/content/handler.ts",
    "server/content/memory-store.ts",
    "server/content/service.ts",
    "server/content/types.ts",
    "src/domain/content.ts",
    "src/lib/content-api.ts",
    "src/content-entry.css",
  ]);
  const FRONT_END_SHARED = new Set([
    "src/lib/cloud.ts",
    "src/components/ui.tsx",
  ]);
  it.each(files)("%s 不引用销售代码、不写销售集合名", (file) => {
    const text = readFileSync(file, "utf8");
    const local = [...text.matchAll(/(?:from|import)\s+"(\.[^"]+)"/g)].map(
      (m) => {
        const target = relative(process.cwd(), resolve(dirname(file), m[1]));
        return /\.(ts|tsx|css)$/.test(target)
          ? target
          : [".ts", ".tsx"].map((x) => target + x).find((t) => existsSync(t)) ||
              target;
      },
    );
    for (const target of local) {
      const ok =
        ALLOWED.has(target) ||
        (file.startsWith("src/") && FRONT_END_SHARED.has(target));
      expect(ok, `${file} 引用了 ${target}`).toBe(true);
    }
    for (const c of SALES_COLLECTIONS)
      expect(text, `出现销售集合名 "${c}"`).not.toMatch(
        new RegExp(`["'\`]${c}["'\`]`),
      );
    // 只有 cloud-store.ts 能直接碰数据库对象
    if (file !== "server/content/cloud-store.ts")
      expect(text).not.toMatch(/\.collection\(|runTransaction/);
  });
  it("前端内容接口只调用 content 函数", () => {
    const text = readFileSync("src/lib/content-api.ts", "utf8");
    expect(text).toContain('CONTENT_FUNCTION = "content"');
    expect(text).not.toMatch(/VITE_CLOUDBASE_FUNCTION|"sales"/);
  });
});

describe("销售那边一个字节都不变", () => {
  it("数据库规则清单：原有 7 条原样不动，只在末尾追加 3 条 content_ 规则", () => {
    const lines = readFileSync("database.rules.json", "utf8").split("\n");
    expect(lines.slice(0, 8)).toEqual([
      "{",
      '  "sales": { "read": false, "write": false },',
      '  "products": { "read": false, "write": false },',
      '  "batches": { "read": false, "write": false },',
      '  "customers": { "read": false, "write": false },',
      '  "tasks": { "read": false, "write": false },',
      '  "subscriptions": { "read": false, "write": false },',
      // JSON 语法要求：原来最后一行只多了一个逗号
      '  "deliveries": { "read": false, "write": false },',
    ]);
    const rules = JSON.parse(lines.join("\n"));
    expect(Object.keys(rules)).toEqual([
      ...SALES_COLLECTIONS,
      "content_daily",
      "content_audit",
      "content_receipts",
    ]);
    for (const v of Object.values(rules))
      expect(v).toEqual({ read: false, write: false });
  });
  it("sales / reminders / sales-stats 云函数包和基线逐字节一致", () => {
    execFileSync(process.execPath, ["scripts/build-server.mjs"], {
      stdio: "pipe",
    });
    const out = execFileSync(
      process.execPath,
      ["scripts/verify-sales-bundles.mjs"],
      {
        encoding: "utf8",
      },
    );
    expect(out).toContain("逐字节一致");
  }, 60000);
});
