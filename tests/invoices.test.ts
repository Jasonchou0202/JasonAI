import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../server/memory-store";
import { handle } from "../server/handler";
import type { Context } from "../server/service";
import { teamConfigFromEnv, type TeamConfig } from "../server/team";
import { syncList } from "../server/task-sync";
import { MemoryReceiptStorage } from "../server/receipts";
import { invoicePath, sniffInvoiceFile } from "../server/invoices";
import type { Customer, CustomerTask, Sale } from "../src/domain/model";
import {
  INVOICE_CUSTOMER_ID,
  invoiceRemindAt,
  invoiceStats,
  invoiceUploader,
  profileComplete,
  profileTitle,
  validateFields,
  type InvoiceRecord,
} from "../src/domain/invoices";

const OWNER = "uid-owner";
const ZHOU = "uid-zhou";
let clock = "2026-11-17T02:00:00.000Z";
const hash = async (s: string) => createHash("sha256").update(s).digest("hex");
const ctx = (uid: string | null): Context => ({ uid, ownerUid: OWNER, now: () => clock, hash });
const BASE: TeamConfig = { membersEnabled: true, auditEnabled: true, scheduleOwnerEnabled: true };

function sale(id: string, customer: string, revenue: number, who = OWNER, date = "2026-11-10"): Sale {
  return {
    id, productId: "p1", productName: "示例商品", customer, date, revenue, cost: 100, note: "",
    createdAt: clock, updatedAt: clock, deletedAt: null, revision: 1, createdBy: who,
  } as Sale;
}
function customer(id: string, name: string, mergedInto: string | null = null): Customer {
  return { id, name, mergedInto, revision: 1, createdAt: clock, updatedAt: clock };
}
function seed() {
  clock = "2026-11-17T02:00:00.000Z";
  const s = new MemoryStore();
  s.data.members[ZHOU] = { uid: ZHOU, name: "周诗懿", status: "active", inviteId: "inv", createdAt: clock, updatedAt: clock, revision: 1 };
  s.data.customers["c-a"] = customer("c-a", "示例公司甲");
  s.data.customers["c-a2"] = customer("c-a2", "示例公司甲✅", "c-a");
  s.data.customers["c-b"] = customer("c-b", "示例公司乙");
  s.data.sales["s1"] = sale("s1", "示例公司甲", 180000);
  s.data.sales["s2"] = sale("s2", "示例公司甲✅", 50000, ZHOU, "2026-11-12");
  s.data.sales["s3"] = sale("s3", "路人", 0);
  s.data.sales["s4"] = sale("s4", "示例公司乙", 30000);
  s.data.batches["_ledger"] = { hasSales: true };
  return s;
}
function storage() {
  return new MemoryReceiptStorage();
}
const ON = (extra: Partial<TeamConfig> = {}): TeamConfig => ({ ...BASE, invoiceEnabled: true, receiptStorage: storage(), ...extra });
const call = (s: MemoryStore, team: TeamConfig) => (uid: string | null, action: string, payload: unknown = {}) =>
  handle(() => s, ctx(uid), { action, payload }, undefined, undefined, team) as Promise<any>;
const tasks = (s: MemoryStore) => Object.values(s.data.tasks) as CustomerTask[];
const rec = (s: MemoryStore, saleId: string) => s.data.invoices["inv_" + saleId] as InvoiceRecord | undefined;
const b64 = (bytes: number[] | Uint8Array) => Buffer.from(bytes as Uint8Array).toString("base64");
const FULL = { title: "示例公司甲有限公司", taxNo: "91310000MA1FL0XX0X", email: "fapiao@example.com" };

describe("开票规则（纯函数）", () => {
  it("资料齐：抬头+税号，或贴了原文，或传了文件", () => {
    expect(profileComplete(null)).toBe(false);
    expect(profileComplete({ text: "", fields: { title: "甲" }, files: [] })).toBe(false);
    expect(profileComplete({ text: "", fields: { title: "甲", taxNo: "91310000MA1FL0XX0X" }, files: [] })).toBe(true);
    expect(profileComplete({ text: "名称：甲公司\n税号：…", fields: {}, files: [] })).toBe(true);
    expect(profileComplete({ text: "", fields: {}, files: [{ fileID: "x", name: "a.pdf", type: "application/pdf", size: 1 }] })).toBe(true);
  });
  it("抬头：字段优先，否则取原文第一行并去掉「名称：」", () => {
    expect(profileTitle({ text: "名称：示例公司\n税号：123", fields: {} })).toBe("示例公司");
    expect(profileTitle({ text: "x", fields: { title: "字段抬头" } })).toBe("字段抬头");
  });
  it("税号、邮箱校验；税号转大写去空格", () => {
    expect(validateFields({ taxNo: "91310000ma1fl0xx0x " }).taxNo).toBe("91310000MA1FL0XX0X");
    expect(() => validateFields({ taxNo: "123" })).toThrow(/税号/);
    expect(() => validateFields({ email: "nope" })).toThrow(/邮箱/);
  });
  it("提醒：进入待开票的北京日期 + 3 天上午 10:00", () => {
    expect(invoiceRemindAt("2026-11-17T02:00:00.000Z")).toBe("2026-11-20T02:00:00.000Z");
    // 北京时间 11-17 23:30 → 11-20；11-18 00:30 → 11-21
    expect(invoiceRemindAt("2026-11-17T15:30:00.000Z")).toBe("2026-11-20T02:00:00.000Z");
    expect(invoiceRemindAt("2026-11-17T16:30:00.000Z")).toBe("2026-11-21T02:00:00.000Z");
  });
  it("文件类型：按文件头；Word/txt 要扩展名与内容对得上", () => {
    expect(sniffInvoiceFile(new TextEncoder().encode("%PDF-1.4 x"), "a.pdf")).toBe("application/pdf");
    expect(sniffInvoiceFile(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]), "a.doc")).toBe("application/msword");
    expect(sniffInvoiceFile(new Uint8Array([0x50, 0x4b, 3, 4, 0]), "a.docx")).toContain("wordprocessingml");
    expect(sniffInvoiceFile(new TextEncoder().encode("名称：甲\n税号：1"), "a.txt")).toBe("text/plain");
    expect(sniffInvoiceFile(new Uint8Array([0x4d, 0x5a, 0, 1]), "a.txt")).toBeNull();
    expect(sniffInvoiceFile(new Uint8Array([0x50, 0x4b, 3, 4]), "a.exe")).toBeNull();
    expect(sniffInvoiceFile(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), "a.docx")).toBeNull();
  });
  it("存储路径 invoices/<上传人>/…，能认出上传人", () => {
    const p = invoicePath("uid-zhou", "text/plain", "abc", "2026-11-17");
    expect(p).toBe("invoices/uid-zhou/20261117-abc.txt");
    expect(invoiceUploader("cloud://env/" + p)).toBe("uid-zhou");
    expect(invoiceUploader("cloud://env/expenses/uid-zhou/x.pdf")).toBeNull();
  });
  it("统计：待开票按积压算，已开票按开票日期所在月；缺资料按客户去重", () => {
    const r = (id: string, status: InvoiceRecord["status"], saleDate: string, amount: number, customerId: string, issuedOn?: string) =>
      ({ id, status, saleDate, amount, customerId, customerName: customerId, issuedOn }) as InvoiceRecord;
    const st = invoiceStats(
      [
        r("1", "pending", "2026-11-02", 100, "a"),
        r("2", "awaiting_info", "2026-10-20", 200, "b"),
        r("3", "awaiting_info", "2026-11-05", 300, "b"),
        r("4", "issued", "2026-10-30", 400, "a", "2026-11-03"),
        r("5", "sent", "2026-11-01", 500, "a", "2026-11-04"),
        r("6", "issued", "2026-10-01", 600, "a", "2026-10-05"),
        r("7", "pending", "2026-12-01", 700, "a"),
      ],
      (id) => id === "a",
      "2026-11",
    );
    expect(st.pending).toEqual({ count: 3, amount: 600, awaiting: 2 });
    expect(st.issued).toEqual({ count: 2, amount: 900 });
    expect(st.missingCustomers).toBe(1);
  });
});

describe("开票接口", () => {
  it("开关默认关：环境变量只认 =1；关着时接口不认、不写任何东西，members.me 不带 invoiceEnabled", async () => {
    expect(teamConfigFromEnv({}).invoiceEnabled).toBeUndefined();
    expect(teamConfigFromEnv({ INVOICE_ENABLED: "true" }).invoiceEnabled).toBeUndefined();
    expect(teamConfigFromEnv({ INVOICE_ENABLED: "1" }).invoiceEnabled).toBe(true);
    const s = seed();
    const before = structuredClone(s.data);
    const c = call(s, BASE);
    for (const a of ["invoices.list", "invoices.toggle", "invoices.profile.save", "invoices.files.upload"])
      expect(await c(OWNER, a, { saleId: "s1", customerId: "c-a" })).toMatchObject({ ok: false, code: "UNSUPPORTED_ACTION" });
    expect(await c(ZHOU, "invoices.list")).toMatchObject({ ok: false });
    expect((await c(OWNER, "members.me")).data.invoiceEnabled).toBeUndefined();
    const { audit_logs: _a, ...rest } = s.data;
    const { audit_logs: _b, ...restBefore } = before;
    expect(rest).toEqual(restBefore);
  });

  it("单人版（团队开关全关）只开开票：也能用，其余接口走原路径", async () => {
    const s = seed();
    const c = call(s, { membersEnabled: false, auditEnabled: false, invoiceEnabled: true });
    expect((await c(OWNER, "invoices.toggle", { saleId: "s1" })).ok).toBe(true);
    expect((await c(OWNER, "members.me")).data.invoiceEnabled).toBe(true);
    expect(await c("someone", "invoices.list")).toMatchObject({ ok: false });
  });

  it("缺资料：打开开票 → 待收资料、不建日程；资料补齐后自动进入待开票并建 3 天后提醒（归打开的人）", async () => {
    const s = seed();
    const c = call(s, ON());
    const salesBefore = structuredClone(s.data.sales);
    const r = await c(OWNER, "invoices.toggle", { saleId: "s1" });
    expect(r).toMatchObject({ ok: true, data: { record: { status: "awaiting_info", amount: 180000, customerId: "c-a", title: "" } } });
    expect(tasks(s)).toEqual([]);
    // 别名下的销售也归到根客户
    expect((await c(ZHOU, "invoices.toggle", { saleId: "s2" })).data.record.customerId).toBe("c-a");
    clock = "2026-11-17T06:00:00.000Z";
    const saved = await c(OWNER, "invoices.profile.save", { customerId: "c-a", revision: 0, fields: FULL });
    expect(saved).toMatchObject({ ok: true, data: { complete: true, moved: 2, title: "示例公司甲有限公司" } });
    expect(rec(s, "s1")).toMatchObject({ status: "pending", title: "示例公司甲有限公司" });
    expect(tasks(s)).toHaveLength(2);
    const mine = tasks(s).find((t) => t.createdBy === OWNER)!;
    const zhou = tasks(s).find((t) => t.createdBy === ZHOU)!;
    expect(mine).toMatchObject({ customerId: "c-a", at: "2026-11-20T02:00:00.000Z", ownerUid: OWNER, reminder: "both" });
    expect(mine.title).toContain("示例公司甲");
    expect(zhou.ownerUid).toBe(ZHOU);
    // 只有归 Jason 的进 iPhone 同步
    const ids = (await syncList(s, clock, OWNER)).tasks.map((t) => t.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(zhou.id);
    // sales 一行不动
    expect(s.data.sales).toEqual(salesBefore);
  });

  it("资料齐的客户：打开即待开票；重复点、并发点只有一条记录一条日程；日程编号固定", async () => {
    const s = seed();
    const c = call(s, ON());
    await c(OWNER, "invoices.profile.save", { customerId: "c-b", revision: 0, text: "名称：示例公司乙\n税号：91310000MA1FL0XX0Y" });
    const [a, b] = await Promise.all([c(OWNER, "invoices.toggle", { saleId: "s4" }), c(OWNER, "invoices.toggle", { saleId: "s4" })]);
    expect(a.ok && b.ok).toBe(true);
    expect(a.data.record.status).toBe("pending");
    expect(a.data.record.title).toBe("示例公司乙");
    expect(tasks(s)).toHaveLength(1);
    expect(rec(s, "s4")!.remind!.taskId).toBe(tasks(s)[0].id);
    expect(tasks(s)[0].id).toMatch(/^invrem_[0-9a-f]{40}$/);
    // 半路失败（日程建了、记录没写上）后重试：不重复建
    delete s.data.invoices["inv_s4"];
    clock = "2026-11-17T02:00:00.000Z";
    await c(OWNER, "invoices.toggle", { saleId: "s4" });
    expect(tasks(s)).toHaveLength(1);
  });

  it("没对上客户的销售：提醒挂在固定客户「🧾开票提醒」；销售额为 0 要手填金额", async () => {
    const s = seed();
    const c = call(s, ON());
    expect(await c(OWNER, "invoices.toggle", { saleId: "s3" })).toMatchObject({ ok: false });
    const r = await c(OWNER, "invoices.toggle", { saleId: "s3", amount: 9900 });
    expect(r.data.record).toMatchObject({ status: "awaiting_info", customerId: "", amount: 9900 });
    const u = await c(OWNER, "invoices.update", { id: "inv_s3", revision: 1, status: "pending" });
    expect(u.ok).toBe(true);
    expect(tasks(s)[0].customerId).toBe(INVOICE_CUSTOMER_ID);
    expect(s.data.customers[INVOICE_CUSTOMER_ID]).toBeTruthy();
  });

  it("状态流转：已开票要发票号码和日期；离开待开票把提醒标完成；已寄出记日期；作废后不能再改", async () => {
    const s = seed();
    const c = call(s, ON());
    await c(OWNER, "invoices.profile.save", { customerId: "c-b", revision: 0, fields: { title: "乙", taxNo: "91310000MA1FL0XX0Y" } });
    await c(OWNER, "invoices.toggle", { saleId: "s4" });
    expect(await c(OWNER, "invoices.update", { id: "inv_s4", revision: 1, status: "issued" })).toMatchObject({ ok: false, error: "请先填发票号码" });
    expect(await c(OWNER, "invoices.update", { id: "inv_s4", revision: 1, amount: 28000 })).toMatchObject({ ok: true });
    const iss = await c(OWNER, "invoices.update", { id: "inv_s4", revision: 2, status: "issued", invoiceNo: "26312000000012345678", issuedOn: "2026-11-18" });
    expect(iss).toMatchObject({ ok: true, data: { record: { status: "issued", amount: 28000, invoiceNo: "26312000000012345678" } } });
    expect(tasks(s)[0].completedAt).toBeTruthy();
    expect(rec(s, "s4")!.remind!.doneAt).toBeTruthy();
    expect(await c(OWNER, "invoices.toggle", { saleId: "s4", on: false })).toMatchObject({ ok: false });
    const sent = await c(OWNER, "invoices.update", { id: "inv_s4", revision: rec(s, "s4")!.revision, status: "sent", sentTo: "SF1234567890" });
    expect(sent.data.record).toMatchObject({ status: "sent", sentTo: "SF1234567890", sentOn: "2026-11-17" });
    expect(await c(OWNER, "invoices.update", { id: "inv_s4", revision: 1, note: "旧版本" })).toMatchObject({ ok: false });
    await c(OWNER, "invoices.update", { id: "inv_s4", revision: rec(s, "s4")!.revision, status: "red" });
    expect(await c(OWNER, "invoices.update", { id: "inv_s4", revision: rec(s, "s4")!.revision, status: "pending" })).toMatchObject({ ok: false });
    expect(tasks(s)).toHaveLength(1);
  });

  it("关掉「需要开票」：还没开出的直接删掉记录、提醒标完成", async () => {
    const s = seed();
    const c = call(s, ON());
    await c(OWNER, "invoices.profile.save", { customerId: "c-b", revision: 0, text: "示例公司乙" });
    await c(OWNER, "invoices.toggle", { saleId: "s4" });
    expect((await c(OWNER, "invoices.toggle", { saleId: "s4", on: false })).ok).toBe(true);
    expect(rec(s, "s4")).toBeUndefined();
    expect(tasks(s)[0].completedAt).toBeTruthy();
  });

  it("附件：中转上传进 invoices/<自己>/；发票只收 PDF/图片；只能附自己传的；换掉的旧文件删除", async () => {
    const s = seed();
    const st = storage();
    const c = call(s, ON({ receiptStorage: st }));
    const docx = await c(ZHOU, "invoices.files.upload", { name: "开票资料.docx", data: b64([0x50, 0x4b, 3, 4, 1, 2]) });
    expect(docx).toMatchObject({ ok: true, data: { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } });
    expect(docx.data.fileID).toContain("/invoices/uid-zhou/");
    expect(await c(ZHOU, "invoices.files.upload", { name: "a.docx", purpose: "invoice", data: b64([0x50, 0x4b, 3, 4]) })).toMatchObject({ ok: false });
    expect(await c(ZHOU, "invoices.files.upload", { name: "a.exe", data: b64([0x4d, 0x5a, 0]) })).toMatchObject({ ok: false });
    // 别人传的不能挂
    expect(await c(OWNER, "invoices.profile.save", { customerId: "c-a", revision: 0, files: [docx.data] })).toMatchObject({ ok: false });
    const ok = await c(ZHOU, "invoices.profile.save", { customerId: "c-a", revision: 0, files: [docx.data] });
    expect(ok).toMatchObject({ ok: true, data: { complete: true } });
    const urls = await c(OWNER, "invoices.files.urls", { id: "prof_c-a" });
    expect(urls.data.items[0].url).toMatch(/^data:/);
    const txt = await c(ZHOU, "invoices.files.upload", { name: "资料.txt", data: b64(new TextEncoder().encode("名称：甲")) });
    await c(ZHOU, "invoices.profile.save", { customerId: "c-a", revision: 1, files: [txt.data] });
    expect(st.removed).toContain(docx.data.fileID);
    // 没开存储时不收附件
    const s2 = seed();
    const c2 = call(s2, { ...BASE, invoiceEnabled: true });
    expect(await c2(OWNER, "invoices.files.upload", { name: "a.pdf", data: b64(new TextEncoder().encode("%PDF-1")) })).toMatchObject({ ok: false });
  });

  it("列表：按状态、客户、月份筛；顶部三个数；按销售查", async () => {
    const s = seed();
    const c = call(s, ON());
    await c(OWNER, "invoices.toggle", { saleId: "s1" });
    await c(OWNER, "invoices.profile.save", { customerId: "c-b", revision: 0, text: "乙" });
    await c(OWNER, "invoices.toggle", { saleId: "s4" });
    const all = await c(OWNER, "invoices.list", { month: "2026-11" });
    expect(all.data.items.map((r: InvoiceRecord) => r.saleId)).toEqual(["s1", "s4"]);
    expect(all.data.stats).toMatchObject({ pending: { count: 2, amount: 210000, awaiting: 1 }, issued: { count: 0 }, missingCustomers: 1 });
    expect(all.data.customers).toHaveLength(2);
    expect((await c(OWNER, "invoices.list", { month: "2026-11", status: "pending" })).data.items).toHaveLength(1);
    expect((await c(OWNER, "invoices.list", { month: "2026-11", customerId: "c-a" })).data.items).toHaveLength(1);
    expect((await c(OWNER, "invoices.list", { month: "2026-09" })).data.items).toHaveLength(0);
    const by = await c(ZHOU, "invoices.forSales", { ids: ["s1", "s2", "s4"] });
    expect(Object.keys(by.data).sort()).toEqual(["s1", "s4"]);
    expect(by.data.s1).toMatchObject({ status: "awaiting_info", profileComplete: false });
    const view = await c(OWNER, "invoices.profile.get", { customerId: "c-a" });
    expect(view.data).toMatchObject({ complete: false, open: 1, filesEnabled: true });
  });

  it("操作日志只记状态和金额，不记抬头、税号、原文", async () => {
    const s = seed();
    const c = call(s, ON());
    await c(OWNER, "invoices.profile.save", { customerId: "c-a", revision: 0, fields: FULL, text: "机密原文" });
    await c(OWNER, "invoices.toggle", { saleId: "s1" });
    const logs = JSON.stringify(Object.values(s.data.audit_logs));
    expect(logs).toContain("invoices.toggle");
    expect(logs).not.toContain("91310000MA1FL0XX0X");
    expect(logs).not.toContain("机密原文");
    expect(logs).not.toContain("示例公司甲有限公司");
  });
});
