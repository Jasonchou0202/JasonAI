import { describe, expect, it } from "vitest";
import type { Sale } from "../src/domain/model";
import type { Expense } from "../src/domain/expenses";
import {
  compareMonths,
  decadeOf,
  decadePhase,
  decadesOf,
  salePayer,
  settleDecade,
  settleMonth,
  splitProfit,
  upcomingDecades,
  validateExpense,
  defaultSettings,
  countsAsExpense,
  countsInProfitShare,
  decadeSharesOpen,
  EXPENSE_START_DATE,
  EXPENSE_START_TOO_EARLY,
  PROFIT_SHARE_HINT,
  PROFIT_SHARE_START_DATE,
} from "../src/domain/expenses";

const yuan = (n: number) => n * 100;
const PEOPLE = {
  ownerUid: "demo",
  ownerName: "章鱼哥",
  partnerUid: "demo-zhou",
  partnerName: "周诗懿",
};
const TODAY = "2026-11-14";

function sale(
  id: string,
  date: string,
  revenue: number,
  cost: number,
  who: "demo" | "demo-zhou",
  paidBy?: string,
): Sale {
  return {
    id,
    productId: "p",
    productName: "示例商品",
    customer: "示例客户",
    date,
    revenue: yuan(revenue),
    cost: yuan(cost),
    note: "示例",
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
    deletedAt: null,
    revision: 1,
    createdBy: who,
    ...(paidBy ? { paidBy } : {}),
  };
}

function exp(
  id: string,
  date: string,
  amount: number,
  who: "demo" | "demo-zhou",
  status: Expense["status"],
  categoryName = "话费",
): Expense {
  return {
    id,
    date,
    amount: yuan(amount),
    categoryId: "cat-phone",
    categoryName,
    paidBy: who,
    hasInvoice: true,
    note: "示例",
    status,
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
    deletedAt: null,
    revision: 1,
    createdBy: who,
  };
}

/** 对齐示意图：1–10 收入 12000 进货 4000 报销 800；11–20 收入 18000 进货 6000 报销 1200 */
const SALES: Sale[] = [
  sale("s1", "2026-11-03", 7200, 2400, "demo"),
  sale("s2", "2026-11-08", 4800, 1600, "demo-zhou"),
  sale("s3", "2026-11-12", 10200, 3400, "demo"),
  sale("s4", "2026-11-14", 7800, 2600, "demo-zhou"),
];
const EXPENSES: Expense[] = [
  exp("e1", "2026-11-03", 200, "demo-zhou", "reimbursed", "话费"),
  exp("e2", "2026-11-06", 600, "demo", "pending_reimburse", "软件订阅"),
  exp("e3", "2026-11-12", 400, "demo-zhou", "pending_reimburse", "交通"),
  exp("e4", "2026-11-16", 500, "demo", "reimbursed", "办公"),
  exp("e5", "2026-11-18", 300, "demo", "reimbursed", "话费"),
  exp("p1", "2026-11-13", 200, "demo-zhou", "pending_confirm", "话费"),
  exp("p2", "2026-11-14", 120, "demo-zhou", "pending_confirm", "交通"),
];

describe("十天分段", () => {
  it("11 月分成 1–10 / 11–20 / 21–30", () => {
    const d = decadesOf("2026-11");
    expect(d.map((x) => [x.from, x.to, x.shortLabel])).toEqual([
      ["2026-11-01", "2026-11-10", "1–10 日"],
      ["2026-11-11", "2026-11-20", "11–20 日"],
      ["2026-11-21", "2026-11-30", "21–月末"],
    ]);
  });
  it("2 月按实际天数到月末", () => {
    const d = decadesOf("2026-02");
    expect(d[2].to).toBe("2026-02-28");
  });
  it("按日落入对应段", () => {
    expect(decadeOf("2026-11-01").index).toBe(0);
    expect(decadeOf("2026-11-10").index).toBe(0);
    expect(decadeOf("2026-11-11").index).toBe(1);
    expect(decadeOf("2026-11-20").index).toBe(1);
    expect(decadeOf("2026-11-21").index).toBe(2);
    expect(decadeOf("2026-11-30").index).toBe(2);
  });
  it("11 月 14 日：当前 11–20，后两段 21–月末、12 月 1–10", () => {
    const u = upcomingDecades("2026-11-14");
    expect(u.map((d) => `${d.from}:${d.to}`)).toEqual([
      "2026-11-11:2026-11-20",
      "2026-11-21:2026-11-30",
      "2026-12-01:2026-12-10",
    ]);
    expect(decadePhase(u[0], "2026-11-14")).toBe("current");
    expect(decadePhase(u[1], "2026-11-14")).toBe("upcoming");
    expect(decadePhase(u[2], "2026-11-14")).toBe("upcoming");
  });
});

describe("示例账合账（对齐示意图）", () => {
  it("六四开分得尽", () => {
    expect(splitProfit(yuan(7200))).toEqual({ owner: yuan(4320), partner: yuan(2880) });
    expect(splitProfit(yuan(10800))).toEqual({ owner: yuan(6480), partner: yuan(4320) });
  });
  it("1–10 已出账：分成未开始，起算日前的报销不进合账；利润全归章鱼哥，周诗懿为 0", () => {
    const row = settleDecade(decadeOf("2026-11-03"), TODAY, SALES, EXPENSES, PEOPLE, false);
    expect(row.phase).toBe("closed");
    expect(row.sharesOpen).toBe(false);
    expect(row.revenue).toBe(yuan(12000));
    expect(row.cost).toBe(yuan(4000));
    expect(row.expense).toBe(0);
    expect(row.profit).toBe(yuan(8000));
    expect(row.owner.share).toBe(1);
    expect(row.partner.share).toBe(0);
    expect(row.owner.amount).toBe(yuan(8000));
    expect(row.partner.amount).toBe(0);
    expect(row.owner.advance).toBe(0);
    expect(row.partner.advance).toBe(0);
    expect(row.partnerReceive).toBe(0);
  });
  it("11–20 进行中：11-14 起的已入账报销计入合账，待确认与更早的不进；周诗懿为 0", () => {
    const row = settleDecade(decadeOf("2026-11-14"), TODAY, SALES, EXPENSES, PEOPLE, false);
    expect(row.phase).toBe("current");
    expect(row.sharesOpen).toBe(false);
    expect(row.revenue).toBe(yuan(18000));
    expect(row.cost).toBe(yuan(6000));
    expect(row.expense).toBe(yuan(800));
    expect(row.profit).toBe(yuan(11200));
    expect(row.owner.amount).toBe(yuan(11200));
    expect(row.partner.amount).toBe(0);
    expect(row.partnerReceive).toBe(0);
  });
  it("21–月末待出账：金额为 0，不做结算，但已进入分成窗口", () => {
    const row = settleDecade(decadeOf("2026-11-25"), TODAY, SALES, EXPENSES, PEOPLE, false);
    expect(row.phase).toBe("upcoming");
    expect(row.sharesOpen).toBe(true);
    expect(row.revenue).toBe(0);
    expect(row.profit).toBe(0);
    expect(row.partnerReceive).toBe(0);
  });
  it("11/1–11/20 已出账合计：照常合计利润，章鱼哥 100%、周诗懿 0；待确认只计起算日及之后", () => {
    const month = settleMonth("2026-11", TODAY, SALES, EXPENSES, PEOPLE, false);
    expect(month.pendingCount).toBe(1);
    expect(month.posted.sharesOpen).toBe(false);
    expect(month.posted.revenue).toBe(yuan(30000));
    expect(month.posted.profit).toBe(yuan(19200));
    expect(month.posted.salesProfit).toBe(yuan(20000));
    expect(month.posted.owner.share).toBe(1);
    expect(month.posted.partner.share).toBe(0);
    expect(month.posted.owner.amount).toBe(yuan(19200));
    expect(month.posted.partner.amount).toBe(0);
    expect(month.posted.partner.advance).toBe(0);
    expect(month.posted.partnerReceive).toBe(0);
  });
  it("已驳回、回收站里的报销不进合账", () => {
    const extra: Expense[] = [
      ...EXPENSES,
      { ...exp("r1", "2026-11-16", 9000, "demo", "rejected"), note: "驳回" },
      { ...exp("d1", "2026-11-16", 8000, "demo", "reimbursed"), deletedAt: "2026-11-16T00:00:00.000Z" },
    ];
    const row = settleDecade(decadeOf("2026-11-14"), TODAY, SALES, extra, PEOPLE, false);
    expect(row.expense).toBe(yuan(800));
  });
});

describe("进货付款人开关", () => {
  it("开关关：一律按录入人，不看 paidBy", () => {
    const rows = [
      sale("a", "2026-11-21", 100, 40, "demo", "demo-zhou"),
      sale("b", "2026-11-21", 100, 60, "demo-zhou", "demo"),
    ];
    expect(salePayer(rows[0], "demo", false)).toBe("demo");
    expect(salePayer(rows[1], "demo", false)).toBe("demo-zhou");
    const row = settleDecade(decadeOf("2026-11-21"), "2026-11-22", rows, [], PEOPLE, false);
    expect(row.owner.advance).toBe(yuan(40));
    expect(row.partner.advance).toBe(yuan(60));
  });
  it("开关开：用 paidBy；没有 paidBy 时回退录入人", () => {
    const rows = [
      sale("a", "2026-11-21", 100, 40, "demo", "demo-zhou"),
      sale("b", "2026-11-21", 100, 60, "demo-zhou"),
    ];
    expect(salePayer(rows[0], "demo", true)).toBe("demo-zhou");
    expect(salePayer(rows[1], "demo", true)).toBe("demo-zhou");
    const row = settleDecade(decadeOf("2026-11-21"), "2026-11-22", rows, [], PEOPLE, true);
    expect(row.owner.advance).toBe(0);
    expect(row.partner.advance).toBe(yuan(100));
  });
});

describe("利润对照：进行中的月份只计到已出账/进行中的段", () => {
  it("11 月 14 日：对照里本月按已出账/进行中的段合计实际利润（与分成无关）", () => {
    const rows = compareMonths(TODAY, SALES, EXPENSES, PEOPLE, false, 1);
    expect(rows[0].month).toBe("2026-11");
    expect(rows[0].partial).toBe(true);
    expect(rows[0].salesProfit).toBe(yuan(20000));
    expect(rows[0].profit).toBe(yuan(19200));
  });
});

describe("校验", () => {
  it("拒绝无效金额和未知分类", () => {
    const cats = defaultSettings("2026-11-14T00:00:00.000Z").categories;
    expect(() =>
      validateExpense(
        {
          date: "2026-11-14",
          amount: 0,
          categoryId: "cat-phone",
          categoryName: "话费",
          paidBy: "demo",
          hasInvoice: false,
          note: "",
          status: "pending_reimburse",
        },
        cats,
      ),
    ).toThrow(/金额/);
    expect(() =>
      validateExpense(
        {
          date: "2026-11-14",
          amount: 100,
          categoryId: "nope",
          categoryName: "无",
          paidBy: "demo",
          hasInvoice: false,
          note: "",
          status: "pending_reimburse",
        },
        cats,
      ),
    ).toThrow(/分类/);
  });
});

describe("起算日", () => {
  it("报销 11-13 不计、11-14 计；分成 11-20 不开、11-21 开", () => {
    expect(countsAsExpense("2026-11-13")).toBe(false);
    expect(countsAsExpense("2026-11-14")).toBe(true);
    expect(countsInProfitShare("2026-11-20")).toBe(false);
    expect(countsInProfitShare("2026-11-21")).toBe(true);
    expect(decadeSharesOpen(decadeOf("2026-11-20"))).toBe(false);
    expect(decadeSharesOpen(decadeOf("2026-11-21"))).toBe(true);
    expect(EXPENSE_START_DATE).toBe("2026-11-14");
    expect(PROFIT_SHARE_START_DATE).toBe("2026-11-21");
    expect(PROFIT_SHARE_HINT).toBe("11 月 21 日起开始分成");
  });
  it("11-13 的已入账报销不进合账，11-14 的计入", () => {
    const rows = [
      exp("early", "2026-11-13", 900, "demo", "reimbursed"),
      exp("on", "2026-11-14", 300, "demo", "reimbursed"),
    ];
    const row = settleDecade(decadeOf("2026-11-14"), TODAY, [], rows, PEOPLE, false);
    expect(row.expense).toBe(yuan(300));
  });
  it("11-14 至 11-20：周诗懿垫付且已确认的报销退给她（照常扣利润），分成仍为 0；11-13 的和章鱼哥垫付的不退", () => {
    const sales: Sale[] = [sale("s", "2026-11-15", 5000, 1000, "demo")];
    const expenses: Expense[] = [
      exp("zhou-early", "2026-11-13", 700, "demo-zhou", "reimbursed"),
      exp("zhou-15", "2026-11-15", 260, "demo-zhou", "pending_reimburse"),
      exp("zhou-pending", "2026-11-16", 90, "demo-zhou", "pending_confirm"),
      exp("owner-17", "2026-11-17", 150, "demo", "reimbursed"),
    ];
    const row = settleDecade(decadeOf("2026-11-15"), "2026-11-22", sales, expenses, PEOPLE, false);
    expect(row.sharesOpen).toBe(false);
    expect(row.expense).toBe(yuan(410));
    expect(row.profit).toBe(yuan(3590));
    expect(row.owner.amount).toBe(yuan(3590));
    expect(row.partner.share).toBe(0);
    expect(row.partner.amount).toBe(0);
    expect(row.partner.advance).toBe(yuan(260));
    expect(row.owner.advance).toBe(0);
    expect(row.partnerReceive).toBe(yuan(260));

    const month = settleMonth("2026-11", "2026-11-22", sales, expenses, PEOPLE, false);
    expect(month.decades[0].partnerReceive).toBe(0);
    expect(month.posted.partner.advance).toBe(yuan(260));
    expect(month.posted.partner.amount).toBe(0);
    expect(month.posted.partnerReceive).toBe(yuan(260));
  });
  it("只有 11-13 周诗懿垫付的报销：不计入合账、不退", () => {
    const row = settleDecade(
      decadeOf("2026-11-13"),
      "2026-11-22",
      [],
      [exp("zhou-13", "2026-11-13", 500, "demo-zhou", "reimbursed")],
      PEOPLE,
      false,
    );
    expect(row.expense).toBe(0);
    expect(row.partner.advance).toBe(0);
    expect(row.partnerReceive).toBe(0);
  });
  it("11-20 不分；11-21 起按实际利润六四分成，只纳入当日及之后的销售、进货和报销", () => {
    const sales: Sale[] = [
      sale("before", "2026-11-20", 5000, 1000, "demo"),
      sale("on", "2026-11-21", 10000, 2000, "demo"),
      sale("after", "2026-11-22", 5000, 1000, "demo-zhou"),
    ];
    const expenses: Expense[] = [
      exp("e-before", "2026-11-20", 400, "demo", "reimbursed"),
      exp("e-on", "2026-11-21", 200, "demo", "reimbursed"),
      exp("e-after", "2026-11-22", 300, "demo-zhou", "pending_reimburse"),
    ];
    const closed = settleDecade(decadeOf("2026-11-20"), "2026-11-22", sales, expenses, PEOPLE, false);
    expect(closed.sharesOpen).toBe(false);
    expect(closed.profit).toBe(yuan(3600));
    expect(closed.owner.amount).toBe(yuan(3600));
    expect(closed.partner.amount).toBe(0);
    expect(closed.partnerReceive).toBe(0);
    expect(closed.expense).toBe(yuan(400));

    const open = settleDecade(decadeOf("2026-11-21"), "2026-11-22", sales, expenses, PEOPLE, false);
    expect(open.sharesOpen).toBe(true);
    expect(open.phase).toBe("current");
    expect(open.revenue).toBe(yuan(15000));
    expect(open.cost).toBe(yuan(3000));
    expect(open.expense).toBe(yuan(500));
    expect(open.profit).toBe(yuan(11500));
    expect(open.owner.amount).toBe(yuan(6900));
    expect(open.partner.amount).toBe(yuan(4600));
    expect(open.owner.advance).toBe(yuan(2200));
    expect(open.partner.advance).toBe(yuan(1300));
  });
  it("拒绝早于报销起算日的日期", () => {
    const cats = defaultSettings("2026-11-14T00:00:00.000Z").categories;
    expect(() =>
      validateExpense(
        {
          date: "2026-11-13",
          amount: 100,
          categoryId: "cat-phone",
          categoryName: "话费",
          paidBy: "demo",
          hasInvoice: false,
          note: "",
          status: "pending_reimburse",
        },
        cats,
      ),
    ).toThrow(EXPENSE_START_TOO_EARLY);
  });
});

describe("示例账本种子", () => {
  it("11 月 14 日尚未分成；21 日起的示例账进入分成", async () => {
    const { MemoryStore } = await import("../server/memory-store");
    const { seedExpenseDemo, EXPENSE_DEMO_OWNER, EXPENSE_DEMO_PARTNER } = await import("../src/lib/expense-demo");
    const { settleMonth, upcomingDecades } = await import("../src/domain/expenses");
    const { Sale } = await import("../src/domain/model") as any;
    const store = new MemoryStore();
    seedExpenseDemo(store);
    const sales = Object.values(store.data.sales) as import("../src/domain/model").Sale[];
    const expenses = Object.values(store.data.expenses).filter((r: any) => r && r.date) as import("../src/domain/expenses").Expense[];
    const people = { ownerUid: EXPENSE_DEMO_OWNER, ownerName: "章鱼哥", partnerUid: EXPENSE_DEMO_PARTNER, partnerName: "周诗懿" };
    const month = settleMonth("2026-11", "2026-11-14", sales, expenses, people, false);
    expect(month.posted.sharesOpen).toBe(false);
    // 示例里 11-14 周诗懿垫付 ¥180 已确认：照常扣利润，并退给她
    expect(month.posted.profit).toBe(1_902_000);
    expect(month.posted.owner.amount).toBe(1_902_000);
    expect(month.posted.partner.amount).toBe(0);
    expect(month.posted.partnerReceive).toBe(18_000);
    expect(month.decades[0].sharesOpen).toBe(false);
    expect(month.decades[0].profit).toBe(800_000);
    expect(month.decades[0].partner.amount).toBe(0);
    expect(month.decades[1].sharesOpen).toBe(false);
    expect(month.decades[1].profit).toBe(1_102_000);
    expect(month.decades[1].owner.amount).toBe(1_102_000);
    expect(month.decades[1].partnerReceive).toBe(18_000);
    expect(month.decades[1].partner.amount).toBe(0);
    expect(month.decades[2].sharesOpen).toBe(true);
    expect(month.pendingCount).toBe(1);
    expect(upcomingDecades("2026-11-14")[0].from).toBe("2026-11-11");
    const nov = sales.filter((s) => s.date.startsWith("2026-11") && !s.deletedAt);
    expect(nov.length).toBe(33);
    const on22 = settleMonth("2026-11", "2026-11-22", sales, expenses, people, false);
    expect(on22.decades[2].sharesOpen).toBe(true);
    expect(on22.decades[2].phase).toBe("current");
    expect(on22.decades[2].revenue).toBe(1_500_000);
    expect(on22.decades[2].cost).toBe(500_000);
    expect(on22.decades[2].expense).toBe(100_000);
    expect(on22.decades[2].profit).toBe(900_000);
    expect(on22.decades[2].owner.amount).toBe(540_000);
    expect(on22.decades[2].partner.amount).toBe(360_000);
    expect(on22.posted.sharesOpen).toBe(true);
    // 合计：1–20 日 19,020 全归章鱼哥（已扣 11-14 周诗懿垫付 180）；21 日起 9,000 六四分
    expect(on22.posted.profit).toBe(2_802_000);
    expect(on22.posted.owner.amount).toBe(1_902_000 + 540_000);
    expect(on22.posted.partnerReceive).toBe(on22.decades[1].partnerReceive + on22.decades[2].partnerReceive);
    expect(on22.decades[1].partnerReceive).toBe(18_000);
    expect(on22.posted.partner.amount).toBe(360_000);
    expect(on22.posted.owner.share).toBe(-1);
  });
});

describe("分类：软件订阅下线，自定义分类保留", () => {
  it("默认预设里没有软件订阅；云端旧设置里的软件订阅不再可选，自定义和其他预设都保留", async () => {
    const { DEFAULT_CATEGORIES, selectableCategories } = await import("../src/domain/expenses");
    expect(DEFAULT_CATEGORIES.some((c) => c.name === "软件订阅")).toBe(false);
    const saved = [
      ...defaultSettings("2026-11-14T00:00:00.000Z").categories,
      { id: "cat-software", name: "软件订阅", preset: true, createdAt: "x" },
      { id: "u1", name: "自定义一", createdAt: "x" },
      { id: "u2", name: "自定义二", createdAt: "x" },
      { id: "u3", name: "自定义三", createdAt: "x" },
      { id: "u4", name: "已删", createdAt: "x", archivedAt: "y" },
    ];
    const names = selectableCategories(saved).map((c) => c.name);
    expect(names).not.toContain("软件订阅");
    expect(names).not.toContain("已删");
    expect(names).toEqual(expect.arrayContaining(["自定义一", "自定义二", "自定义三", "话费", "其他"]));
  });
});

describe("凭证", () => {
  it("类型按 type 或扩展名判断；推导有无发票；列表摘要", async () => {
    const { receiptMime, deriveHasInvoice, receiptSummary, validateReceipts, receiptUploader, shareLabel } = await import("../src/domain/expenses");
    expect(receiptMime("a.pdf", "application/pdf")).toBe("application/pdf");
    expect(receiptMime("IMG_1.HEIC", "")).toBe("image/heic");
    expect(receiptMime("x.webp", "image/webp")).toBe("image/webp");
    expect(receiptMime("x.gif", "image/gif")).toBe(null);
    expect(receiptMime("x.exe", "")).toBe(null);
    const r = (kind: "invoice" | "no_invoice" | "payment", n = 1) => ({
      fileID: `cloud://env.bucket/expenses/demo/f${kind}${n}.pdf`, name: "a.pdf", type: "application/pdf" as const, size: 10, kind,
    });
    expect(deriveHasInvoice([r("payment")], true)).toBe(false);
    expect(deriveHasInvoice([r("payment"), r("invoice")], false)).toBe(true);
    expect(deriveHasInvoice([], true)).toBe(true);
    expect(receiptSummary({ hasInvoice: true })).toBe("有发票");
    expect(receiptSummary({ hasInvoice: false, receipts: [r("invoice"), r("payment", 1), r("payment", 2)] })).toBe("发票 · 支付凭证 ×2");
    expect(receiptUploader("cloud://env.bucket/expenses/u-1/20261115-ab.pdf")).toBe("u-1");
    expect(() => validateReceipts([{ ...r("invoice"), fileID: "cloud://env/avatars/demo/a.jpg" }])).toThrow(/凭证文件无效/);
    expect(() => validateReceipts([{ ...r("invoice"), size: 10 * 1024 * 1024 + 1 }])).toThrow(/10MB/);
    expect(() => validateReceipts([{ ...r("invoice"), type: "image/gif" }])).toThrow(/PDF/);
    expect(() => validateReceipts(Array.from({ length: 10 }, (_, i) => r("invoice", i)))).toThrow(/最多/);
    expect(shareLabel(1)).toBe("100%");
    expect(shareLabel(0)).toBe("0%");
    expect(shareLabel(0.6)).toBe("60%");
    expect(shareLabel(-1)).toBe("");
  });
});
