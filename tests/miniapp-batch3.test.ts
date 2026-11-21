import { createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { handle } from "../server/handler";
import type { Store } from "../server/service";
import type { TeamConfig } from "../server/team";
import { handleMiniapp, type MiniappDeps } from "../server/miniapp/gate";
import type { PlatformIdentity } from "../server/miniapp/source";
import type { MiniStore, MiniTx } from "../server/miniapp/types";
import { B3_LIMITS, DEFAULT_TASK_TEMPLATE, batch3ConfigFromEnv, type Batch3Deps, type MiniSub } from "../server/miniapp/batch3";
import { boardSummary } from "../server/miniapp/board";
import { ContentMemoryStore } from "../server/content/memory-store";
import { contentOnly } from "../server/content/guard";
import { handleContent } from "../server/content/handler";

class Mem implements MiniStore {
  data: Record<string, Record<string, unknown>> = {};
  private queue = Promise.resolve();
  private col(c: string) {
    return (this.data[c] ??= {});
  }
  async get<T>(c: string, id: string) {
    return structuredClone(this.col(c)[id] ?? null) as T | null;
  }
  async put<T>(c: string, id: string, v: T) {
    this.col(c)[id] = structuredClone(v);
  }
  async del(c: string, id: string) {
    delete this.col(c)[id];
  }
  async list<T>(c: string) {
    return structuredClone(Object.values(this.col(c))) as T[];
  }
  async transaction<T>(fn: (tx: MiniTx) => Promise<T>) {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const prev = this.queue;
    this.queue = prev.then(() => next);
    await prev;
    const saved = structuredClone(this.data);
    try {
      return await fn(this);
    } catch (e) {
      this.data = saved;
      throw e;
    } finally {
      release();
    }
  }
}

const OWNER = "uid-owner";
const APPID = "wx0123456789abcdef";
const JASON_WX = { openid: "o-jason-0001", appid: APPID };
const ALICE_WX = { openid: "o-alice-0001", appid: APPID };
const STRANGER_WX = { openid: "o-nobody-001", appid: APPID };
const WEB_OWNER: PlatformIdentity = { uid: OWNER };
const hash = async (v: string) => createHash("sha256").update(v).digest("hex");
const TEAM: TeamConfig = { membersEnabled: true, auditEnabled: true, scheduleOwnerEnabled: true };
const TPL = { MINIAPP_TPL_TASK: "tpl_task_0000000001", MINIAPP_TPL_APPLY: "tpl_apply_000000001" };
type R = { ok: boolean; data?: any; code?: string; error?: string };

function setup(opts: { notify?: boolean; enabled?: boolean; b3?: Partial<Batch3Deps>; noBatch3?: boolean } = {}) {
  const store = new Mem();
  const content = new ContentMemoryStore();
  const clock = Date.parse("2026-11-18T02:00:00.000Z");
  const now = () => new Date(clock).toISOString();
  const business: MiniappDeps["business"] = (uid, e) =>
    handle(() => store as unknown as Store, { uid, ownerUid: OWNER, hash, now }, e, undefined, undefined, TEAM);
  const fetched: string[] = [];
  const batch3: Batch3Deps = {
    config: batch3ConfigFromEnv({ ...(opts.notify ? { MINIAPP_NOTIFY_ENABLED: "1" } : {}), ...TPL }),
    now,
    business,
    content: (uid, e) => handleContent(() => contentOnly(content), { uid, ownerUid: OWNER, hash, now }, e),
    board: () => boardSummary(),
    fetchText: async (url) => {
      fetched.push(url);
      return cdn.get(url) ?? "";
    },
    ...opts.b3,
  };
  const cdn = new Map<string, string>();
  const deps: MiniappDeps = {
    store: () => store,
    ownerUid: OWNER,
    config: { enabled: opts.enabled ?? true },
    team: TEAM,
    now,
    hash,
    random: (n) => new Uint8Array(randomBytes(n)),
    business,
    ...(opts.noBatch3 ? {} : { batch3 }),
  };
  const call = (who: PlatformIdentity, action: string, payload: Record<string, unknown> = {}) =>
    handleMiniapp(deps, who, { action, payload }) as Promise<R>;
  return { store, content, call, cdn, fetched };
}
type T = ReturnType<typeof setup>;
async function bindJason(t: T) {
  const code = (await t.call(WEB_OWNER, "miniapp.owner.code")).data.code as string;
  expect((await t.call(JASON_WX, "miniapp.owner.redeem", { code })).ok).toBe(true);
}
async function bindAlice(t: T) {
  await t.call(ALICE_WX, "miniapp.apply", { name: "示例成员甲", phone: "13800001234", agree: true });
  const id = (await t.call(WEB_OWNER, "miniapp.apply.list")).data.pending[0].id;
  return (await t.call(WEB_OWNER, "miniapp.apply.approve", { id })).data.uid as string;
}
const ROWS = [
  { productId: "", productName: "示例商品甲", customer: "示例客户 · 小林", date: "2026-11-01", revenue: 10000, cost: 4000, note: "", sourceRow: 2, sourceProfit: 6000 },
  { productId: "", productName: "示例商品乙", customer: "示例客户 · 阿远", date: "2026-11-02", revenue: 20000, cost: 5000, note: "", sourceRow: 3, sourceProfit: 15000 },
];
const DIGEST = "a".repeat(64);

describe("第 3 批 · 权限：和网页一致，只认平台身份", () => {
  it("没绑定的人、网页来源、开关关着都进不来", async () => {
    const t = setup();
    expect(await t.call(STRANGER_WX, "miniapp.import.preview", { rowsJson: "[]", digest: DIGEST })).toMatchObject({ ok: false, code: "NO_ACCESS" });
    expect(await t.call(STRANGER_WX, "content.daily.list", {})).toMatchObject({ ok: false, code: "NO_ACCESS" });
    expect(await t.call(WEB_OWNER, "miniapp.backup.export")).toMatchObject({ ok: false, code: "WEB_NOT_ALLOWED" });
    expect(await t.call(WEB_OWNER, "content.daily.list")).toMatchObject({ ok: false, code: "WEB_NOT_ALLOWED" });
    const off = setup({ enabled: false });
    expect(await off.call(JASON_WX, "miniapp.subscribe.config")).toMatchObject({ ok: false, code: "MINIAPP_OFF" });
  });
  it("成员不能导入、备份、恢复、录内容、看内容看板；可以看自己的订阅次数", async () => {
    const t = setup();
    await bindJason(t);
    await bindAlice(t);
    for (const a of ["miniapp.import.preview", "miniapp.import.commit", "miniapp.backup.export", "miniapp.backup.restore", "miniapp.content.board", "content.daily.list", "content.daily.save"])
      expect(await t.call(ALICE_WX, a, {})).toMatchObject({ ok: false, code: "ADMIN_ONLY" });
    const cfg = await t.call(ALICE_WX, "miniapp.subscribe.config");
    expect(cfg.ok).toBe(true);
    expect(Object.keys(cfg.data.templates)).toEqual(["task"]); // 新申请提醒只给管理员
  });
  it("不配第 3 批时，门卫行为和第 1 批完全一样（content.* 照旧交给业务代码）", async () => {
    const t = setup({ noBatch3: true });
    await bindJason(t);
    const r = await t.call(JASON_WX, "content.daily.list", {});
    expect(r.ok).toBe(false);
    expect(r.code).not.toBe("ADMIN_ONLY");
  });
});

describe("导入飞书历史 Excel（10a）", () => {
  it("预检 → 分批提交 → 再导同一个文件不重复", async () => {
    const t = setup();
    await bindJason(t);
    const pre = await t.call(JASON_WX, "miniapp.import.preview", { rowsJson: JSON.stringify(ROWS), digest: DIGEST });
    expect(pre).toMatchObject({ ok: true, data: { duplicateRows: [], alreadyImported: false } });
    expect(pre.data.totals).toMatchObject({ revenue: 30000, count: 2 });
    let r: R;
    do r = await t.call(JASON_WX, "miniapp.import.commit", { rowsJson: JSON.stringify(ROWS), digest: DIGEST, fileName: "历史.xlsx" });
    while (r.ok && r.data.done === false);
    expect(r).toMatchObject({ ok: true, data: { count: 2, done: true } });
    const again = await t.call(JASON_WX, "miniapp.import.commit", { rowsJson: JSON.stringify(ROWS), digest: DIGEST, fileName: "历史.xlsx" });
    expect(again.data).toMatchObject({ repeated: true });
    expect(Object.keys(t.store.data.sales)).toHaveLength(2);
    const dup = await t.call(JASON_WX, "miniapp.import.preview", { rowsJson: JSON.stringify(ROWS), digest: "b".repeat(64) });
    expect(dup.data.duplicateRows).toEqual([2, 3]);
  });
  it("大表格走 wx.cloud.CDN：只认 https 地址；坏 JSON、超大都拒收", async () => {
    const t = setup();
    await bindJason(t);
    t.cdn.set("https://cdn.example.invalid/rows", JSON.stringify(ROWS));
    const r = await t.call(JASON_WX, "miniapp.import.preview", { rowsUrl: "https://cdn.example.invalid/rows", digest: DIGEST });
    expect(r.ok).toBe(true);
    expect(t.fetched).toEqual(["https://cdn.example.invalid/rows"]);
    expect(await t.call(JASON_WX, "miniapp.import.preview", { rowsUrl: "http://cdn.example.invalid/rows", digest: DIGEST })).toMatchObject({ ok: false, code: "B3_BAD_PAYLOAD" });
    expect(await t.call(JASON_WX, "miniapp.import.preview", { rowsJson: "{坏", digest: DIGEST })).toMatchObject({ ok: false, code: "B3_BAD_JSON" });
    expect(await t.call(JASON_WX, "miniapp.import.preview", { rowsJson: "x".repeat(B3_LIMITS.importMaxBytes + 1), digest: DIGEST })).toMatchObject({ ok: false, code: "B3_TOO_LARGE" });
  });
});

describe("完整备份 / 从备份恢复（10b）", () => {
  it("备份是 gzip+base64，解开就是网页同款 JSON；能恢复到另一个空账本", async () => {
    const a = setup();
    await bindJason(a);
    let r: R;
    do r = await a.call(JASON_WX, "miniapp.import.commit", { rowsJson: JSON.stringify(ROWS), digest: DIGEST, fileName: "历史.xlsx" });
    while (r.data.done === false);
    const exp = await a.call(JASON_WX, "miniapp.backup.export");
    expect(exp.ok).toBe(true);
    const json = gunzipSync(Buffer.from(exp.data.gz, "base64")).toString("utf8");
    const backup = JSON.parse(json);
    expect(backup).toMatchObject({ format: "zhangyuge-sales", version: 2 });
    expect(backup.sales).toHaveLength(2);
    expect(exp.data.bytes).toBe(Buffer.byteLength(json));

    const b = setup();
    await bindJason(b);
    const gz = gzipSync(Buffer.from(json)).toString("base64");
    do r = await b.call(JASON_WX, "miniapp.backup.restore", { backupGz: gz });
    while (r.ok && r.data.done === false);
    expect(r).toMatchObject({ ok: true, data: { done: true, count: 2 } });
    expect(Object.keys(b.store.data.sales)).toHaveLength(2);
    // 已经有数据的账本：拒绝，现有记录不覆盖
    expect(await a.call(JASON_WX, "miniapp.backup.restore", { backupGz: gz })).toMatchObject({ ok: false, error: "备份恢复仅用于空账本，现有记录不会被覆盖" });
  });
  it("坏文件、超大解压都拒收；回包超过 1MB 时提示去网页下载", async () => {
    const t = setup();
    await bindJason(t);
    expect(await t.call(JASON_WX, "miniapp.backup.restore", { backupGz: "不是base64" })).toMatchObject({ ok: false, code: "B3_BAD_PAYLOAD" });
    const bomb = gzipSync(Buffer.alloc(B3_LIMITS.backupMaxBytes + 10, 32)).toString("base64");
    expect(await t.call(JASON_WX, "miniapp.backup.restore", { backupGz: bomb })).toMatchObject({ ok: false, code: "B3_BAD_PAYLOAD" });
    const big = setup({
      b3: { business: async () => ({ ok: true, data: { exportedAt: "x", sales: [randomBytes(1_200_000).toString("hex")] } }) },
    });
    await bindJason(big);
    expect(await big.call(JASON_WX, "miniapp.backup.export")).toMatchObject({ ok: false, code: "BACKUP_TOO_LARGE" });
  });
});

describe("内容生产（13 / 13a）", () => {
  it("录入走同一套 content 逻辑：四个来源合计必须等于新增；导出、备份留在网页", async () => {
    const t = setup();
    await bindJason(t);
    const bad = await t.call(JASON_WX, "content.daily.save", { requestId: "mp-req-0001", date: "2026-11-18", wechat_adds: 3, leads: { 抖音: 1, 视频号: 0, 公众号: 0, 小红书: 0 }, note: "" });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/对不上/);
    const ok = await t.call(JASON_WX, "content.daily.save", { requestId: "mp-req-0002", date: "2026-11-18", wechat_adds: 3, leads: { 抖音: 2, 视频号: 1, 公众号: 0, 小红书: 0 }, note: "示例备注" });
    expect(ok).toMatchObject({ ok: true, data: { date: "2026-11-18", revision: 1, wechat_adds: 3 } });
    expect((await t.call(JASON_WX, "content.daily.get", { date: "2026-11-18" })).data.revision).toBe(1);
    expect((await t.call(JASON_WX, "content.daily.list", { from: "2026-11-12", to: "2026-11-18" })).data).toHaveLength(1);
    expect(await t.call(JASON_WX, "content.export.publishable", {})).toMatchObject({ ok: false, code: "NOT_IN_MINIAPP" });
    expect(await t.call(JASON_WX, "content.backup", {})).toMatchObject({ ok: false, code: "NOT_IN_MINIAPP" });
    // 内容数据只进 content 集合，不进销售库
    expect(Object.keys(t.store.data.content_daily ?? {})).toHaveLength(0);
  });
  it("看板只读版：摘要字段齐全、回包小、不带平台作品链接", async () => {
    const t = setup();
    await bindJason(t);
    const r = await t.call(JASON_WX, "miniapp.content.board");
    expect(r.ok).toBe(true);
    const b = r.data;
    expect(b.kpis.length).toBeGreaterThan(3);
    expect(b.stages.length).toBe(7);
    expect(b.topics.length).toBeGreaterThan(0);
    expect(b.topics.length).toBeLessThanOrEqual(10);
    expect(b.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(JSON.stringify(b).length).toBeLessThan(60_000);
    expect(JSON.stringify(b)).not.toMatch(/douyin\.com|board-[0-9a-f]{12}/);
    expect(b.webUrl).toBe("https://jasonchou0202.github.io/JasonAI/");
  });
});

describe("订阅消息额度（miniapp.subscribe.*、miniapp_subs）", () => {
  it("发送开关关：仍可记下额度，enabled 为 false", async () => {
    const t = setup();
    await bindJason(t);
    const r = await t.call(JASON_WX, "miniapp.subscribe.record", { results: { tpl_task_0000000001: "accept" } });
    expect(r).toMatchObject({ ok: true, data: { enabled: false, recorded: 1, quota: { task: 1 } } });
    expect(Object.keys(t.store.data.miniapp_subs ?? {})).toHaveLength(1);
  });
  it("开关开：同意一次加 1 次，上限 50；openid 存库但永不返回；成员记不了「新申请」", async () => {
    const t = setup({ notify: true });
    await bindJason(t);
    const aliceUid = await bindAlice(t);
    const r = await t.call(JASON_WX, "miniapp.subscribe.record", { results: { tpl_task_0000000001: "accept", tpl_apply_000000001: "reject" } });
    expect(r.data).toMatchObject({ enabled: true, recorded: 1, quota: { task: 1, apply: 0 } });
    expect(JSON.stringify(r)).not.toMatch(/o-jason/);
    const saved = Object.values(t.store.data.miniapp_subs) as MiniSub[];
    expect(saved[0]).toMatchObject({ uid: OWNER, kind: "owner", openid: "o-jason-0001" });
    for (let i = 0; i < 60; i++) await t.call(JASON_WX, "miniapp.subscribe.record", { results: { tpl_task_0000000001: "accept" } });
    expect((await t.call(JASON_WX, "miniapp.subscribe.config")).data.quota.task).toBe(50);
    const a = await t.call(ALICE_WX, "miniapp.subscribe.record", { results: { tpl_task_0000000001: "accept", tpl_apply_000000001: "accept" } });
    expect(a.data).toMatchObject({ recorded: 1, quota: { task: 1 } });
    expect(a.data.quota.apply).toBeUndefined();
    const mine = (Object.values(t.store.data.miniapp_subs) as MiniSub[]).find((s) => s.uid === aliceUid)!;
    expect(mine.quota.apply).toBe(0);
    // 不认识的模板、乱填的结果：不加次数
    expect((await t.call(ALICE_WX, "miniapp.subscribe.record", { results: { other: "accept" } })).data.recorded).toBe(0);
    expect((await t.call(ALICE_WX, "miniapp.subscribe.record", { results: "accept" })).data.recorded).toBe(0);
  });
  it("模板 ID 格式不对则回退到默认待办模板；发送开关只认 =1", () => {
    expect(batch3ConfigFromEnv({ MINIAPP_TPL_TASK: "bad id!", MINIAPP_NOTIFY_ENABLED: "true" })).toEqual({
      notifyEnabled: false,
      templates: { task: DEFAULT_TASK_TEMPLATE },
    });
    expect(batch3ConfigFromEnv({}).templates.task).toBe(DEFAULT_TASK_TEMPLATE);
    expect(batch3ConfigFromEnv({ MINIAPP_NOTIFY_ENABLED: "1" }).notifyEnabled).toBe(true);
  });
});

describe("reminders 小程序版入口", () => {
  it("MINIAPP_NOTIFY_ENABLED 关：原样返回原提醒结果，不初始化任何东西", async () => {
    vi.resetModules();
    const base = { configured: true, accepted: 1 };
    vi.doMock("../server/reminder-cloud", () => ({ main: vi.fn(async () => base) }));
    const init = vi.fn();
    vi.doMock("@cloudbase/node-sdk", () => ({ default: { init, SYMBOL_CURRENT_ENV: "x" } }));
    const saved = process.env.MINIAPP_NOTIFY_ENABLED;
    delete process.env.MINIAPP_NOTIFY_ENABLED;
    const mod = await import("../server/reminder-cloud-miniapp");
    expect(await mod.main({ Type: "Timer" }, {})).toBe(base);
    expect(init).not.toHaveBeenCalled();
    process.env.MINIAPP_NOTIFY_ENABLED = "1";
    const failed = { ok: false, error: "REMINDER_AUTH_FAILED" };
    vi.doMock("../server/reminder-cloud", () => ({ main: vi.fn(async () => failed) }));
    vi.resetModules();
    const mod2 = await import("../server/reminder-cloud-miniapp");
    expect(await mod2.main({}, {})).toBe(failed); // 原提醒没通过校验：小程序通知一行都不跑
    if (saved === undefined) delete process.env.MINIAPP_NOTIFY_ENABLED;
    else process.env.MINIAPP_NOTIFY_ENABLED = saved;
    vi.doUnmock("../server/reminder-cloud");
    vi.doUnmock("@cloudbase/node-sdk");
  });
});
