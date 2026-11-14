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

describe("报销凭证（EXPENSE_RECEIPTS_ENABLED）", () => {
  const PDF = Buffer.from("%PDF-1.4\n示例\n%%EOF").toString("base64");
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64");
  const base = { date: "2026-11-14", amount: 10_000, categoryId: "cat-phone", categoryName: "话费", note: "", status: "pending_reimburse" };
  async function rig(allowTicket = false) {
    const { MemoryReceiptStorage } = await import("../server/receipts");
    const storage = new MemoryReceiptStorage(allowTicket);
    const s = await seed();
    const team: TeamConfig = { ...ON, expenseReceiptsEnabled: true, receiptStorage: storage };
    return { s, storage, call: caller(s, team) };
  }

  it("环境变量 EXPENSE_RECEIPTS_ENABLED=1 才开；关着时凭证接口 UNSUPPORTED，meta 不带 receiptsEnabled，也不接受新凭证", async () => {
    expect(teamConfigFromEnv({ EXPENSE_RECEIPTS_ENABLED: "1" })).toMatchObject({ expenseReceiptsEnabled: true });
    expect(teamConfigFromEnv({ EXPENSE_RECEIPTS_ENABLED: "true" }).expenseReceiptsEnabled).toBeUndefined();
    const { MemoryReceiptStorage } = await import("../server/receipts");
    const s = await seed();
    const call = caller(s, { ...ON, receiptStorage: new MemoryReceiptStorage() });
    expect(await call(OWNER, "expenses.receipts.upload", { data: PDF })).toMatchObject({ ok: false, code: "UNSUPPORTED_ACTION" });
    const meta = await call(OWNER, "expenses.meta");
    expect(meta.data.receiptsEnabled).toBeUndefined();
    expect(await call(OWNER, "expenses.create", {
      requestId: "x1",
      expense: { ...base, paidBy: OWNER, hasInvoice: false, receipts: [{ fileID: `cloud://demo/expenses/${OWNER}/a.pdf`, name: "a.pdf", type: "application/pdf", size: 10, kind: "invoice" }] },
    })).toMatchObject({ ok: false, error: "凭证上传尚未开放" });
    // 关着时旧写法（只有 hasInvoice）照常
    expect(await call(OWNER, "expenses.create", { requestId: "x2", expense: { ...base, paidBy: OWNER, hasInvoice: true } })).toMatchObject({ ok: true });
  });

  it("中转上传查文件头；存 expenses/<自己 uid>/；保存后 hasInvoice 由凭证推导；临时链接只给本人和管理员", async () => {
    const { s, storage, call } = await rig();
    expect((await call(OWNER, "expenses.meta")).data.receiptsEnabled).toBe(true);
    expect(await call(ZHOU, "expenses.receipts.upload", { data: Buffer.from("GIF89a....").toString("base64") })).toMatchObject({ ok: false, error: expect.stringMatching(/PDF/) });
    const pdf = await call(ZHOU, "expenses.receipts.upload", { name: "发票.pdf", data: PDF });
    expect(pdf).toMatchObject({ ok: true, data: { type: "application/pdf" } });
    expect(pdf.data.fileID).toMatch(new RegExp(`^cloud://demo/expenses/${ZHOU}/20261114-\\w+\\.pdf$`));
    const png = await call(ZHOU, "expenses.receipts.upload", { name: "截图.png", data: PNG });
    expect(png.data.type).toBe("image/png");
    const created = await call(ZHOU, "expenses.create", {
      requestId: "r1",
      expense: {
        ...base, paidBy: ZHOU, hasInvoice: false,
        receipts: [
          { fileID: pdf.data.fileID, name: "发票.pdf", type: "application/pdf", size: pdf.data.size, kind: "invoice" },
          { fileID: png.data.fileID, name: "截图.png", type: "image/png", size: png.data.size, kind: "payment" },
        ],
      },
    });
    expect(created).toMatchObject({ ok: true, data: { hasInvoice: true, status: "pending_confirm" } });
    expect(created.data.receipts).toHaveLength(2);
    const urls = await call(ZHOU, "expenses.receipts.urls", { id: "r1" });
    expect(urls.data.items.map((x: any) => x.kind)).toEqual(["invoice", "payment"]);
    expect(urls.data.items[0].url).toMatch(/^data:application\/pdf;base64,/);
    expect(urls.data.items[0].fileID).toBeUndefined();
    expect((await call(OWNER, "expenses.receipts.urls", { id: "r1" })).ok).toBe(true);
    // 审计只记凭证个数
    const log = Object.values(s.data.audit_logs || {}).find((l: any) => l.action === "expenses.create" && l.targetId === "r1") as any;
    expect(log.after.receiptCount).toBe(2);
    expect(JSON.stringify(log)).not.toContain("发票.pdf");
    expect(storage.files.size).toBe(2);
  });

  it("不能附上别人上传的文件；成员不能看别人的凭证；放弃只删自己没挂上的", async () => {
    const { storage, call } = await rig();
    const mine = await call(OWNER, "expenses.receipts.upload", { data: PDF });
    expect(await call(ZHOU, "expenses.create", {
      requestId: "r2",
      expense: { ...base, paidBy: ZHOU, hasInvoice: false, receipts: [{ fileID: mine.data.fileID, name: "a.pdf", type: "application/pdf", size: 10, kind: "invoice" }] },
    })).toMatchObject({ ok: false, error: "只能附上自己上传的凭证" });
    await call(OWNER, "expenses.create", {
      requestId: "r3",
      expense: { ...base, paidBy: OWNER, hasInvoice: false, receipts: [{ fileID: mine.data.fileID, name: "a.pdf", type: "application/pdf", size: 10, kind: "invoice" }] },
    });
    expect(await call(ZHOU, "expenses.receipts.urls", { id: "r3" })).toMatchObject({ ok: false, code: "NOT_OWNER_OF_RECORD" });
    // 已挂在记录上的不删；别人的不删
    expect((await call(ZHOU, "expenses.receipts.discard", { fileIDs: [mine.data.fileID] })).data.removed).toBe(0);
    expect((await call(OWNER, "expenses.receipts.discard", { fileIDs: [mine.data.fileID] })).data.removed).toBe(0);
    const loose = await call(ZHOU, "expenses.receipts.upload", { data: PNG });
    expect((await call(ZHOU, "expenses.receipts.discard", { fileIDs: [loose.data.fileID] })).data.removed).toBe(1);
    expect(storage.files.has(loose.data.fileID)).toBe(false);
    expect(storage.files.has(mine.data.fileID)).toBe(true);
  });

  it("改记录拿掉的凭证、彻底删除的记录：提交后删文件；软删除保留文件", async () => {
    const { storage, call } = await rig();
    const a = await call(OWNER, "expenses.receipts.upload", { data: PDF });
    const b = await call(OWNER, "expenses.receipts.upload", { data: PNG });
    const ra = { fileID: a.data.fileID, name: "a.pdf", type: "application/pdf", size: a.data.size, kind: "invoice" };
    const rb = { fileID: b.data.fileID, name: "b.png", type: "image/png", size: b.data.size, kind: "payment" };
    const row = await call(OWNER, "expenses.create", { requestId: "r4", expense: { ...base, paidBy: OWNER, hasInvoice: false, receipts: [ra, rb] } });
    const upd = await call(OWNER, "expenses.update", { id: "r4", requestId: "u1", revision: row.data.revision, expense: { receipts: [rb] } });
    expect(upd).toMatchObject({ ok: true, data: { hasInvoice: false } });
    expect(storage.removed).toEqual([a.data.fileID]);
    const del = await call(OWNER, "expenses.delete", { id: "r4", requestId: "d1", revision: upd.data.revision });
    expect(storage.files.has(b.data.fileID)).toBe(true);
    await call(OWNER, "expenses.purge", { id: "r4", revision: del.data.revision });
    expect(storage.removed).toEqual([a.data.fileID, b.data.fileID]);
  });

  it("直传：给只对 expenses/<自己 uid>/ 有效的签名，类型和大小先在云端挡一遍", async () => {
    const { storage, call } = await rig(true);
    const r = await call(ZHOU, "expenses.receipts.prepare", { files: [{ name: "IMG_1.HEIC", type: "", size: 3_000_000 }, { name: "a.pdf", type: "application/pdf", size: 9_000_000 }] });
    expect(r.ok).toBe(true);
    expect(r.data.items.map((x: any) => x.type)).toEqual(["image/heic", "application/pdf"]);
    expect(storage.tickets.every((p) => p.startsWith(`expenses/${ZHOU}/`))).toBe(true);
    expect(r.data.items[0].ticket.fileID).toMatch(/\.heic$/);
    expect(await call(ZHOU, "expenses.receipts.prepare", { files: [{ name: "a.pdf", type: "application/pdf", size: 10 * 1024 * 1024 + 1 }] })).toMatchObject({ ok: false, error: "凭证单个不能超过 10MB" });
    expect(await call(ZHOU, "expenses.receipts.prepare", { files: [{ name: "a.zip", type: "application/zip", size: 10 }] })).toMatchObject({ ok: false, error: expect.stringMatching(/PDF/) });
    expect(await call(STRANGER, "expenses.receipts.prepare", { files: [{ name: "a.pdf", type: "application/pdf", size: 10 }] })).toMatchObject({ ok: false });
  });

  it("软件订阅：meta 不再给出、新记录不能选；旧记录分类照常，改别的字段也不报错", async () => {
    const { s, call } = await rig();
    (s.data.expenses["_settings"] as any).categories.push(
      { id: "cat-software", name: "软件订阅", preset: true, createdAt: NOW },
      { id: "u-1", name: "自定义一", createdAt: NOW },
    );
    s.data.expenses["old-1"] = {
      id: "old-1", date: "2026-11-14", amount: 50_000, categoryId: "cat-software", categoryName: "软件订阅", paidBy: OWNER,
      hasInvoice: false, note: "", status: "pending_reimburse", createdAt: NOW, updatedAt: NOW, deletedAt: null, revision: 1,
    };
    const meta = await call(OWNER, "expenses.meta");
    const names = meta.data.categories.map((c: any) => c.name);
    expect(names).not.toContain("软件订阅");
    expect(names).toContain("自定义一");
    expect(await call(OWNER, "expenses.create", { requestId: "n1", expense: { ...base, categoryId: "cat-software", categoryName: "软件订阅", paidBy: OWNER, hasInvoice: false } })).toMatchObject({ ok: false, error: "请选择分类" });
    expect(await call(OWNER, "expenses.create", { requestId: "n2", expense: { ...base, categoryId: "u-1", categoryName: "自定义一", paidBy: OWNER, hasInvoice: false } })).toMatchObject({ ok: true });
    const upd = await call(OWNER, "expenses.update", { id: "old-1", requestId: "u2", revision: 1, expense: { note: "补备注" } });
    expect(upd).toMatchObject({ ok: true, data: { categoryName: "软件订阅", note: "补备注" } });
    const list = await call(OWNER, "expenses.settlement", { month: "2026-11" });
    expect(list.data.details.find((d: any) => d.id === "old-1").categoryName).toBe("软件订阅");
    // 云端设置原样保留，没有被改写
    expect((s.data.expenses["_settings"] as any).categories.some((c: any) => c.id === "cat-software" && !c.archivedAt)).toBe(true);
  });
});
