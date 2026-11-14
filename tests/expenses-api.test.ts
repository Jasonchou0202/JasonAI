import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../server/memory-store";
import { handle } from "../server/handler";
import type { Context } from "../server/service";
import { teamConfigFromEnv, type TeamConfig } from "../server/team";
import type { Sale } from "../src/domain/model";

const OWNER = "uid-owner";
const ZHOU = "uid-zhou";
const STRANGER = "uid-stranger";
const NOW = "2026-11-14T10:00:00.000Z";
const hash = async (s: string) => createHash("sha256").update(s).digest("hex");
const ON: TeamConfig = { membersEnabled: true, auditEnabled: true, expensesEnabled: true };
const OFF: TeamConfig = { membersEnabled: true, auditEnabled: true };
const ctx = (uid: string | null): Context => ({ uid, ownerUid: OWNER, now: () => NOW, hash });
function caller(store: MemoryStore, team: TeamConfig) {
  return (uid: string | null, action: string, payload: unknown = {}) =>
    handle(() => store, ctx(uid), { action, payload }, undefined, undefined, team) as Promise<any>;
}
function member(s: MemoryStore, uid: string, name: string) {
  s.data.members[uid] = {
    uid, name, status: "active", inviteId: "inv", createdAt: NOW, updatedAt: NOW, revision: 1,
  };
}
function sale(s: MemoryStore, id: string, date: string, revenue: number, cost: number, who: string) {
  const row: Sale = {
    id, productId: "p", productName: "示例商品", customer: "示例客户", date,
    revenue, cost, note: "示例", createdAt: NOW, updatedAt: NOW, deletedAt: null, revision: 1, createdBy: who,
  };
  s.data.sales[id] = row;
}
async function seed() {
  const s = new MemoryStore();
  member(s, ZHOU, "周诗懿");
  s.data.expenses["_settings"] = {
    partnerUid: ZHOU, partnerName: "周诗懿",
    categories: [
      { id: "cat-phone", name: "话费", preset: true, createdAt: NOW },
      { id: "cat-transport", name: "交通", preset: true, createdAt: NOW },
    ],
  };
  sale(s, "s1", "2026-11-03", 1_200_000, 400_000, OWNER);
  return s;
}

describe("开关默认关", () => {
  it("环境变量只有 =1 才开；其它写法都关", () => {
    expect(teamConfigFromEnv({})).toEqual({ membersEnabled: false, auditEnabled: false });
    expect(teamConfigFromEnv({ EXPENSES_ENABLED: "true", SALES_PAYER_ENABLED: "yes" })).toEqual({
      membersEnabled: false,
      auditEnabled: false,
    });
    expect(teamConfigFromEnv({ EXPENSES_ENABLED: "1", SALES_PAYER_ENABLED: "1" })).toMatchObject({
      expensesEnabled: true,
      salesPayerEnabled: true,
    });
  });
  it("开关关：写入被拒，members.me 不出现报销字段（与现在一致）", async () => {
    const s = await seed();
    const call = caller(s, OFF);
    const me = await call(OWNER, "members.me");
    expect(me).toMatchObject({ ok: true });
    expect(me.data.expensesEnabled).toBeUndefined();
    expect(me.data.salesPayerEnabled).toBeUndefined();
    expect(await call(OWNER, "expenses.create", {
      requestId: "e1",
      expense: { date: "2026-11-14", amount: 10000, categoryId: "cat-phone", categoryName: "话费", paidBy: OWNER, hasInvoice: false, note: "", status: "pending_reimburse" },
    })).toMatchObject({ ok: false, code: "UNSUPPORTED_ACTION" });
    expect(Object.keys(s.data.expenses).filter((k) => !k.startsWith("_"))).toEqual([]);
  });
  it("团队开关也关时走原路径，members.me 仍是 UNSUPPORTED_ACTION", async () => {
    const s = new MemoryStore();
    const call = caller(s, { membersEnabled: false, auditEnabled: false, expensesEnabled: false });
    expect(await call(OWNER, "members.me")).toMatchObject({ ok: false, code: "UNSUPPORTED_ACTION" });
    expect(await call(OWNER, "expenses.meta")).toMatchObject({ ok: false, code: "UNSUPPORTED_ACTION" });
  });
});

describe("报销记账（开关开）", () => {
  it("管理员自己记的直接入账；成员提交待确认，确认后才进合账，驳回不进", async () => {
    const s = await seed();
    const call = caller(s, ON);
    const me = await call(OWNER, "members.me");
    expect(me.data.expensesEnabled).toBe(true);

    const adminRow = await call(OWNER, "expenses.create", {
      requestId: "e-admin",
      expense: { date: "2026-11-14", amount: 60_000, categoryId: "cat-phone", categoryName: "话费", paidBy: OWNER, hasInvoice: false, note: "软件", status: "pending_reimburse" },
    });
    expect(adminRow).toMatchObject({ ok: true });
    expect(adminRow.data.status).toBe("pending_reimburse");

    const memberRow = await call(ZHOU, "expenses.create", {
      requestId: "e-zhou",
      expense: { date: "2026-11-15", amount: 20_000, categoryId: "cat-phone", categoryName: "话费", paidBy: ZHOU, hasInvoice: true, note: "话费", status: "reimbursed" },
    });
    expect(memberRow.data.status).toBe("pending_confirm");

    const before = await call(OWNER, "expenses.settlement", { month: "2026-11" });
    expect(before.data.pendingCount).toBe(1);
    expect(before.data.decades[0].expense).toBe(0);
    expect(before.data.decades[1].expense).toBe(60_000);

    expect(await call(ZHOU, "expenses.confirm", { id: "e-zhou", requestId: "c1", revision: 1 })).toMatchObject({
      ok: false, code: "ADMIN_ONLY",
    });
    const ok = await call(OWNER, "expenses.confirm", { id: "e-zhou", requestId: "c1", revision: 1 });
    expect(ok.data.status).toBe("pending_reimburse");
    const after = await call(OWNER, "expenses.settlement", { month: "2026-11" });
    expect(after.data.pendingCount).toBe(0);
    expect(after.data.decades[1].expense).toBe(80_000);

    const pending = await call(ZHOU, "expenses.create", {
      requestId: "e-rej",
      expense: { date: "2026-11-14", amount: 12_000, categoryId: "cat-transport", categoryName: "交通", paidBy: ZHOU, hasInvoice: false, note: "打车", status: "pending_confirm" },
    });
    await call(OWNER, "expenses.reject", { id: "e-rej", requestId: "r1", revision: pending.data.revision });
    const settled = await call(OWNER, "expenses.settlement", { month: "2026-11" });
    expect(settled.data.decades[1].expense).toBe(80_000);
    expect(settled.data.details.find((d: { id: string }) => d.id === "e-rej").status).toBe("rejected");
  });

  it("成员只能看自己的报销；不能改已入账；可添加分类，不能删除分类", async () => {
    const s = await seed();
    const call = caller(s, ON);
    await call(OWNER, "expenses.create", {
      requestId: "e-admin",
      expense: { date: "2026-11-14", amount: 60_000, categoryId: "cat-phone", categoryName: "话费", paidBy: OWNER, hasInvoice: false, note: "", status: "pending_reimburse" },
    });
    await call(ZHOU, "expenses.create", {
      requestId: "e-zhou",
      expense: { date: "2026-11-15", amount: 20_000, categoryId: "cat-phone", categoryName: "话费", paidBy: ZHOU, hasInvoice: true, note: "", status: "pending_confirm" },
    });
    const list = await call(ZHOU, "expenses.list");
    expect(list.data.items.map((r: { id: string }) => r.id)).toEqual(["e-zhou"]);
    expect(await call(ZHOU, "expenses.get", { id: "e-admin" })).toMatchObject({ ok: false, code: "NOT_OWNER_OF_RECORD" });

    await call(OWNER, "expenses.confirm", { id: "e-zhou", requestId: "c1", revision: 1 });
    expect(await call(ZHOU, "expenses.update", {
      id: "e-zhou", requestId: "u1", revision: 2,
      expense: { date: "2026-11-15", amount: 1, categoryId: "cat-phone", categoryName: "话费", paidBy: ZHOU, hasInvoice: true, note: "", status: "reimbursed" },
    })).toMatchObject({ ok: false, code: "ADMIN_ONLY" });

    const cat = await call(ZHOU, "expenses.categories.create", { name: "招待", requestId: "cat-treat" });
    expect(cat).toMatchObject({ ok: true });
    expect(cat.data.name).toBe("招待");
    expect(await call(ZHOU, "expenses.categories.archive", { id: "cat-treat" })).toMatchObject({ ok: false, code: "ADMIN_ONLY" });
    expect(await call(OWNER, "expenses.categories.archive", { id: "cat-treat" })).toMatchObject({ ok: true });
    const meta = await call(OWNER, "expenses.meta");
    expect(meta.data.categories.map((c: { name: string }) => c.name)).not.toContain("招待");
  });

  it("外人不能写入；开关开时未登录被拒", async () => {
    const s = await seed();
    const call = caller(s, ON);
    expect(await call(STRANGER, "expenses.create", { requestId: "x", expense: {} })).toMatchObject({ ok: false, code: "NOT_MEMBER" });
    expect(await call(null, "expenses.meta")).toMatchObject({ ok: false, code: "NOT_SIGNED_IN" });
  });
});

describe("报销起算日写入", () => {
  it("云函数拒绝早于 11 月 14 日的报销写入，并返回中文说明", async () => {
    const s = await seed();
    const call = caller(s, ON);
    const created = await call(OWNER, "expenses.create", {
      requestId: "e-early",
      expense: { date: "2026-11-13", amount: 10_000, categoryId: "cat-phone", categoryName: "话费", paidBy: OWNER, hasInvoice: false, note: "", status: "pending_reimburse" },
    });
    expect(created.ok).toBe(false);
    expect(created.error).toMatch(/2026 年 11 月 14 日/);
    expect(Object.keys(s.data.expenses).filter((k) => !k.startsWith("_"))).toEqual([]);

    const ok = await call(OWNER, "expenses.create", {
      requestId: "e-ok",
      expense: { date: "2026-11-14", amount: 10_000, categoryId: "cat-phone", categoryName: "话费", paidBy: OWNER, hasInvoice: false, note: "", status: "pending_reimburse" },
    });
    expect(ok.ok).toBe(true);
    const updated = await call(OWNER, "expenses.update", {
      id: "e-ok",
      requestId: "e-ok-u",
      revision: ok.data.revision,
      expense: { date: "2026-11-13", amount: 10_000, categoryId: "cat-phone", categoryName: "话费", paidBy: OWNER, hasInvoice: false, note: "", status: "pending_reimburse" },
    });
    expect(updated.ok).toBe(false);
    expect(updated.error).toMatch(/2026 年 11 月 14 日/);
    expect((s.data.expenses["e-ok"] as { date: string }).date).toBe("2026-11-14");
  });
});

describe("进货付款人开关", () => {
  it("关着时新建销售不写 paidBy；开了才写，缺省为录入人", async () => {
    const s = await seed();
    const off = caller(s, { ...ON, salesPayerEnabled: false });
    const created = await off(ZHOU, "sales.create", {
      requestId: "sale-off",
      sale: { productId: "p", productName: "示例商品", customer: "示例客户", date: "2026-11-14", revenue: 10000, cost: 3000, note: "", paidBy: OWNER },
    });
    expect(created.ok).toBe(true);
    expect(created.data.createdBy).toBe(ZHOU);
    expect(created.data.paidBy).toBeUndefined();

    const on = caller(s, { ...ON, salesPayerEnabled: true });
    const withPayer = await on(ZHOU, "sales.create", {
      requestId: "sale-on",
      sale: { productId: "p", productName: "示例商品", customer: "示例客户", date: "2026-11-14", revenue: 10000, cost: 3000, note: "", paidBy: OWNER },
    });
    expect(withPayer.data.paidBy).toBe(OWNER);
    const def = await on(ZHOU, "sales.create", {
      requestId: "sale-def",
      sale: { productId: "p", productName: "示例商品", customer: "示例客户", date: "2026-11-14", revenue: 10000, cost: 3000, note: "" },
    });
    expect(def.data.paidBy).toBe(ZHOU);
  });
});
