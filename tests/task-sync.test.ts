import { describe, expect, it } from "vitest";
import { MemoryStore } from "../server/memory-store";
import { execute } from "../server/service";
import { handle } from "../server/handler";
import { handleSync, parseSyncEvent, SYNC_LOG } from "../server/task-sync";
import { stripMoney, taskSyncTitle } from "../src/domain/taskSyncTitle";
import * as script from "../scripts/task-sync-title.mjs";
import type { Customer, CustomerTask } from "../src/domain/model";

const NOW = "2026-10-24T04:00:00.000Z";
const KEY = "test-sync-key-0123456789";
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
    pastEdge: task("pastEdge", "2026-10-17T05:00:00.000Z"),
    tooOld: task("tooOld", "2026-10-16T00:00:00.000Z"),
    tooFar: task("tooFar", "2027-01-25T00:00:00.000Z"),
    gone: task("gone", "2026-10-25T00:00:00.000Z", { deletedAt: NOW }),
  };
  return s;
}
let n = 0;
const env = (key: string | undefined) => ({ key, now: () => NOW, newId: () => "id" + ++n });
const run = (s: MemoryStore, action: string, payload: any = {}, key: unknown = KEY, envKey: string | undefined | null = KEY) =>
  handleSync(() => s, env(envKey ?? undefined), { action, payload, key }) as Promise<any>;

describe("tasks.sync.list", () => {
  it("只返回未删除、过去7天到未来90天的日程，客户名取合并后的根客户", async () => {
    const r = await run(seed(), "tasks.sync.list");
    expect(r.ok).toBe(true);
    expect(r.data.tasks.map((t: any) => t.id)).toEqual(["pastEdge", "inside"]);
    expect(r.data.tasks[0].customer).toBe("李德嘉");
  });
  it("返回字段固定，没有金额、等级或支付方式", async () => {
    const r = await run(seed(), "tasks.sync.list");
    for (const t of r.data.tasks)
      expect(Object.keys(t).sort()).toEqual(
        ["at", "completedAt", "customer", "feedback", "id", "nextAction", "reminder", "revision", "title"],
      );
    const text = JSON.stringify(r);
    for (const word of ["revenue", "cost", "profit", "tier", "payment", "189900", "100000"])
      expect(text).not.toContain(word);
  });
});

describe("鉴权", () => {
  it("密钥错误、缺失或未配置时两个接口都拒绝", async () => {
    for (const action of ["tasks.sync.list", "tasks.sync.complete"]) {
      const p = { id: "inside", revision: 3, completedAt: NOW };
      expect(await run(seed(), action, p, "wrong")).toMatchObject({ ok: false, code: "SYNC_UNAUTHORIZED" });
      expect(await run(seed(), action, p, null)).toMatchObject({ ok: false, code: "SYNC_UNAUTHORIZED" });
      expect(await run(seed(), action, p, KEY, null as any)).toMatchObject({ ok: false, code: "SYNC_DISABLED" });
      expect(await run(seed(), action, p, KEY, "")).toMatchObject({ ok: false, code: "SYNC_DISABLED" });
    }
  });
  it("同步密钥不能调用其他操作", async () => {
    for (const action of ["backup", "sales.list", "tasks.complete", "dashboard"])
      expect(await run(seed(), action)).toMatchObject({ ok: false, code: "SYNC_FORBIDDEN" });
    expect(parseSyncEvent({ action: "backup", syncKey: KEY })).not.toBeNull();
  });
  it("普通登录通道也调不到同步接口", async () => {
    const r = await handle(() => seed(), { uid: "o", ownerUid: "o", hash: async (x) => x }, { action: "tasks.sync.list" });
    expect(r.ok).toBe(false);
  });
  it("HTTP 访问事件：Bearer 头或 x-task-sync-key 头", async () => {
    const body = JSON.stringify({ action: "tasks.sync.list" });
    const a = parseSyncEvent({ httpMethod: "POST", headers: { Authorization: "Bearer " + KEY }, body });
    const b = parseSyncEvent({ httpMethod: "POST", headers: { "X-Task-Sync-Key": KEY }, body: Buffer.from(body).toString("base64"), isBase64Encoded: true });
    expect(a).toMatchObject({ action: "tasks.sync.list", key: KEY });
    expect(b).toMatchObject({ action: "tasks.sync.list", key: KEY });
    expect(() => parseSyncEvent({ httpMethod: "GET", headers: {} })).toThrow();
  });
});

describe("tasks.sync.complete", () => {
  it("只改 completedAt，并 revision+1、更新 updatedAt 和 lastMutation，写一条日志", async () => {
    const s = seed();
    const before = structuredClone(s.data.tasks.inside) as CustomerTask;
    const r = await run(s, "tasks.sync.complete", { id: "inside", revision: 3, completedAt: "2026-10-24T11:30:00+08:00", title: "改标题" });
    expect(r).toMatchObject({ ok: true, data: { id: "inside", revision: 4, completedAt: "2026-10-24T03:30:00.000Z" } });
    const after = s.data.tasks.inside as CustomerTask;
    const { completedAt, revision, updatedAt, lastMutation, ...rest } = after;
    const { completedAt: c0, revision: r0, updatedAt: u0, lastMutation: l0, ...rest0 } = before;
    expect(rest).toEqual(rest0);
    expect([revision, updatedAt]).toEqual([4, NOW]);
    expect(lastMutation).toMatch(/^sync_/);
    const logs = Object.values(s.data[SYNC_LOG]);
    expect(logs).toEqual([{ id: lastMutation, at: NOW, taskId: "inside", before: null, after: "2026-10-24T03:30:00.000Z", revision: 4 }]);
    // 其他集合未动
    expect(Object.keys(s.data.tasks).length).toBe(5);
    expect(s.data.sales).toEqual(seed().data.sales);
    // 取消完成
    const back = await run(s, "tasks.sync.complete", { id: "inside", revision: 4, completedAt: null });
    expect(back).toMatchObject({ ok: true, data: { completedAt: null, revision: 5 } });
    expect(Object.values(s.data[SYNC_LOG]).length).toBe(2);
  });
  it("revision 对不上返回冲突，不写库不写日志", async () => {
    const s = seed();
    expect(await run(s, "tasks.sync.complete", { id: "inside", revision: 2, completedAt: NOW })).toMatchObject({ ok: false, code: "SYNC_CONFLICT" });
    expect((s.data.tasks.inside as CustomerTask).revision).toBe(3);
    expect(Object.values(s.data[SYNC_LOG])).toEqual([]);
  });
  it("已删除或不存在的日程拒绝，不新建", async () => {
    const s = seed();
    expect(await run(s, "tasks.sync.complete", { id: "gone", revision: 3, completedAt: NOW })).toMatchObject({ ok: false, code: "SYNC_DELETED" });
    expect(await run(s, "tasks.sync.complete", { id: "nope", revision: 1, completedAt: NOW })).toMatchObject({ ok: false, code: "SYNC_NOT_FOUND" });
    expect(Object.keys(s.data.tasks).length).toBe(5);
    expect(Object.values(s.data[SYNC_LOG])).toEqual([]);
  });
  it("参数格式错误拒绝", async () => {
    const s = seed();
    for (const p of [{ id: "inside", revision: 3, completedAt: "昨天" }, { id: "inside", revision: 3 }, { id: "inside", completedAt: NOW }])
      expect(await run(s, "tasks.sync.complete", p)).toMatchObject({ ok: false, code: "SYNC_BAD_REQUEST" });
  });
  it("普通 execute 不认识同步接口", async () => {
    await expect(execute(seed(), { uid: "o", ownerUid: "o", hash: async (x) => x }, "tasks.sync.complete", {})).rejects.toThrow();
  });
});

describe("提醒事项标题", () => {
  const cases: [string, string, string][] = [
    ["✅李德嘉", "ChatGPT Pro 到期", "李德嘉 · ChatGPT Pro 到期"],
    ["王五", "续费，费用：1899元", "王五 · 续费"],
    ["王五", "报价 ¥1,299.00 待确认", "王五 · 报价 待确认"],
    ["王五", "尾款 500 元（费用 ¥300）", "王五 · 尾款"],
    ["", "费用：99元", "客户日程"],
  ];
  it.each(cases)("%s / %s", (name, title, expected) => {
    expect(taskSyncTitle(name, title)).toBe(expected);
    expect(script.taskSyncTitle(name, title)).toBe(expected);
  });
  it("没有金额片段残留", () => {
    for (const t of ["费用1899", "¥88", "共计 12元"]) expect(stripMoney(t)).not.toMatch(/[¥￥元]|费用|\d/);
  });
});
