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
  it("1–10 已出账：分成未开始，起算日前的报销不进合账，不显示应得", () => {
    const row = settleDecade(decadeOf("2026-11-03"), TODAY, SALES, EXPENSES, PEOPLE, false);
    expect(row.phase).toBe("closed");
    expect(row.sharesOpen).toBe(false);
    expect(row.revenue).toBe(yuan(12000));
    expect(row.cost).toBe(yuan(4000));
    expect(row.expense).toBe(0);
    expect(row.profit).toBe(0);
    expect(row.owner.amount).toBe(0);
    expect(row.partner.amount).toBe(0);
    expect(row.partnerReceive).toBe(0);
  });
  it("11–20 进行中：11-14 起的已入账报销计入合账，待确认与更早的不进；尚未分成", () => {
    const row = settleDecade(decadeOf("2026-11-14"), TODAY, SALES, EXPENSES, PEOPLE, false);
    expect(row.phase).toBe("current");
    expect(row.sharesOpen).toBe(false);
    expect(row.revenue).toBe(yuan(18000));
    expect(row.cost).toBe(yuan(6000));
    expect(row.expense).toBe(yuan(800));
    expect(row.profit).toBe(0);
    expect(row.owner.amount).toBe(0);
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
  it("11 月 14 日已出账合计：分成尚未开始，应得为 0；待确认只计起算日及之后", () => {
    const month = settleMonth("2026-11", TODAY, SALES, EXPENSES, PEOPLE, false);
    expect(month.pendingCount).toBe(1);
    expect(month.posted.sharesOpen).toBe(false);
    expect(month.posted.profit).toBe(0);
    expect(month.posted.salesProfit).toBe(0);
    expect(month.posted.owner.amount).toBe(0);
    expect(month.posted.partner.amount).toBe(0);
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
  it("11 月 14 日分成尚未开始，对照里本月利润为 0", () => {
    const rows = compareMonths(TODAY, SALES, EXPENSES, PEOPLE, false, 1);
    expect(rows[0].month).toBe("2026-11");
    expect(rows[0].partial).toBe(true);
    expect(rows[0].salesProfit).toBe(0);
    expect(rows[0].profit).toBe(0);
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
    expect(closed.profit).toBe(0);
    expect(closed.owner.amount).toBe(0);
    expect(closed.partner.amount).toBe(0);
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
    expect(month.posted.profit).toBe(0);
    expect(month.decades[0].sharesOpen).toBe(false);
    expect(month.decades[0].profit).toBe(0);
    expect(month.decades[1].sharesOpen).toBe(false);
    expect(month.decades[1].profit).toBe(0);
    expect(month.decades[1].owner.amount).toBe(0);
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
    expect(on22.posted.profit).toBe(900_000);
  });
});
