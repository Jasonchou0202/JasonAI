import { describe, expect, it } from "vitest";
import {
  addDays,
  periodRange,
  shiftPeriod,
  today,
  validDate,
} from "../src/domain/dates";
import {
  buckets,
  dashboard,
  monthlyTotals,
  parseMoney,
  totals,
  validateSale,
} from "../src/domain/finance";
import type { Sale, SaleInput } from "../src/domain/model";
const input: SaleInput = {
  productId: "p",
  productName: "示例商品",
  customer: "示例客户",
  date: "2026-01-01",
  revenue: 1050,
  cost: 101,
  note: "",
};
const sale = (id: string, date: string, revenue = 1050, cost = 101): Sale => ({
  ...input,
  id,
  date,
  revenue,
  cost,
  revision: 1,
  deletedAt: null,
  createdAt: date + "T09:00:00Z",
  updatedAt: date + "T09:00:00Z",
});
describe("money and calendar rules", () => {
  it("keeps exact cents, zero revenue, losses and refunds", () => {
    expect(parseMoney("￥1,234.56")).toBe(123456);
    expect(parseMoney("-0.01")).toBe(-1);
    expect(parseMoney("-¥80.00")).toBe(-8000);
    expect(parseMoney("¥-0.01")).toBe(-1);
    expect(
      totals([
        { revenue: parseMoney("0.10"), cost: parseMoney("0.03") },
        { revenue: 0, cost: 120 },
        { revenue: -10, cost: 0 },
      ]),
    ).toEqual({ count: 3, revenue: 0, cost: 123, profit: -123 });
    for (const value of ["", "1.001", "NaN", "1e4", "99999999999999999"])
      expect(() => parseMoney(value)).toThrow();
  });
  it("uses Beijing midnight and validates real dates", () => {
    expect(today(new Date("2026-12-31T15:59:59Z"))).toBe("2026-12-31");
    expect(today(new Date("2026-12-31T16:00:00Z"))).toBe("2027-01-01");
    expect(validDate("2024-02-29")).toBe(true);
    expect(validDate("2026-02-29")).toBe(false);
    expect(validDate("2026-04-31")).toBe(false);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("defines Monday-Sunday weeks across years and calendar months", () => {
    expect(periodRange("2027-01-03", "week")).toEqual({
      from: "2026-12-28",
      to: "2027-01-03",
    });
    expect(periodRange("2027-01-04", "week")).toEqual({
      from: "2027-01-04",
      to: "2027-01-10",
    });
    expect(periodRange("2024-02-19", "month")).toEqual({
      from: "2024-02-01",
      to: "2024-02-29",
    });
    expect(shiftPeriod("2026-01-31", "month", -1)).toBe("2025-12-01");
  });
  it("includes empty days and excludes deleted sales from all profit views", () => {
    const rows = [
      sale("a", "2026-12-31"),
      sale("b", "2027-01-01", 0, 120),
      { ...sale("c", "2027-01-01", 99999), deletedAt: "2027-01-01T00:00:00Z" },
    ];
    const d = dashboard(rows, "2027-01-01");
    expect(d.today.profit).toBe(-120);
    expect(d.week.count).toBe(2);
    expect(d.month.count).toBe(1);
    expect(d.all.profit).toBe(829);
    expect(d.days).toHaveLength(7);
    expect(d.days.filter((b) => b.count === 0)).toHaveLength(5);
    expect(buckets(rows.slice(0, 2), "month", "2027-01-01", 12)).toHaveLength(
      12,
    );
    expect(monthlyTotals(rows.slice(0, 2)).map((b) => b.profit)).toEqual([
      949, -120,
    ]);
  });
  it("validates input types and preserves literal customer and product text", () => {
    const r = {
      ...input,
      productName: "商品 原名",
      customer: "✅客户·名字 1.2.3.4",
      extra: "ignored",
    };
    expect(validateSale(r).customer).toBe(r.customer);
    expect(validateSale(r)).not.toHaveProperty("extra");
    expect(() => validateSale({ ...input, revenue: 1.001 })).toThrow();
    expect(() => validateSale({ ...input, productName: "" })).toThrow();
  });
});
