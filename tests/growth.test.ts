import { describe, expect, it } from "vitest";
import {
  lastMonthSamePeriod,
  samePeriodGrowth,
} from "../src/components/growth";

describe("比上月同期", () => {
  it("compares the 1st to the same day of last month", () => {
    expect(lastMonthSamePeriod("2026-10-14")).toEqual({
      from: "2026-09-01",
      to: "2026-09-14",
    });
  });
  it("clamps to the last day of a shorter previous month", () => {
    expect(lastMonthSamePeriod("2026-03-31")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(lastMonthSamePeriod("2028-03-30")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });
  it("crosses the year boundary in January", () => {
    expect(lastMonthSamePeriod("2027-01-05")).toEqual({
      from: "2026-12-01",
      to: "2026-12-05",
    });
  });
  it("hides the comparison when last month had no profit", () => {
    expect(samePeriodGrowth(5000, 0)).toBeNull();
    expect(samePeriodGrowth(5000, -100)).toBeNull();
    expect(samePeriodGrowth(15000, 10000)).toBe(50);
    expect(samePeriodGrowth(4000, 10000)).toBe(-60);
  });
});
