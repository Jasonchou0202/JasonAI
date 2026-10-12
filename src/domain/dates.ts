import type { Period } from "./model";
export function today(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(d.getTime()) &&
    d.toISOString().slice(0, 10) === value &&
    value >= "1900-01-01" &&
    value <= "2199-12-31"
  );
}
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function periodRange(
  date: string,
  period: Period,
): { from: string; to: string } {
  if (period === "day") return { from: date, to: date };
  if (period === "week") {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    const from = addDays(date, -((day + 6) % 7));
    return { from, to: addDays(from, 6) };
  }
  const from = `${date.slice(0, 7)}-01`;
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return { from, to: addDays(d.toISOString().slice(0, 10), -1) };
}
export function shiftPeriod(date: string, period: Period, n: number): string {
  if (period !== "month") return addDays(date, n * (period === "week" ? 7 : 1));
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
export function dateLabel(date: string): string {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
}
