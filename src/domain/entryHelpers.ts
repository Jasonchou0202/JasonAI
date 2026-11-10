// 记一笔用到的纯函数（只在前端使用，不进云函数包）
import type { Product, Sale } from "./model";

/** n 个月后的同一天；目标月没有这一天时取该月最后一天（例：01-31 + 1 个月 = 02-28/29） */
export function addMonthsClamp(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const index = y * 12 + (m - 1) + n;
  const ty = Math.floor(index / 12),
    tm = (index % 12) + 1;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${ty}-${String(tm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** 午休不排日程：北京时间 12:30（含）到 14:00（不含） */
export function inLunchBreak(wall: string): boolean {
  const hm = wall.slice(-5);
  return hm >= "12:30" && hm < "14:00";
}

/** 记一笔新增客户日程的默认时间：下个月同一天上午 10:00（北京时间，datetime-local 格式） */
export function defaultFollowUp(saleDate: string): string {
  return `${addMonthsClamp(saleDate, 1)}T10:00`;
}

/**
 * 快捷商品：近 3 个月（含今天，按成交日期）各商品利润合计从高到低取前 n 个。
 * 只算有效销售；停用/删除的商品跳过；同名或同 id 的记录归到同一个商品。
 */
export function topProfitProducts(
  sales: readonly Sale[],
  products: readonly Product[],
  today: string,
  n = 5,
  months = 3,
): Product[] {
  const from = addMonthsClamp(today, -months);
  const usable = products.filter((p) => p.active && !p.archivedAt);
  const byId = new Map(usable.map((p) => [p.id, p]));
  const byName = new Map(usable.map((p) => [p.name, p]));
  const profit = new Map<string, number>();
  for (const s of sales) {
    if (s.deletedAt || s.date < from || s.date > today) continue;
    const p = byId.get(s.productId) ?? byName.get(s.productName);
    if (!p) continue;
    profit.set(p.id, (profit.get(p.id) ?? 0) + s.revenue - s.cost);
  }
  return usable
    .filter((p) => profit.has(p.id))
    .map((p, i) => ({ p, i, v: profit.get(p.id)! }))
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .slice(0, n)
    .map((x) => x.p);
}
