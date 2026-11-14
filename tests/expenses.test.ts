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
  it("1–10 已出账：实际利润 7200，周诗懿应收回 4680", () => {
    const row = settleDecade(decadeOf("2026-11-03"), TODAY, SALES, EXPENSES, PEOPLE, false);
    expect(row.phase).toBe("closed");
    expect(row.revenue).toBe(yuan(12000));
    expect(row.cost).toBe(yuan(4000));
    expect(row.expense).toBe(yuan(800));
    expect(row.totalCost).toBe(yuan(4800));
    expect(row.profit).toBe(yuan(7200));
    expect(row.owner.amount).toBe(yuan(4320));
    expect(row.partner.amount).toBe(yuan(2880));
    expect(row.owner.advance).toBe(yuan(3000));
    expect(row.partner.advance).toBe(yuan(1800));
    expect(row.partnerReceive).toBe(yuan(4680));
  });
  it("11–20 进行中：实际利润 10800，看板应得 6480 / 4320；待确认不进合账", () => {
    const row = settleDecade(decadeOf("2026-11-14"), TODAY, SALES, EXPENSES, PEOPLE, false);
    expect(row.phase).toBe("current");
    expect(row.revenue).toBe(yuan(18000));
    expect(row.cost).toBe(yuan(6000));
    expect(row.expense).toBe(yuan(1200));
    expect(row.totalCost).toBe(yuan(7200));
    expect(row.profit).toBe(yuan(10800));
    expect(row.owner.amount).toBe(yuan(6480));
    expect(row.partner.amount).toBe(yuan(4320));
    expect(row.owner.advance).toBe(yuan(4200));
    expect(row.partner.advance).toBe(yuan(3000));
    expect(row.partnerReceive).toBe(yuan(7320));
  });
  it("21–月末待出账：金额为 0，不做结算", () => {
    const row = settleDecade(decadeOf("2026-11-25"), TODAY, SALES, EXPENSES, PEOPLE, false);
    expect(row.phase).toBe("upcoming");
    expect(row.revenue).toBe(0);
    expect(row.profit).toBe(0);
    expect(row.partnerReceive).toBe(0);
  });
  it("1–20 已出账合计：收入 30000、进货 10000、报销 2000、实际利润 18000、应收回 12000", () => {
    const month = settleMonth("2026-11", TODAY, SALES, EXPENSES, PEOPLE, false);
    expect(month.pendingCount).toBe(2);
    expect(month.posted.revenue).toBe(yuan(30000));
    expect(month.posted.cost).toBe(yuan(10000));
    expect(month.posted.expense).toBe(yuan(2000));
    expect(month.posted.totalCost).toBe(yuan(12000));
    expect(month.posted.profit).toBe(yuan(18000));
    expect(month.posted.salesProfit).toBe(yuan(20000));
    expect(month.posted.owner.amount).toBe(yuan(10800));
    expect(month.posted.partner.amount).toBe(yuan(7200));
    expect(month.posted.partner.advance).toBe(yuan(4800));
    expect(month.posted.partnerReceive).toBe(yuan(12000));
  });
  it("已驳回、回收站里的报销不进合账", () => {
    const extra: Expense[] = [
      ...EXPENSES,
      { ...exp("r1", "2026-11-12", 9000, "demo", "rejected"), note: "驳回" },
      { ...exp("d1", "2026-11-12", 8000, "demo", "reimbursed"), deletedAt: "2026-11-12T00:00:00.000Z" },
    ];
    const row = settleDecade(decadeOf("2026-11-14"), TODAY, SALES, extra, PEOPLE, false);
    expect(row.expense).toBe(yuan(1200));
  });
});

describe("进货付款人开关", () => {
  it("开关关：一律按录入人，不看 paidBy", () => {
    const rows = [
      sale("a", "2026-11-03", 100, 40, "demo", "demo-zhou"),
      sale("b", "2026-11-03", 100, 60, "demo-zhou", "demo"),
    ];
    expect(salePayer(rows[0], "demo", false)).toBe("demo");
    expect(salePayer(rows[1], "demo", false)).toBe("demo-zhou");
    const row = settleDecade(decadeOf("2026-11-03"), TODAY, rows, [], PEOPLE, false);
    expect(row.owner.advance).toBe(yuan(40));
    expect(row.partner.advance).toBe(yuan(60));
  });
  it("开关开：用 paidBy；没有 paidBy 时回退录入人", () => {
    const rows = [
      sale("a", "2026-11-03", 100, 40, "demo", "demo-zhou"),
      sale("b", "2026-11-03", 100, 60, "demo-zhou"),
    ];
    expect(salePayer(rows[0], "demo", true)).toBe("demo-zhou");
    expect(salePayer(rows[1], "demo", true)).toBe("demo-zhou");
    const row = settleDecade(decadeOf("2026-11-03"), TODAY, rows, [], PEOPLE, true);
    expect(row.owner.advance).toBe(0);
    expect(row.partner.advance).toBe(yuan(100));
  });
});

describe("利润对照：进行中的月份只计到已出账/进行中的段", () => {
  it("11 月只计 1–20，销售利润 20000、实际利润 18000", () => {
    const rows = compareMonths(TODAY, SALES, EXPENSES, PEOPLE, false, 1);
    expect(rows[0].month).toBe("2026-11");
    expect(rows[0].partial).toBe(true);
    expect(rows[0].salesProfit).toBe(yuan(20000));
    expect(rows[0].profit).toBe(yuan(18000));
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

describe("示例账本种子", () => {
  it("对齐示意图：1–20 收入 30000、进货 10000、报销 2000、应得 6480 / 4320", async () => {
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
    expect(month.posted.revenue).toBe(3_000_000);
    expect(month.posted.cost).toBe(1_000_000);
    expect(month.posted.expense).toBe(200_000);
    expect(month.posted.profit).toBe(1_800_000);
    expect(month.decades[0].profit).toBe(720_000);
    expect(month.decades[1].profit).toBe(1_080_000);
    expect(month.decades[1].owner.amount).toBe(648_000);
    expect(month.decades[1].partner.amount).toBe(432_000);
    expect(month.pendingCount).toBe(2);
    const shares = upcomingDecades("2026-11-14").map((d) => month.decades[d.index] ?? settleMonth(d.month, "2026-11-14", sales, expenses, people, false).decades[d.index]);
    // 上面这样跨月不对；只测当前段
    expect(upcomingDecades("2026-11-14")[0].from).toBe("2026-11-11");
    const nov = sales.filter((s) => s.date.startsWith("2026-11") && !s.deletedAt);
    expect(nov.length).toBe(24);
  });
});
