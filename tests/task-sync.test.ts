import { createECDH, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../server/memory-store";
import { execute } from "../server/service";
import { handle } from "../server/handler";
import { subscriptionId, type PushConfig, type PushSender, type PushSubscription } from "../server/push";
import { runReminders } from "../server/reminders";
import {
  handleSync, parseSyncEvent, rateLimiter, syncFailure, SyncError, SYNC_LOG,
} from "../server/task-sync";
import { MONEY_MASK as M, stripMoney, taskSyncTitle } from "../src/domain/taskSyncTitle.mjs";
import type { Customer, CustomerTask } from "../src/domain/model";

const NOW = "2026-10-24T04:00:00.000Z";
const KEY = "k".repeat(32) + "-test-sync-key";
const hash = async (v: string) => createHash("sha256").update(v).digest("hex");
const cust = (id: string, name: string, mergedInto: string | null = null): Customer =>
  ({ id, name, mergedInto, revision: 1, createdAt: NOW, updatedAt: NOW }) as Customer;
const task = (id: string, at: string, extra: Partial<CustomerTask> = {}): CustomerTask => ({
  id, customerId: "child", at, title: "续费跟进", feedback: "满意", nextAction: "发报价",
  reminder: "both", completedAt: null, deletedAt: null, createdAt: NOW, updatedAt: NOW,
  revision: 3, reminderGeneration: "g", reminderStartAt: NOW, ...extra,
});
function seed() {
  const s = new MemoryStore();
  s.data.customers = { root: cust("root", "✅李德嘉"), child: cust("child", "李德嘉 1.2.3.4", "root") };
  s.data.sales = { s1: { id: "s1", customer: "李德嘉", revenue: 189900, cost: 100000 } };
  s.data.tasks = {
    inside: task("inside", "2026-10-30T02:00:00.000Z"),
    pastEdge: task("pastEdge", "2026-10-17T05:00:00.000Z", {
      title: "续费，费用：1899元", feedback: "预算1.5万，定金3k", nextAction: "报价 ¥1,299.00 待确认",
    }),
    tooOld: task("tooOld", "2026-10-16T00:00:00.000Z"),
    tooFar: task("tooFar", "2027-01-25T00:00:00.000Z"),
    gone: task("gone", "2026-10-25T00:00:00.000Z", { deletedAt: NOW }),
  };
  return s;
}
const run = (
  s: MemoryStore, action: string, payload: any = {},
  opts: { key?: unknown; envKey?: string | undefined; now?: string; limit?: (n: number) => void } = {},
) =>
  handleSync(() => s, {
    key: "envKey" in opts ? opts.envKey : KEY, now: () => opts.now ?? NOW, hash, limit: opts.limit,
  }, { action, payload, key: "key" in opts ? opts.key : KEY }) as Promise<any>;
let req = 0;
const done = (id: string, revision: number, completedAt: string | null, extra: object = {}) =>
  ({ id, revision, completedAt, requestId: "r" + ++req, ...extra });

describe("tasks.sync.list", () => {
  it("只返回未删除、过去7天到未来90天的日程，客户名取合并后的根客户", async () => {
    const r = await run(seed(), "tasks.sync.list");
    expect(r.ok).toBe(true);
    expect(r.data.tasks.map((t: any) => t.id)).toEqual(["pastEdge", "inside"]);
    expect(r.data.tasks[0].customer).toBe("李德嘉");
  });
  it("返回字段固定；title/feedback/nextAction/客户名都去掉金额", async () => {
    const r = await run(seed(), "tasks.sync.list");
    for (const t of r.data.tasks)
      expect(Object.keys(t).sort()).toEqual(
        ["at", "completedAt", "customer", "feedback", "id", "nextAction", "reminder", "revision", "title"],
      );
    expect(r.data.tasks[0]).toMatchObject({ title: "续费，" + M, feedback: M + "，" + M, nextAction: M + "待确认" });
    const text = JSON.stringify(r);
    for (const word of ["revenue", "cost", "profit", "tier", "payment", "189900", "100000", "1899", "1.5万", "3k", "¥", "元"])
      expect(text).not.toContain(word);
  });
});

describe("鉴权与限流", () => {
  it("密钥错误、缺失、未配置或少于32字节时两个接口都拒绝", async () => {
    for (const action of ["tasks.sync.list", "tasks.sync.complete"]) {
      const p = done("inside", 3, NOW);
      expect(await run(seed(), action, p, { key: "wrong" })).toMatchObject({ ok: false, code: "SYNC_UNAUTHORIZED" });
      expect(await run(seed(), action, p, { key: undefined })).toMatchObject({ ok: false, code: "SYNC_UNAUTHORIZED" });
      for (const envKey of [undefined, "", "x".repeat(31)])
        expect(await run(seed(), action, p, { envKey, key: envKey })).toMatchObject({ ok: false, code: "SYNC_DISABLED" });
    }
    expect(await run(seed(), "tasks.sync.list", {}, { envKey: "x".repeat(32), key: "x".repeat(32) })).toMatchObject({ ok: true });
  });
  it("同步密钥不能调用其他操作", async () => {
    for (const action of ["backup", "sales.list", "tasks.complete", "dashboard"])
      expect(await run(seed(), action)).toMatchObject({ ok: false, code: "SYNC_FORBIDDEN" });
    expect(parseSyncEvent({ action: "backup", syncKey: KEY })).not.toBeNull();
  });
  it("普通登录通道也调不到同步接口", async () => {
    const r = await handle(() => seed(), { uid: "o", ownerUid: "o", hash }, { action: "tasks.sync.list" });
    expect(r.ok).toBe(false);
    await expect(execute(seed(), { uid: "o", ownerUid: "o", hash }, "tasks.sync.complete", {})).rejects.toThrow();
  });
  it("HTTP 访问事件：Bearer 头或 x-task-sync-key 头，只接受 POST", async () => {
    const body = JSON.stringify({ action: "tasks.sync.list" });
    const a = parseSyncEvent({ httpMethod: "POST", headers: { Authorization: "Bearer " + KEY }, body });
    const b = parseSyncEvent({ httpMethod: "POST", headers: { "X-Task-Sync-Key": KEY }, body: Buffer.from(body).toString("base64"), isBase64Encoded: true });
    expect(a).toMatchObject({ action: "tasks.sync.list", key: KEY });
    expect(b).toMatchObject({ action: "tasks.sync.list", key: KEY });
    expect(() => parseSyncEvent({ httpMethod: "GET", headers: {} })).toThrow(SyncError);
  });
  it("内存限流只统计密钥错误的请求；正确密钥不占额度，下个窗口恢复", async () => {
    const limit = rateLimiter({ windowMs: 60_000, max: 2 });
    const s = seed();
    for (let i = 0; i < 5; i++) expect((await run(s, "tasks.sync.list", {}, { limit })).ok).toBe(true);
    expect(await run(s, "tasks.sync.list", {}, { limit, key: "bad" })).toMatchObject({ code: "SYNC_UNAUTHORIZED" });
    expect(await run(s, "tasks.sync.list", {}, { limit, key: "bad" })).toMatchObject({ code: "SYNC_UNAUTHORIZED" });
    expect(await run(s, "tasks.sync.list", {}, { limit, key: "bad" })).toMatchObject({ ok: false, code: "SYNC_RATE_LIMITED" });
    expect((await run(s, "tasks.sync.list", {}, { limit })).ok).toBe(true);
    expect(await run(s, "tasks.sync.list", {}, { limit, key: "bad", now: "2026-10-24T04:01:00.000Z" })).toMatchObject({ code: "SYNC_UNAUTHORIZED" });
  });
  it("非 SyncError 不外泄原始报错", () => {
    expect(syncFailure(new Error("db password=xxx at line 3"))).toEqual({ ok: false, code: "SYNC_FAILED", error: "云端操作未完成，请稍后重试" });
    expect(syncFailure(new SyncError("SYNC_CONFLICT", "冲突"))).toEqual({ ok: false, code: "SYNC_CONFLICT", error: "冲突" });
  });
});

describe("tasks.sync.complete", () => {
  it("只改 completedAt（及与 tasks.complete 同一套的 revision/updatedAt/lastMutation/提醒代次），写一条日志", async () => {
    const s = seed();
    const before = structuredClone(s.data.tasks.inside) as CustomerTask;
    const p = done("inside", 3, "2026-10-24T11:30:00+08:00", { title: "改标题", deletedAt: NOW });
    const r = await run(s, "tasks.sync.complete", p);
    expect(r).toMatchObject({ ok: true, data: { id: "inside", revision: 4, completedAt: "2026-10-24T03:30:00.000Z" } });
    const after = s.data.tasks.inside as CustomerTask;
    const pick = ({ completedAt, revision, updatedAt, lastMutation, reminderGeneration, reminderStartAt, ...rest }: CustomerTask) => rest;
    expect(pick(after)).toEqual(pick(before));
    expect(after).toMatchObject({ revision: 4, updatedAt: NOW, lastMutation: p.requestId, reminderStartAt: NOW });
    expect(after.reminderGeneration).not.toBe(before.reminderGeneration);
    const logs = Object.values(s.data[SYNC_LOG]);
    expect(logs).toEqual([expect.objectContaining({ at: NOW, taskId: "inside", requestId: p.requestId, before: null, after: "2026-10-24T03:30:00.000Z", revision: 4 })]);
    expect(Object.keys(s.data.tasks).length).toBe(5);
    expect(s.data.sales).toEqual(seed().data.sales);
    const back = await run(s, "tasks.sync.complete", done("inside", 4, null));
    expect(back).toMatchObject({ ok: true, data: { completedAt: null, revision: 5 } });
    expect(Object.values(s.data[SYNC_LOG]).length).toBe(2);
  });
  it("同一 requestId 重放是幂等的：结果相同，不重复写库和日志", async () => {
    const s = seed();
    const p = done("inside", 3, NOW);
    const first = await run(s, "tasks.sync.complete", p);
    const again = await run(s, "tasks.sync.complete", p);
    expect(again).toEqual(first);
    expect((s.data.tasks.inside as CustomerTask).revision).toBe(4);
    expect(Object.values(s.data[SYNC_LOG]).length).toBe(1);
    expect(await run(s, "tasks.sync.complete", { ...p, completedAt: null })).toMatchObject({ ok: false });
  });
  it("revision 对不上返回冲突，不写库不写日志", async () => {
    const s = seed();
    expect(await run(s, "tasks.sync.complete", done("inside", 2, NOW))).toMatchObject({ ok: false, code: "SYNC_CONFLICT" });
    expect((s.data.tasks.inside as CustomerTask).revision).toBe(3);
    expect(Object.values(s.data[SYNC_LOG])).toEqual([]);
  });
  it("已删除或不存在的日程拒绝，不新建", async () => {
    const s = seed();
    expect(await run(s, "tasks.sync.complete", done("gone", 3, NOW))).toMatchObject({ ok: false, code: "SYNC_DELETED" });
    expect(await run(s, "tasks.sync.complete", done("nope", 1, NOW))).toMatchObject({ ok: false, code: "SYNC_NOT_FOUND" });
    expect(Object.keys(s.data.tasks).length).toBe(5);
    expect(Object.values(s.data[SYNC_LOG])).toEqual([]);
  });
  it("completedAt 不能晚于现在+5分钟；参数格式错误拒绝", async () => {
    const s = seed();
    expect((await run(s, "tasks.sync.complete", done("inside", 3, "2026-10-24T04:05:00.000Z"))).ok).toBe(true);
    for (const p of [
      done("pastEdge", 3, "2026-10-24T04:05:01.000Z"),
      done("pastEdge", 3, "昨天"),
      { id: "pastEdge", revision: 3, requestId: "x1" },
      { id: "pastEdge", completedAt: NOW, requestId: "x2" },
      { id: "pastEdge", revision: 3, completedAt: NOW },
    ])
      expect(await run(s, "tasks.sync.complete", p)).toMatchObject({ ok: false, code: "SYNC_BAD_REQUEST" });
    expect((s.data.tasks.pastEdge as CustomerTask).completedAt).toBeNull();
  });
});

describe("与提醒推送联动", () => {
  const ec = createECDH("prime256v1");
  ec.generateKeys();
  const config: PushConfig = {
    publicKey: ec.getPublicKey().toString("base64url"),
    privateKey: ec.getPrivateKey().toString("base64url"),
    subject: "https://jasonchou0202.github.io/JasonAI/",
    ownerUid: "owner",
  };
  const due = Date.parse("2026-10-24T05:00:00.000Z");
  it("同步完成后不再推送；重新打开后恢复提醒", async () => {
    const s = seed();
    const endpoint = "https://fcm.googleapis.com/fcm/send/device-1";
    const sub: PushSubscription = {
      id: subscriptionId("owner", endpoint), uid: "owner", endpoint,
      keys: { p256dh: config.publicKey, auth: Buffer.alloc(16, 7).toString("base64url") },
      active: true, createdAt: "2026-10-24T01:00:00.000Z", updatedAt: "2026-10-24T01:00:00.000Z",
    };
    s.data.subscriptions = { [sub.id]: sub };
    s.data.tasks.inside = task("inside", new Date(due).toISOString(), { reminder: "due", reminderStartAt: "2026-10-24T01:00:00.000Z" });
    const sent: unknown[] = [];
    const send: PushSender = async (_s, n) => (sent.push(n), { statusCode: 201 });
    expect((await run(s, "tasks.sync.complete", done("inside", 3, NOW))).ok).toBe(true);
    await runReminders(s, config, send, due);
    expect(sent).toHaveLength(0);
    expect((await run(s, "tasks.sync.complete", done("inside", 4, null), { now: "2026-10-24T04:10:00.000Z" })).ok).toBe(true);
    await runReminders(s, config, send, due);
    expect(sent).toHaveLength(1);
  });
});

describe("提醒事项标题（唯一实现）", () => {
  const cases: [string, string, string][] = [
    ["✅李德嘉", "ChatGPT Pro 到期", "李德嘉 · ChatGPT Pro 到期"],
    ["王五", "续费，费用：1899元", "王五 · 续费，" + M],
    ["王五", "报价 ¥1,299.00 待确认", "王五 · " + M + "待确认"],
    ["王五", "尾款 500 元（费用 ¥300）", "王五 · " + M],
    ["王五", "收定金3k", "王五 · 收" + M],
    ["王五", "预算1.5万 方案沟通", "王五 · " + M + "方案沟通"],
    ["王五", "年费 2w 续约", "王五 · 年费" + M + "续约"],
    ["王五", "$20 订阅续费", "王五 · " + M + "订阅续费"],
    ["王五", "代付 30块", "王五 · 代" + M],
    // 中文数字、全角数字
    ["王五", "续费一千八百元", "王五 · 续费" + M],
    ["王五", "三千块 尾款", "王五 · " + M + "尾款"],
    ["王五", "已收¥１８９９", "王五 · 已" + M],
    // 每月/每年、量级尾数、约
    ["王五", "999元/年 续费", "王五 · " + M + "续费"],
    ["王五", "499/月 订阅", "王五 · " + M + "订阅"],
    ["王五", "报价2千5", "王五 · " + M],
    ["王五", "单子2千5搞定", "王五 · 单子" + M + "搞定"],
    ["王五", "约2万的单子", "王五 · " + M + "的单子"],
    // 无单位的写法
    ["王五", "收了1899", "王五 · " + M],
    ["王五", "付款 1899 待确认", "王五 · " + M + "待确认"],
    ["王五", "转账2000", "王五 · " + M],
    ["王五", "收款：3000", "王五 · " + M],
    ["王五", "八折后1200", "王五 · " + M],
    ["王五", "已付款1899.", "王五 · 已" + M],
    ["王五", "回款 5000 到账", "王五 · " + M + "到账"],
    // 币种写法
    ["王五", "1899RMB 年付", "王五 · " + M + "年付"],
    ["王五", "CNY 1899", "王五 · " + M],
    ["王五", "USD20 订阅", "王五 · " + M + "订阅"],
    ["王五", "€20 订阅", "王五 · " + M + "订阅"],
    ["王五", "HK$50 充值", "王五 · " + M + "充值"],
    // 普通数字不误伤
    ["王五", "Claude 3.5 升级", "王五 · Claude 3.5 升级"],
    ["王五", "Grok 4 试用，第3次跟进", "王五 · Grok 4 试用，第3次跟进"],
    ["王五", "确认报价，收到反馈", "王五 · 确认报价，收到反馈"],
    ["王五", "10月续费 一次回访", "王五 · 10月续费 一次回访"],
    ["王五 ¥88", "回访", "王五" + M + " · 回访"],
    ["", "费用：99元", M],
  ];
  it.each(cases)("%s / %s", (name, title, expected) => {
    expect(taskSyncTitle(name, title)).toBe(expected);
  });
  it("脚本复用同一实现，用同一组用例逐条比对", () => {
    const input = cases.map(([customer, title], i) => ({ id: "t" + i, customer, title }));
    const out = execFileSync("node", ["scripts/task-sync-title.mjs"], { input: JSON.stringify(input), encoding: "utf8" })
      .trim().split("\n").map((l) => JSON.parse(l).title);
    expect(out).toEqual(cases.map(([n, t]) => taskSyncTitle(n, t)));
  });
  it("没有金额数字残留", () => {
    for (const t of ["费用1899", "¥88", "共计 12元", "定金3k", "1.5万", "$5", "预算 2000", "999元/年", "2千5", "约2万", "一千八百元", "¥１８９９", "1899RMB", "CNY 1899", "USD20", "€20", "499/月", "收了1899", "转账2000", "八折后1200"])
      expect(stripMoney(t)).toBe(M);
  });

});
