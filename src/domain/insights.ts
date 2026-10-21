import type { Customer, Sale, Totals } from "./model";
import { customerKey, customerRoots } from "./customers";
import { emptyTotals } from "./finance";

/** 客户等级：按客户（合并后）全部有效销售的纯利合计划分，金额单位为分 */
export type Tier = "P0" | "P1" | "P2" | "P3" | "P4";
export const TIERS: Tier[] = ["P0", "P1", "P2", "P3", "P4"];
export const TIER_RULES: { tier: Tier; label: string; min: number }[] = [
  { tier: "P0", label: "纯利 ≥ ¥10,000", min: 10_000_00 },
  { tier: "P1", label: "¥5,000 ≤ 纯利 < ¥10,000", min: 5_000_00 },
  { tier: "P2", label: "¥1,000 ≤ 纯利 < ¥5,000", min: 1_000_00 },
  { tier: "P3", label: "¥500 ≤ 纯利 < ¥1,000", min: 500_00 },
  { tier: "P4", label: "纯利 < ¥500", min: -Infinity },
];
export function tierOf(profitCents: number): Tier {
  return TIER_RULES.find((r) => profitCents >= r.min)!.tier;
}

/** 四象限：客户新/老 × 产品新/老 */
export type Quadrant = "newOld" | "newNew" | "oldOld" | "oldNew";
export const QUADRANTS: Quadrant[] = ["newOld", "newNew", "oldOld", "oldNew"];
export const QUADRANT_INFO: Record<
  Quadrant,
  { label: string; short: string; color: string }
> = {
  newOld: { label: "新客户 × 老产品", short: "新客老品", color: "#12938A" },
  newNew: { label: "新客户 × 新产品", short: "新客新品", color: "#745BC4" },
  oldOld: { label: "老客户 × 老产品", short: "老客老品", color: "#357CC6" },
  oldNew: { label: "老客户 × 新产品", short: "老客新品", color: "#E89A3E" },
};
/** 新老分界日（北京时间）：此日前已有的客户/商品为老，此日及之后新增为新 */
export const NEW_CUTOFF = "2026-10-21";
export const NEW_RULE_TEXT = `${NEW_CUTOFF} 前已有的客户/商品为老，之后新增为新`;

/** 把销售的客户名映射到合并后的根客户；找不到档案时用名称身份键兜底 */
export function rootResolver(customers: readonly Customer[]) {
  const roots = customerRoots(customers);
  const byName = new Map(customers.map((c) => [c.name, roots.get(c.id)!]));
  return (name: string): string | null => {
    if (!name.trim()) return null;
    return byName.get(name) ?? "name:" + customerKey(name);
  };
}

export interface Insights {
  quadrantOf: Map<string, Quadrant>;
  customerProfit: Map<string, number>;
  customerQuadrants: Map<string, Set<Quadrant>>;
  rootOf: (name: string) => string | null;
}

/**
 * 规则（按 NEW_CUTOFF 分界）：
 * - 客户：合并后的根客户第一次成交日 < 分界日为老客户，否则为新客户。未填客户按新客户算。
 * - 商品：该商品名在整个账本第一次售出日 < 分界日为老产品，否则为新产品
 *   （商品档案没有创建时间，用首次售出日代替；分界日前就有的商品都算老）。
 */
export function buildInsights(
  sales: readonly Sale[],
  customers: readonly Customer[],
  cutoff = NEW_CUTOFF,
): Insights {
  const active = sales.filter((s) => !s.deletedAt);
  const rootOf = rootResolver(customers);
  const firstCustomer = new Map<string, string>();
  const firstProduct = new Map<string, string>();
  for (const s of active) {
    const root = rootOf(s.customer);
    if (root && !(firstCustomer.get(root)! <= s.date))
      firstCustomer.set(root, s.date);
    if (!(firstProduct.get(s.productName)! <= s.date))
      firstProduct.set(s.productName, s.date);
  }
  const quadrantOf = new Map<string, Quadrant>();
  const customerProfit = new Map<string, number>();
  const customerQuadrants = new Map<string, Set<Quadrant>>();
  for (const s of active) {
    const root = rootOf(s.customer);
    const newCustomer = !root || firstCustomer.get(root)! >= cutoff;
    const newProduct = firstProduct.get(s.productName)! >= cutoff;
    const q: Quadrant = newCustomer
      ? newProduct
        ? "newNew"
        : "newOld"
      : newProduct
        ? "oldNew"
        : "oldOld";
    quadrantOf.set(s.id, q);
    if (root) {
      customerProfit.set(
        root,
        (customerProfit.get(root) ?? 0) + s.revenue - s.cost,
      );
      const set = customerQuadrants.get(root) ?? new Set<Quadrant>();
      set.add(q);
      customerQuadrants.set(root, set);
    }
  }
  return { quadrantOf, customerProfit, customerQuadrants, rootOf };
}

export function quadrantTotals(
  sales: readonly Sale[],
  quadrantOf: Map<string, Quadrant>,
): Record<Quadrant, Totals> {
  const out = Object.fromEntries(
    QUADRANTS.map((q) => [q, emptyTotals()]),
  ) as Record<Quadrant, Totals>;
  for (const s of sales) {
    const q = quadrantOf.get(s.id);
    if (!q) continue;
    const t = out[q];
    t.revenue += s.revenue;
    t.cost += s.cost;
    t.profit += s.revenue - s.cost;
    t.count++;
  }
  return out;
}

export function tierCounts(customerProfit: Map<string, number>) {
  const counts = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<
    Tier,
    number
  >;
  for (const p of customerProfit.values()) counts[tierOf(p)]++;
  return counts;
}

function monthRange(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split("-").map(Number);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key >= last) return out;
    if (++m > 12) { m = 1; y++; }
  }
}

/** 每月新进客户数：按合并后客户的首次购买月份计数（与四象限分界日无关），空月份补 0 */
export function monthlyNewCustomers(
  sales: readonly Sale[],
  customers: readonly Customer[],
): { month: string; count: number }[] {
  const rootOf = rootResolver(customers);
  const first = new Map<string, string>();
  let lo = "", hi = "";
  for (const s of sales) {
    if (s.deletedAt) continue;
    const m = s.date.slice(0, 7);
    if (!lo || m < lo) lo = m;
    if (!hi || m > hi) hi = m;
    const root = rootOf(s.customer);
    if (root && !(first.get(root)! <= m)) first.set(root, m);
  }
  if (!lo) return [];
  const counts = new Map<string, number>();
  for (const m of first.values()) counts.set(m, (counts.get(m) ?? 0) + 1);
  return monthRange(lo, hi).map((month) => ({ month, count: counts.get(month) ?? 0 }));
}

export interface MonthQuadrantRow {
  month: string;
  /** 当月有成交的客户数（去重，未填客户不计） */
  active: number;
  counts: Record<Quadrant, number>;
}
/**
 * 每月四色块客户数：某客户当月在某象限有 ≥1 笔成交就计 1。
 * 占比 = 该象限客户数 ÷ 当月成交客户数；一位客户可同时落在两个象限，所以四个占比相加可能超过 100%。
 */
export function monthlyQuadrantCustomers(
  sales: readonly Sale[],
  insights: Insights,
): MonthQuadrantRow[] {
  const by = new Map<string, { all: Set<string>; q: Record<Quadrant, Set<string>> }>();
  for (const s of sales) {
    if (s.deletedAt) continue;
    const root = insights.rootOf(s.customer), q = insights.quadrantOf.get(s.id);
    if (!root || !q) continue;
    const m = s.date.slice(0, 7);
    let row = by.get(m);
    if (!row) {
      row = { all: new Set(), q: Object.fromEntries(QUADRANTS.map((k) => [k, new Set<string>()])) as Record<Quadrant, Set<string>> };
      by.set(m, row);
    }
    row.all.add(root);
    row.q[q].add(root);
  }
  const months = [...by.keys()].sort();
  if (!months.length) return [];
  return monthRange(months[0], months.at(-1)!).map((month) => {
    const row = by.get(month);
    return {
      month,
      active: row?.all.size ?? 0,
      counts: Object.fromEntries(QUADRANTS.map((k) => [k, row?.q[k].size ?? 0])) as Record<Quadrant, number>,
    };
  });
}
export const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
