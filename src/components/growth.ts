// 「比上月同期」：本月 1 日到今天，对比上月 1 日到同一天（上月没有这一天时取上月最后一天）
export function lastMonthSamePeriod(date: string): {
  from: string;
  to: string;
} {
  const [y, m, d] = date.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const lastDay = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const from = prev.toISOString().slice(0, 10);
  const to = `${from.slice(0, 8)}${String(Math.min(d, lastDay)).padStart(2, "0")}`;
  return { from, to };
}
export function samePeriodGrowth(
  current: number,
  previous: number,
): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
