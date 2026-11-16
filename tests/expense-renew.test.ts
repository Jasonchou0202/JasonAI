import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../server/memory-store";
import { handle } from "../server/handler";
import type { Context } from "../server/service";
import { teamConfigFromEnv, type TeamConfig } from "../server/team";
import { syncList } from "../server/task-sync";
import type { CustomerTask } from "../src/domain/model";
import type { Expense } from "../src/domain/expenses";
import { RENEW_CUSTOMER_ID, renewName, renewRemindAt, renewRemindDate } from "../src/domain/renew";

describe("续费提醒日期：下个月同一天再往前一天；小月取月末再往前一天", () => {
  it.each([
    ["2026-11-10", "2026-12-09"],
    ["2027-01-31", "2027-02-27"],
    ["2028-01-31", "2028-02-28"],
    ["2026-03-31", "2026-04-29"],
    ["2026-12-15", "2027-01-14"],
    ["2026-03-01", "2026-03-31"],
    ["2026-02-01", "2026-02-28"],
    ["2028-02-01", "2028-02-29"],
    ["2026-01-01", "2026-01-31"],
    ["2026-04-01", "2026-04-30"],
    ["2026-01-30", "2026-02-27"],
    ["2026-01-28", "2026-02-27"],
    ["2026-05-31", "2026-06-29"],
    ["2026-12-31", "2027-01-30"],
  ])("%s → %s", (from, to) => {
    expect(renewRemindDate(from)).toBe(to);
  });
  it("提醒在北京时间上午 10:00", () => {
    expect(renewRemindAt("2026-11-10")).toBe("2026-12-09T02:00:00.000Z");
  });
  it("续费名：缺省取分类名，去空格并截断", () => {
    expect(renewName("  ToDesk  ", "软件订阅")).toBe("ToDesk");
    expect(renewName("", "软件订阅")).toBe("软件订阅");
    expect(renewName("x".repeat(80), "a")).toHaveLength(40);
  });
});

const OWNER = "uid-owner";
const ZHOU = "uid-zhou";
const NOW = "2026-11-16T08:00:00.000Z";
const hash = async (s: string) => createHash("sha256").update(s).digest("hex");
const ctx = (uid: string | null): Context => ({ uid, ownerUid: OWNER, now: () => NOW, hash });
const BASE: TeamConfig = { membersEnabled: true, auditEnabled: true, expensesEnabled: true, scheduleOwnerEnabled: true };
const ON: TeamConfig = { ...BASE, expenseRenewEnabled: true };

function expense(id: string, date: string, who: string, extra: Partial<Expense> = {}): Expense {
  return {
    id, date, amount: 1000, categoryId: "cat-x", categoryName: "示例订阅", paidBy: who, hasInvoice: false,
    note: "", status: "pending_reimburse", createdAt: NOW, updatedAt: NOW, deletedAt: null, revision: 3, createdBy: who,
    ...extra,
  };
}
function seed() {
  const s = new MemoryStore();
  s.data.members[ZHOU] = { uid: ZHOU, name: "周诗懿", status: "active", inviteId: "inv", createdAt: NOW, updatedAt: NOW, revision: 1 };
  s.data.expenses["_settings"] = { partnerUid: ZHOU, partnerName: "周诗懿", categories: [{ id: "cat-x", name: "示例订阅", createdAt: NOW }] };
  s.data.expenses["e1"] = expense("e1", "2026-11-20", OWNER);
  s.data.expenses["e2"] = expense("e2", "2026-11-14", ZHOU);
  s.data.expenses["e3"] = expense("e3", "2026-11-15", ZHOU, { status: "rejected" });
  s.data.batches["_ledger"] = { hasSales: true };
  return s;
}
const call = (s: MemoryStore, team: TeamConfig) => (uid: string | null, action: string, payload: unknown = {}) =>
  handle(() => s, ctx(uid), { action, payload }, undefined, undefined, team) as Promise<any>;
const tasks = (s: MemoryStore) => Object.values(s.data.tasks) as CustomerTask[];

describe("报销续费提醒接口", () => {
  it("开关默认关：环境变量只认 =1；关着时接口不认、不写任何东西，合账不带 renewEnabled", async () => {
    expect(teamConfigFromEnv({ EXPENSES_ENABLED: "1" }).expenseRenewEnabled).toBeUndefined();
    expect(teamConfigFromEnv({ EXPENSES_ENABLED: "1", EXPENSE_RENEW_ENABLED: "1" }).expenseRenewEnabled).toBe(true);
    const s = seed();
    const c = call(s, BASE);
    expect(await c(OWNER, "expenses.renew", { id: "e1" })).toMatchObject({ ok: false, code: "UNSUPPORTED_ACTION" });
    expect(await c(ZHOU, "expenses.renew", { id: "e2" })).toMatchObject({ ok: false });
    expect(tasks(s)).toEqual([]);
    expect(s.data.customers[RENEW_CUSTOMER_ID]).toBeUndefined();
    expect((s.data.expenses["e1"] as Expense).renew).toBeUndefined();
    const st = await c(OWNER, "expenses.settlement", { month: "2026-11" });
    expect(st.ok).toBe(true);
    expect(st.data.renewEnabled).toBeUndefined();
  });

  it("管理员点：建 12/19 10:00「ToDesk续费」，归管理员；记录上记下 renew，不动 revision；重复点不再建", async () => {
    const s = seed();
    const c = call(s, ON);
    expect((await c(OWNER, "expenses.settlement", { month: "2026-11" })).data.renewEnabled).toBe(true);
    const r = await c(OWNER, "expenses.renew", { id: "e1", name: "ToDesk" });
    expect(r).toMatchObject({ ok: true, data: { created: true, renew: { date: "2026-12-19", title: "ToDesk续费", by: OWNER } } });
    expect(tasks(s)).toHaveLength(1);
    const t = tasks(s)[0];
    expect(t).toMatchObject({ customerId: RENEW_CUSTOMER_ID, at: "2026-12-19T02:00:00.000Z", title: "ToDesk续费", createdBy: OWNER, ownerUid: OWNER, reminder: "both" });
    const row = s.data.expenses["e1"] as Expense;
    expect(row.renew?.taskId).toBe(t.id);
    expect(row.revision).toBe(3);
    const again = await c(OWNER, "expenses.renew", { id: "e1", name: "别的名字" });
    expect(again).toMatchObject({ ok: true, data: { created: false, renew: { title: "ToDesk续费" } } });
    expect(tasks(s)).toHaveLength(1);
    // 之后照常能改这条报销，renew 保留
    const upd = await c(OWNER, "expenses.update", { id: "e1", requestId: "u1", revision: 3, expense: { note: "改备注" } });
    expect(upd).toMatchObject({ ok: true });
    expect((s.data.expenses["e1"] as Expense).renew?.taskId).toBe(t.id);
  });

  it("并发点两次也只有一条日程", async () => {
    const s = seed();
    const c = call(s, ON);
    const [a, b] = await Promise.all([c(OWNER, "expenses.renew", { id: "e1" }), c(OWNER, "expenses.renew", { id: "e1" })]);
    expect(a.ok && b.ok).toBe(true);
    expect(tasks(s)).toHaveLength(1);
  });

  it("半路失败（日程建了、记录没写上）后重试：不重复建，补写记录", async () => {
    const s = seed();
    const c = call(s, ON);
    await c(OWNER, "expenses.renew", { id: "e1" });
    delete (s.data.expenses["e1"] as Expense).renew;
    const r = await c(OWNER, "expenses.renew", { id: "e1" });
    expect(r).toMatchObject({ ok: true, data: { created: false } });
    expect(tasks(s)).toHaveLength(1);
    expect((s.data.expenses["e1"] as Expense).renew).toBeTruthy();
  });

  it("成员点自己的：日程归成员，不进 Jason 的 iPhone 同步清单；Jason 自己的进", async () => {
    const s = seed();
    const c = call(s, ON);
    expect((await c(ZHOU, "expenses.renew", { id: "e2" })).ok).toBe(true);
    expect((await c(OWNER, "expenses.renew", { id: "e1" })).ok).toBe(true);
    const zt = tasks(s).find((t) => t.createdBy === ZHOU)!;
    expect(zt).toMatchObject({ ownerUid: ZHOU, at: "2026-12-13T02:00:00.000Z" });
    const list = await syncList(s, NOW, OWNER);
    const ids = list.tasks.map((t) => t.id);
    expect(ids).toContain(tasks(s).find((t) => t.createdBy === OWNER)!.id);
    expect(ids).not.toContain(zt.id);
  });

  it("成员不能给别人的记录设；驳回的、删除的、不存在的不能设", async () => {
    const s = seed();
    const c = call(s, ON);
    expect(await c(ZHOU, "expenses.renew", { id: "e1" })).toMatchObject({ ok: false, code: "NOT_OWNER_OF_RECORD" });
    expect(await c(ZHOU, "expenses.renew", { id: "e3" })).toMatchObject({ ok: false });
    expect(await c(OWNER, "expenses.renew", { id: "nope" })).toMatchObject({ ok: false });
    (s.data.expenses["e1"] as Expense).deletedAt = NOW;
    expect(await c(OWNER, "expenses.renew", { id: "e1" })).toMatchObject({ ok: false });
    expect(tasks(s)).toEqual([]);
  });
});
