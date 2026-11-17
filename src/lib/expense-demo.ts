import type { Product, Sale } from "../domain/model";
import type { Expense, ExpenseSettings } from "../domain/expenses";
import { DEFAULT_CATEGORIES } from "../domain/expenses";
import { MemoryStore } from "../../server/memory-store";
import { MemoryReceiptStorage } from "../../server/receipts";
import type { InvoiceProfile, InvoiceRecord, InvoiceStatus } from "../domain/invoices";

/** 演示里的凭证「云存储」：只在本页内存里，刷新后文件不保留（只有示例记录） */
const demoReceipts = new MemoryReceiptStorage();

/** 演示账本（虚构）：对齐示意图数字，人名只用章鱼哥、周诗懿 */
export const EXPENSE_DEMO_OWNER = "demo";
export const EXPENSE_DEMO_PARTNER = "demo-zhou";
const AT = "2026-11-14T02:00:00.000Z";
const yuan = (n: number) => n * 100;

function sale(
  id: string,
  date: string,
  revenue: number,
  cost: number,
  who: string,
  product: Product,
  customer: string,
): Sale {
  const time = `${date}T03:00:00.000Z`;
  return {
    id,
    productId: product.id,
    productName: product.name,
    customer,
    date,
    revenue,
    cost,
    note: "示意 · 示例数据",
    createdAt: time,
    updatedAt: time,
    deletedAt: null,
    revision: 1,
    createdBy: who,
    paidBy: who,
  };
}

function expense(
  id: string,
  date: string,
  amount: number,
  categoryId: string,
  categoryName: string,
  who: string,
  status: Expense["status"],
  hasInvoice: boolean,
  note: string,
  createdBy?: string,
): Expense {
  const time = `${date}T04:00:00.000Z`;
  return {
    id,
    date,
    amount: yuan(amount),
    categoryId,
    categoryName,
    paidBy: who,
    hasInvoice,
    note,
    status,
    createdAt: time,
    updatedAt: time,
    deletedAt: null,
    revision: 1,
    createdBy: createdBy || who,
  };
}

/** 把总额拆成 n 笔整数分，总和精确相等 */
function split(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const rows = Array.from({ length: n }, () => base);
  rows[n - 1] += total - base * n;
  return rows;
}

export function seedExpenseDemo(store: MemoryStore) {
  const products: Product[] = [
    { id: "demo-p-0", name: "Plus 会员", price: yuan(1800), cost: yuan(600), active: true, order: 0 },
    { id: "demo-p-1", name: "Plus 成品号", price: yuan(2580), cost: yuan(860), active: true, order: 1 },
    { id: "demo-p-2", name: "Claude Pro", price: yuan(2580), cost: yuan(900), active: true, order: 2 },
  ];
  products.forEach((p) => {
    store.data.products[p.id] = p;
  });
  const p0 = products[0];
  // 全是虚构名称（开票预览用公司名）
  const customers = ["示例公司 · 青禾文化", "示例公司 · 远山科技", "示例公司 · 木木设计", "示例客户 · 陈同学"];

  const plan: { prefix: string; dates: string[]; revenue: number; cost: number; who: string }[] = [
    { prefix: "n1o", dates: ["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-07", "2026-11-09", "2026-11-10"], revenue: yuan(7200), cost: yuan(2400), who: EXPENSE_DEMO_OWNER },
    { prefix: "n1z", dates: ["2026-11-01", "2026-11-04", "2026-11-06", "2026-11-08"], revenue: yuan(4800), cost: yuan(1600), who: EXPENSE_DEMO_PARTNER },
    { prefix: "n2o", dates: ["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"], revenue: yuan(10200), cost: yuan(3400), who: EXPENSE_DEMO_OWNER },
    { prefix: "n2z", dates: ["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-18"], revenue: yuan(7800), cost: yuan(2600), who: EXPENSE_DEMO_PARTNER },
    { prefix: "n3o", dates: ["2026-11-21", "2026-11-22", "2026-11-24", "2026-11-26", "2026-11-28"], revenue: yuan(9000), cost: yuan(3000), who: EXPENSE_DEMO_OWNER },
    { prefix: "n3z", dates: ["2026-11-21", "2026-11-23", "2026-11-25", "2026-11-27"], revenue: yuan(6000), cost: yuan(2000), who: EXPENSE_DEMO_PARTNER },
  ];
  let n = 0;
  for (const block of plan) {
    const revenues = split(block.revenue, block.dates.length);
    const costs = split(block.cost, block.dates.length);
    block.dates.forEach((date, i) => {
      const row = sale(`${block.prefix}-${i}`, date, revenues[i], costs[i], block.who, products[n % 3], customers[n % 4]);
      store.data.sales[row.id] = row;
      n += 1;
    });
  }

  // 上月同期（10/1–14）利润 18,518.52 元，使看板「比上月同期」为 +8%
  const prevProfit = 1_851_852;
  const prevRev = 2_400_000;
  store.data.sales["oct-sync"] = sale("oct-sync", "2026-10-08", prevRev, prevRev - prevProfit, EXPENSE_DEMO_OWNER, p0, customers[0]);

  // 近 5 个月对照用的往月示例（已结束的整月）
  const history: { month: string; revenue: number; cost: number; expenseYuan: number; date: string }[] = [
    { month: "2026-07", revenue: yuan(18000), cost: yuan(5000), expenseYuan: 800, date: "2026-07-15" },
    { month: "2026-08", revenue: yuan(21000), cost: yuan(5500), expenseYuan: 900, date: "2026-08-15" },
    { month: "2026-09", revenue: yuan(24000), cost: yuan(6000), expenseYuan: 1100, date: "2026-09-15" },
    { month: "2026-10", revenue: yuan(2000), cost: 51_852, expenseYuan: 2000, date: "2026-10-22" },
  ];
  history.forEach((h, i) => {
    const sid = `hist-s-${i}`;
    store.data.sales[sid] = sale(sid, h.date, h.revenue, h.cost, EXPENSE_DEMO_OWNER, p0, customers[i % 4]);
    const eid = `hist-e-${i}`;
    store.data.expenses[eid] = expense(eid, h.date, h.expenseYuan, "cat-software", "软件订阅", EXPENSE_DEMO_OWNER, "reimbursed", false, "示意 · 往月订阅");
  });

  const settings: ExpenseSettings = {
    partnerUid: EXPENSE_DEMO_PARTNER,
    partnerName: "周诗懿",
    categories: [
      ...DEFAULT_CATEGORIES.map((c) => ({ ...c, preset: true, createdAt: AT })),
      // 模拟云端旧设置里还留着已下线的「软件订阅」预设：新记录里不再出现，旧记录照常显示
      { id: "cat-software", name: "软件订阅", hint: "ChatGPT / Claude / Grok Bot", preset: true, createdAt: AT },
      // 模拟用户自己加的三个分类（示例名称）
      { id: "cat-custom-1", name: "示例分类 · 招待", createdAt: AT },
      { id: "cat-custom-2", name: "示例分类 · 快递", createdAt: AT },
      { id: "cat-custom-3", name: "示例分类 · 推广", createdAt: AT },
    ],
  };
  store.data.expenses["_settings"] = settings;

  const rows: Expense[] = [
    expense("e-1103", "2026-11-03", 200, "cat-phone", "话费", EXPENSE_DEMO_PARTNER, "reimbursed", true, "十一月手机话费", EXPENSE_DEMO_PARTNER),
    expense("e-1106", "2026-11-06", 600, "cat-software", "软件订阅", EXPENSE_DEMO_OWNER, "pending_reimburse", false, "Claude、ChatGPT 十一月订阅"),
    expense("e-1112", "2026-11-12", 400, "cat-transport", "交通", EXPENSE_DEMO_PARTNER, "pending_reimburse", true, "客户拜访交通", EXPENSE_DEMO_PARTNER),
    expense("e-1114", "2026-11-14", 180, "cat-transport", "交通", EXPENSE_DEMO_PARTNER, "pending_reimburse", true, "客户拜访打车", EXPENSE_DEMO_PARTNER),
    expense("e-1116", "2026-11-16", 500, "cat-office", "办公", EXPENSE_DEMO_OWNER, "reimbursed", true, "办公用品"),
    expense("e-1118", "2026-11-18", 300, "cat-phone", "话费", EXPENSE_DEMO_OWNER, "reimbursed", true, "十一月话费"),
    expense("p-1113", "2026-11-13", 200, "cat-phone", "话费", EXPENSE_DEMO_PARTNER, "pending_confirm", true, "十一月手机话费", EXPENSE_DEMO_PARTNER),
    expense("p-1114", "2026-11-14", 120, "cat-transport", "交通", EXPENSE_DEMO_PARTNER, "pending_confirm", false, "去见客户打车", EXPENSE_DEMO_PARTNER),
    expense("e-1121", "2026-11-21", 400, "cat-software", "软件订阅", EXPENSE_DEMO_OWNER, "pending_reimburse", false, "Claude、ChatGPT 十一月订阅"),
    expense("e-1125", "2026-11-25", 600, "cat-office", "办公", EXPENSE_DEMO_PARTNER, "reimbursed", true, "办公用品", EXPENSE_DEMO_PARTNER),
  ];
  for (const r of rows) store.data.expenses[r.id] = r;

  store.data.members[EXPENSE_DEMO_PARTNER] = {
    uid: EXPENSE_DEMO_PARTNER,
    name: "周诗懿",
    status: "active",
    inviteId: "demo",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    revision: 1,
  };
  store.data.batches["_ledger"] = { hasSales: true };
  seedInvoiceDemo(store, customers);
}

export function expenseDemoTeam() {
  return {
    membersEnabled: true,
    auditEnabled: true,
    expensesEnabled: true,
    salesPayerEnabled: true,
    expenseReceiptsEnabled: true,
    expenseRenewEnabled: true,
    invoiceEnabled: true,
    receiptStorage: demoReceipts,
  };
}

/** 开票预览（虚构抬头、税号、号码）：四位示例客户，状态覆盖待收资料 / 待开票 / 已开票 / 已寄出 */
function seedInvoiceDemo(store: MemoryStore, names: string[]) {
  const ids = ["demo-c-qinghe", "demo-c-yuanshan", "demo-c-mumu", "demo-c-chen"];
  names.forEach((name, i) => {
    store.data.customers[ids[i]] = { id: ids[i], name, mergedInto: null, revision: 1, createdAt: AT, updatedAt: AT };
  });
  const profile = (i: number, p: Partial<InvoiceProfile>): InvoiceProfile => ({
    kind: "profile", id: `prof_${ids[i]}`, customerId: ids[i], text: "", fields: {}, files: [],
    createdAt: AT, updatedAt: AT, updatedBy: EXPENSE_DEMO_OWNER, revision: 1, ...p,
  });
  const profiles = [
    profile(0, {
      fields: {
        title: "示例 · 青禾文化传播有限公司",
        taxNo: "91310000MA1DEMO01X",
        addressPhone: "上海市示例区示例路 88 号 021-0000 0000",
        bankAccount: "示例银行上海分行 6222 0000 0000 0001",
        email: "fapiao@qinghe.example",
      },
    }),
    profile(1, {
      text: "名称：示例 · 远山科技有限公司\n税号：91440300MA5DEMO02Y\n地址电话：深圳市示例区科技园 0755-0000 0000\n收票邮箱：finance@yuanshan.example",
      files: [{ fileID: "cloud://demo/invoices/demo/20261110-yuanshan.docx", name: "远山开票资料.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 18_432 }],
    }),
    profile(2, { fields: { title: "示例 · 木木设计工作室" } }),
  ];
  for (const p of profiles) store.data.invoices[p.id] = p;
  const sales = Object.values(store.data.sales) as Sale[];
  const of = (name: string) => sales.filter((x) => x.customer === name && x.date.startsWith("2026-11")).sort((a, b) => a.date.localeCompare(b.date));
  const plan: [number, number, InvoiceStatus, Partial<InvoiceRecord>?][] = [
    [0, 0, "sent", { invoiceNo: "26312000000041230001", issuedOn: "2026-11-06", sentTo: "fapiao@qinghe.example", sentOn: "2026-11-06", files: [{ fileID: "cloud://demo/invoices/demo/20261106-a.pdf", name: "发票-青禾-1106.pdf", type: "application/pdf", size: 86_000 }] }],
    [0, 1, "issued", { invoiceNo: "26312000000041230002", issuedOn: "2026-11-13" }],
    [0, 2, "pending"],
    [1, 0, "issued", { invoiceNo: "26442000000088120003", issuedOn: "2026-11-11" }],
    [1, 1, "pending"],
    [1, 2, "pending"],
    [2, 0, "awaiting_info"],
    [2, 1, "awaiting_info"],
    [3, 0, "awaiting_info"],
  ];
  for (const [ci, si, status, extra] of plan) {
    const sale = of(names[ci])[si];
    if (!sale) continue;
    const p = profiles[ci];
    const title = !p ? "" : p.fields.title || p.text.split("\n")[0].replace(/^名称：/, "");
    const statusAt = `${addDay(sale.date, status === "pending" && si === 1 ? 0 : 1)}T03:00:00.000Z`;
    const rec: InvoiceRecord = {
      kind: "invoice", id: `inv_${sale.id}`, saleId: sale.id, customerId: ids[ci], customerName: names[ci],
      productName: sale.productName, saleDate: sale.date, saleRevenue: sale.revenue, amount: sale.revenue,
      type: "vat_normal", status, title, statusAt, createdAt: statusAt, updatedAt: statusAt,
      createdBy: sale.createdBy || EXPENSE_DEMO_OWNER, revision: 1, ...extra,
    };
    store.data.invoices[rec.id] = rec;
  }
}
function addDay(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
