import { describe, it, expect } from "vitest";
import { beijingDay, beijingInput, beijingToUTC, calendarDays, customerRoot, taskStatus, taskTone } from "../src/lib/customer-ui";
import type { CustomerTask } from "../src/domain/model";

const task = (at: string, completedAt: string | null = null) => ({ at, completedAt } as CustomerTask);
describe("customer calendar wall time and status", () => {
  it("round trips Beijing wall time across UTC midnight and the year boundary", () => {
    expect(beijingToUTC("2027-01-01T00:00")).toBe("2026-12-31T16:00:00.000Z");
    expect(beijingInput("2026-12-31T16:00:00.000Z")).toBe("2027-01-01T00:00");
    expect(beijingDay("2026-10-13T15:59:59.000Z")).toBe("2026-10-13");
    expect(beijingDay("2026-10-13T16:00:00.000Z")).toBe("2026-10-14");
    expect(() => beijingToUTC("2026-02-30T10:00")).toThrow();
  });
  it("shows completed green before overdue, upcoming today/tomorrow orange and other pending red", () => {
    const now = Date.parse("2026-10-13T04:00:00.000Z");
    expect(taskTone(task("2026-10-12T00:00:00Z", "2026-10-13T00:00:00Z"), now)).toBe("complete");
    expect(taskTone(task("2026-10-13T03:59:00Z"), now)).toBe("pending");
    expect(taskTone(task("2026-10-13T05:00:00Z"), now)).toBe("urgent");
    expect(taskTone(task("2026-10-14T05:00:00Z"), now)).toBe("urgent");
    expect(taskTone(task("2026-10-15T05:00:00Z"), now)).toBe("pending");
    expect(taskStatus(task("2026-10-13T03:59:00Z"), now)).toContain("逾期");
  });
  it("builds six Monday-first weeks across adjacent months", () => {
    const days = calendarDays("2026-10");
    expect(days).toHaveLength(42);
    expect(days[0]).toBe("2026-09-28");
    expect(days[41]).toBe("2026-11-08");
    expect(new Set(days).size).toBe(42);
  });
  it("resolves chained customer aliases without changing their original ids", () => {
    const customers = [{id:"a",name:"原名",mergedInto:"b",revision:1},{id:"b",name:"别名",mergedInto:"c",revision:1},{id:"c",name:"主名",mergedInto:null,revision:1}];
    expect(customerRoot(customers, "a")).toBe("c");
    expect(customers[0].id).toBe("a");
  });
});
