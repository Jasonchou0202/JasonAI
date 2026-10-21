import { describe, expect, it } from "vitest";
import { PROFIT_TARGET, addMonth, anchorMonth, fixedTarget, monthDiff, targetSeries } from "../src/domain/profitTarget";

const months = [
  { key: "2026-08-01", profit: 800_000 },
  { key: "2026-09-01", profit: 1_000_000 },
  { key: "2026-10-01", profit: 1_300_000 },
];

describe("利润目标走势", () => {
  it("线性，起点固定 2026-09，终点 2027-12 为 ¥10 万", () => {
    expect(PROFIT_TARGET).toMatchObject({ startMonth: "2026-09", endMonth: "2027-12", endProfit: 10_000_000 });
    const t = targetSeries("2026-09", 1_000_000);
    expect(t.points).toHaveLength(16);
    expect(t.points.at(-1)).toEqual({ month: "2027-12", value: 10_000_000 });
    expect(t.step).toBe(600_000);
  });
  it("模拟当前是 2026-11：目标线和 10 月时完全一样（起点不漂移）", () => {
    const inOct = fixedTarget(months);
    const inNov = fixedTarget([...months, { key: "2026-11-01", profit: 5_000_000 }]);
    expect(inNov).toEqual(inOct);
    expect(inNov.startMonth).toBe("2026-09");
    expect(inNov.points[0]).toEqual({ month: "2026-09", value: 1_000_000 });
    expect(inNov.points.find((p) => p.month === "2026-10")!.value).toBe(1_600_000);
  });
  it("过了 2027-12 后窗口停在最后一个月", () => {
    expect(anchorMonth("2026-11")).toBe("2026-11");
    expect(anchorMonth("2028-03")).toBe("2027-12");
  });
  it("月份运算", () => {
    expect(addMonth("2026-11", 2)).toBe("2027-01");
    expect(monthDiff("2026-09", "2027-12")).toBe(15);
  });
});
