import { describe, expect, it } from "vitest";
import { PROFIT_TARGET, addMonth, monthDiff, targetSeries } from "../src/domain/profitTarget";

describe("利润目标走势", () => {
  it("默认线性，终点 2027-12 为 ¥10 万", () => {
    expect(PROFIT_TARGET).toMatchObject({ endMonth: "2027-12", endProfit: 10_000_000, curve: "linear" });
    const t = targetSeries("2026-09", 1_000_000);
    expect(t.points).toHaveLength(16);
    expect(t.points.at(-1)).toEqual({ month: "2027-12", value: 10_000_000 });
    expect(t.step).toBe(600_000);
  });
  it("复合增长：每月同比例，起点 ≤0 时退回线性", () => {
    const t = targetSeries("2026-09", 1_000_000, "compound");
    expect(t.curve).toBe("compound");
    expect(t.points.at(-1)!.value).toBe(10_000_000);
    expect(t.rate).toBeCloseTo(Math.pow(10, 1 / 15) - 1, 10);
    expect(targetSeries("2026-09", 0, "compound").curve).toBe("linear");
  });
  it("月份运算", () => {
    expect(addMonth("2026-11", 2)).toBe("2027-01");
    expect(monthDiff("2026-09", "2027-12")).toBe(15);
  });
});
