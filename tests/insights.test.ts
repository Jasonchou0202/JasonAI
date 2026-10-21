import { describe, expect, it } from "vitest";
import { buildInsights, quadrantTotals, tierCounts, tierOf, NEW_CUTOFF } from "../src/domain/insights";
import { insertAction, parseActions, PRESET_ACTIONS } from "../src/domain/actions";
import type { Customer, Sale } from "../src/domain/model";

const sale = (id: string, customer: string, productName: string, date: string, profit = 100, deletedAt: string | null = null): Sale => ({
  id, customer, productName, productId: "p", date, revenue: profit + 50, cost: 50, note: "",
  createdAt: "", updatedAt: "", deletedAt, revision: 1,
});
const cust = (id: string, name: string, mergedInto: string | null = null): Customer => ({
  id, name, mergedInto, revision: 1, createdAt: "", updatedAt: "",
});

describe("客户等级边界", () => {
  it.each([
    [10_000_00, "P0"], [10_000_00 - 1, "P1"], [5_000_00, "P1"], [5_000_00 - 1, "P2"],
    [1_000_00, "P2"], [1_000_00 - 1, "P3"], [500_00, "P3"], [500_00 - 1, "P4"], [0, "P4"], [-100, "P4"],
  ])("%i 分 → %s", (v, t) => expect(tierOf(v)).toBe(t));
});

describe("四象限分类", () => {
  const customers = [cust("a", "老王"), cust("b", "✅老王", "a"), cust("c", "小新")];
  const sales = [
    sale("1", "老王", "旧品", "2026-09-01"),
    sale("2", "✅老王", "旧品", "2026-10-21"),
    sale("3", "老王", "新品", "2026-10-22"),
    sale("4", "小新", "旧品", "2026-10-21"),
    sale("5", "小新", "新品", "2026-10-23"),
    sale("6", "小新", "新品", "2026-10-20", 1, "x"),
  ];
  const ins = buildInsights(sales, customers);
  it("分界日前已有的为老，之后新增为新（合并后计、忽略已删除）", () => {
    expect(NEW_CUTOFF).toBe("2026-10-21");
    expect(Object.fromEntries(ins.quadrantOf)).toEqual({
      "1": "oldOld", "2": "oldOld", "3": "oldNew", "4": "newOld", "5": "newNew",
    });
    expect([...ins.customerQuadrants.get("a")!].sort()).toEqual(["oldNew", "oldOld"]);
    expect(ins.customerProfit.get("a")).toBe(300);
  });
  it("汇总与等级分布", () => {
    const t = quadrantTotals(sales.slice(0, 5), ins.quadrantOf);
    expect(t.oldOld.count).toBe(2);
    expect(t.newNew.profit).toBe(100);
    expect(tierCounts(ins.customerProfit).P4).toBe(2);
  });
});

describe("有效动作库", () => {
  it("预设齐全、坏数据回落、插入换行", () => {
    expect(PRESET_ACTIONS).toHaveLength(10);
    expect(parseActions(null)).toHaveLength(10);
    expect(parseActions([{ id: "x", quadrant: "bad", text: "a" }])).toEqual([]);
    expect(insertAction("跟进", "老客老品", PRESET_ACTIONS[0])).toBe("跟进\n【老客老品】核心客户维护好，持续赋能，增加粘度");
  });
});

import { monthlyNewCustomers, monthlyQuadrantCustomers, pct } from "../src/domain/insights";
describe("每月图表", () => {
  const customers = [cust("a", "老王"), cust("b", "✅老王", "a"), cust("c", "小新"), cust("d", "阿三")];
  const sales = [
    sale("1", "老王", "旧品", "2026-08-05"),
    sale("2", "阿三", "旧品", "2026-08-20"),
    sale("3", "✅老王", "旧品", "2026-10-02"),
    sale("4", "老王", "新品", "2026-10-22"),
    sale("5", "小新", "旧品", "2026-10-21"),
    sale("6", "", "旧品", "2026-10-21"),
  ];
  it("每月新进客户按首次购买月份、合并后计、空月补 0", () => {
    expect(monthlyNewCustomers(sales, customers)).toEqual([
      { month: "2026-08", count: 2 }, { month: "2026-09", count: 0 }, { month: "2026-10", count: 1 },
    ]);
  });
  it("每月四色块客户数去重，一人可跨两象限", () => {
    const rows = monthlyQuadrantCustomers(sales, buildInsights(sales, customers));
    const oct = rows.find((r) => r.month === "2026-10")!;
    expect(rows.map((r) => r.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(oct.active).toBe(2);
    expect(oct.counts).toEqual({ oldOld: 1, oldNew: 1, newOld: 1, newNew: 0 });
    expect(pct(oct.counts.oldOld, oct.active)).toBe(50);
    expect(pct(1, 0)).toBe(0);
  });
});

import { rangeStart } from "../src/components/QuadrantMatrix";
describe("矩阵周期", () => {
  it("本月 / 本季度 / 本年按自然周期起算", () => {
    expect(rangeStart("2026-10-22", "month")).toBe("2026-10-01");
    expect(rangeStart("2026-10-22", "quarter")).toBe("2026-10-01");
    expect(rangeStart("2026-08-31", "quarter")).toBe("2026-07-01");
    expect(rangeStart("2026-03-05", "year")).toBe("2026-01-01");
  });
});
