import { describe, it, expect } from "vitest";
import {
  defaultSalesView,
  inSalesView,
  salesViewFallbackHint,
} from "../src/lib/customer-ui";

const d = (date: string) => ({ date });
describe("customer detail sales range", () => {
  it("near 3 months covers this month and the two before, never future months", () => {
    const now = "2026-10";
    expect(inSalesView("recent", "2026-08-01", now, now)).toBe(true);
    expect(inSalesView("recent", "2026-10-31", now, now)).toBe(true);
    expect(inSalesView("recent", "2026-07-31", now, now)).toBe(false);
    expect(inSalesView("recent", "2026-11-01", now, now)).toBe(false);
    expect(inSalesView("recent", "2027-01-05", now, now)).toBe(false);
    expect(inSalesView("recent", "2026-01-15", "2026-01", "2026-01")).toBe(true);
    expect(inSalesView("recent", "2025-11-15", "2026-01", "2026-01")).toBe(true);
    expect(inSalesView("recent", "2025-10-31", "2026-01", "2026-01")).toBe(false);
  });
  it("month view uses the chosen month and all view keeps everything", () => {
    expect(inSalesView("month", "2026-02-03", "2026-02", "2026-10")).toBe(true);
    expect(inSalesView("month", "2026-10-03", "2026-02", "2026-10")).toBe(false);
    expect(inSalesView("all", "1999-01-01", "2026-02", "2026-10")).toBe(true);
  });
  it("defaults to this month, then near 3 months, then all, with a hint for fallbacks", () => {
    expect(defaultSalesView([d("2026-10-02"), d("2026-01-01")], "2026-10")).toBe("month");
    expect(defaultSalesView([d("2026-09-02"), d("2026-01-01")], "2026-10")).toBe("recent");
    expect(defaultSalesView([d("2026-12-02"), d("2026-01-01")], "2026-10")).toBe("all");
    expect(defaultSalesView([], "2026-10")).toBe("all");
    expect(salesViewFallbackHint("month")).toBe("");
    expect(salesViewFallbackHint("recent")).toBe("本月暂无成交，已为你显示近 3 个月");
    expect(salesViewFallbackHint("all")).toBe("本月和近 3 个月暂无成交，已为你显示全部");
  });
});
