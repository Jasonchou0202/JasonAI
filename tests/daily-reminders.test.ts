import { expect, it } from "vitest";
import type { CustomerTask } from "../src/domain/model";
import { dailyPendingTasks } from "../src/domain/tasks";

const task = (
  id: string,
  at: string,
  change: Partial<CustomerTask> = {},
): CustomerTask => ({
  id,
  at,
  customerId: "customer",
  title: "待办",
  feedback: "",
  nextAction: "",
  reminder: "off",
  reminderGeneration: "test",
  reminderStartAt: at,
  completedAt: null,
  deletedAt: null,
  revision: 1,
  createdAt: at,
  updatedAt: at,
  ...change,
});
it("counts only Beijing today, including overdue today, sorted by time and id", () => {
  const rows = [
    task("tomorrow", "2026-10-14T16:00:00.000Z"),
    task("last-second", "2026-10-14T15:59:59.999Z"),
    task("first-second", "2026-10-13T16:00:00.000Z"),
    task("yesterday", "2026-10-13T15:59:59.999Z"),
    task("finished", "2026-10-14T04:00:00.000Z", {
      completedAt: "2026-10-14T05:00:00.000Z",
    }),
    task("deleted", "2026-10-14T04:00:00.000Z", {
      deletedAt: "2026-10-14T05:00:00.000Z",
    }),
    task("b", "2026-10-14T04:00:00.000Z"),
    task("a", "2026-10-14T04:00:00.000Z"),
  ];
  expect(dailyPendingTasks(rows, "2026-10-14").map((t) => t.id)).toEqual([
    "first-second",
    "a",
    "b",
    "last-second",
  ]);
  expect(rows[0].id).toBe("tomorrow");
});
it("handles Beijing year rollover and zero remaining items", () => {
  const rows = [
    task("new-year", "2026-12-31T16:00:00.000Z"),
    task("old-year", "2026-12-31T15:59:59.999Z"),
  ];
  expect(dailyPendingTasks(rows, "2027-01-01").map((t) => t.id)).toEqual([
    "new-year",
  ]);
  expect(dailyPendingTasks([], "2027-01-01")).toEqual([]);
});
