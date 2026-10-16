import type { Customer, CustomerTask, CustomerTaskInput } from "./model";
import { customerRoots } from "./customers";
import { validDate, today } from "./dates";
/** Includes earlier overdue items today, but never yesterday or completed items. */
export function dailyPendingTasks(
  tasks: CustomerTask[],
  day: string,
): CustomerTask[] {
  return tasks
    .filter((task) => !task.deletedAt && !task.completedAt && today(new Date(task.at)) === day)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}
export function sortTasksTodayFirst(
  tasks: CustomerTask[],
  day: string,
): CustomerTask[] {
  const date = (task: CustomerTask) => today(new Date(task.at));
  const priority = (task: CustomerTask) =>
    date(task) === day ? 0 : date(task) > day ? 1 : 2;
  return [...tasks].sort(
    (a, b) =>
      priority(a) - priority(b) ||
      (priority(a) === 2 ? date(b).localeCompare(date(a)) : 0) ||
      a.at.localeCompare(b.at) ||
      a.id.localeCompare(b.id),
  );
}

export function validRecordId(value: unknown): value is string {
  return typeof value === "string" && /^[\w-]{1,128}$/.test(value);
}
export function utcInstant(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !==
      (value.includes(".") ? value : value.replace("Z", ".000Z"))
  )
    throw new Error("日程时间须为有效ISO UTC时间");
  return new Date(value).toISOString();
}

export function validateTaskInput(value: unknown): CustomerTaskInput {
  const t = value as CustomerTaskInput;
  if (!t || !validRecordId(t.customerId)) throw new Error("客户编号无效");
  for (const [key, max] of [
    ["title", 500],
    ["feedback", 4000],
    ["nextAction", 4000],
  ] as const)
    if (
      typeof t[key] !== "string" ||
      t[key].length > max ||
      (key === "title" && !t[key].trim())
    )
      throw new Error("日程标题、反馈或下一步无效");
  if (!["both", "due", "off"].includes(t.reminder))
    throw new Error("提醒选项无效");
  return {
    customerId: t.customerId,
    at: utcInstant(t.at),
    title: t.title,
    feedback: t.feedback,
    nextAction: t.nextAction,
    reminder: t.reminder,
  };
}

export function filterTasks(
  tasks: CustomerTask[],
  customers: Customer[],
  p: Record<string, unknown>,
): CustomerTask[] {
  if (p.deleted !== undefined && typeof p.deleted !== "boolean")
    throw new Error("删除筛选无效");
  const bound = (v: unknown, end: boolean): string | undefined => {
    if (v === undefined) return undefined;
    if (typeof v === "string" && validDate(v))
      return new Date(
        v + (end ? "T23:59:59.999+08:00" : "T00:00:00.000+08:00"),
      ).toISOString();
    return utcInstant(v);
  };
  const from = bound(p.from, false),
    to = bound(p.to, true);
  if (from && to && from > to) throw new Error("筛选日期无效");
  if (p.customerId !== undefined && !validRecordId(p.customerId))
    throw new Error("客户编号无效");
  const roots = customerRoots(customers);
  const root =
    p.customerId === undefined ? undefined : roots.get(p.customerId as string);
  if (p.customerId !== undefined && !root) throw new Error("客户不存在");
  return tasks
    .filter(
      (t) =>
        Boolean(t.deletedAt) === Boolean(p.deleted) &&
        (!from || t.at >= from) &&
        (!to || t.at <= to) &&
        (!root || roots.get(t.customerId) === root),
    )
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}
