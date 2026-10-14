import type {
  Customer,
  CustomerProduct,
  CustomerRankingResult,
  CustomerSuggestionGroup,
  CustomerSuggestionMember,
  CustomerTask,
  RankPeriod,
  Sale,
  Totals,
} from "./model";
import { filterSales, totals } from "./finance";
import { validDate } from "./dates";

export async function customerId(
  name: string,
  hash: (text: string) => Promise<string>,
): Promise<string | null> {
  return name.trim() ? "c_" + (await hash(name)) : null;
}

/** Trailing IPv4 markers (with one optional leading space) are noise, never identity. */
const TRAILING_IP = /\s*((?:\d{1,3}\.){3}\d{1,3})$/;

/** Clean display form: strip leading ✅ marks and a trailing IPv4 marker. */
export function displayCustomerName(name: string): string {
  const trimmed = name.trim();
  const withoutCheck = trimmed.replace(/✅/g, "").trim();
  const match = TRAILING_IP.exec(withoutCheck);
  const withoutIP =
    match && match[1].split(".").every((n) => Number(n) <= 255)
      ? withoutCheck.slice(0, match.index).trim()
      : withoutCheck;
  return withoutIP || withoutCheck || trimmed;
}

/** Identity key: names that only differ by ✅ or a trailing IP belong to one customer. */
export function customerKey(name: string): string {
  return displayCustomerName(name);
}

/** Parse and validate a ranking period. Accepts the legacy month string. */
export function parseRankPeriod(input: unknown): RankPeriod {
  if (typeof input === "string") {
    if (input === "all") return { type: "all" };
    if (/^\d{4}-\d{2}$/.test(input) && validDate(input + "-01"))
      return { type: "month", value: input };
    throw new Error("月份无效，请使用YYYY-MM");
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("周期无效");
  const p = input as Record<string, unknown>;
  const value = typeof p.value === "string" ? p.value : "";
  switch (p.type) {
    case "all":
      return { type: "all" };
    case "month":
      if (/^\d{4}-\d{2}$/.test(value) && validDate(value + "-01"))
        return { type: "month", value };
      break;
    case "quarter":
      if (/^(19|20|21)\d{2}-Q[1-4]$/.test(value))
        return { type: "quarter", value };
      break;
    case "half":
      if (/^(19|20|21)\d{2}-H[12]$/.test(value)) return { type: "half", value };
      break;
    case "year":
      if (/^(19|20|21)\d{2}$/.test(value)) return { type: "year", value };
      break;
  }
  throw new Error("周期无效");
}

/** Shift one unit of the current type, wrapping across year boundaries. */
export function shiftRankPeriod(period: RankPeriod, delta: number): RankPeriod {
  if (period.type === "all") return period;
  if (period.type === "month") {
    const date = new Date(`${period.value}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + delta);
    return { type: "month", value: date.toISOString().slice(0, 7) };
  }
  if (period.type === "quarter") {
    const year = Number(period.value!.slice(0, 4)),
      q = Number(period.value!.slice(6));
    const total = year * 4 + (q - 1) + delta;
    return {
      type: "quarter",
      value: `${Math.floor(total / 4)}-Q${(total % 4) + 1}`,
    };
  }
  if (period.type === "half") {
    const year = Number(period.value!.slice(0, 4)),
      h = Number(period.value!.slice(6));
    const total = year * 2 + (h - 1) + delta;
    return {
      type: "half",
      value: `${Math.floor(total / 2)}-H${(total % 2) + 1}`,
    };
  }
  return { type: "year", value: String(Number(period.value) + delta) };
}

export function rankPeriodLabel(period: RankPeriod): string {
  if (period.type === "all") return "全部时间（累计）";
  if (period.type === "month")
    return `${period.value!.slice(0, 4)}年${Number(period.value!.slice(5))}月`;
  if (period.type === "quarter")
    return `${period.value!.slice(0, 4)}年${period.value!.slice(5)}（${
      ["1-3", "4-6", "7-9", "10-12"][Number(period.value!.slice(6)) - 1]
    }月）`;
  if (period.type === "half")
    return `${period.value!.slice(0, 4)}年${
      period.value!.endsWith("H1") ? "上" : "下"
    }半年（${period.value!.endsWith("H1") ? "1-6" : "7-12"}月）`;
  return `${period.value}年`;
}

/** Months belonging to the period, or null for all time. */
export function rankPeriodMonths(period: RankPeriod): string[] | null {
  if (period.type === "all") return null;
  if (period.type === "month") return [period.value!];
  const year = Number(period.value!.slice(0, 4));
  const month = (m: number) => `${year}-${String(m).padStart(2, "0")}`;
  if (period.type === "quarter") {
    const first = (Number(period.value!.slice(6)) - 1) * 3 + 1;
    return [month(first), month(first + 1), month(first + 2)];
  }
  if (period.type === "half")
    return period.value!.endsWith("H1")
      ? [1, 2, 3, 4, 5, 6].map(month)
      : [7, 8, 9, 10, 11, 12].map(month);
  return Array.from({ length: 12 }, (_, i) => month(i + 1));
}

/** Visible sales inside the ranking period. */
export function periodSales(sales: Sale[], period: RankPeriod): Sale[] {
  if (period.type === "all") return filterSales(sales);
  const months = new Set(rankPeriodMonths(period)!);
  return filterSales(sales).filter((s) => months.has(s.date.slice(0, 7)));
}

/** Redirects never rewrite sale names or task customer IDs. */
export function resolveCustomerId(
  customers: readonly Customer[],
  id: string,
): string {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const visited = new Set<string>();
  for (;;) {
    if (visited.has(id)) throw new Error("客户合并形成循环");
    visited.add(id);
    const customer = byId.get(id);
    if (!customer) throw new Error("客户不存在");
    if (!customer.mergedInto) return id;
    id = customer.mergedInto;
  }
}

/** Resolve a complete snapshot in linear time, without changing persisted redirects. */
export function customerRoots(
  customers: readonly Customer[],
): Map<string, string> {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const roots = new Map<string, string>();
  for (const customer of customers) {
    let id = customer.id;
    const path = new Set<string>();
    while (!roots.has(id)) {
      if (path.has(id)) throw new Error("客户合并形成循环");
      path.add(id);
      const c = byId.get(id);
      if (!c) throw new Error("客户不存在");
      if (!c.mergedInto) {
        roots.set(id, id);
        break;
      }
      id = c.mergedInto;
    }
    const root = roots.get(id)!;
    for (const alias of path) roots.set(alias, root);
  }
  return roots;
}

export function customerAliases(
  customers: readonly Customer[],
  id: string,
): Customer[] {
  const roots = customerRoots(customers),
    root = roots.get(id);
  if (!root) throw new Error("客户不存在");
  return customers
    .filter((c) => c.id !== root && roots.get(c.id) === root)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function monthSales(sales: Sale[], month: unknown): Sale[] {
  if (month === "all") return filterSales(sales);
  if (
    typeof month !== "string" ||
    !/^\d{4}-\d{2}$/.test(month) ||
    !validDate(month + "-01")
  )
    throw new Error("月份无效，请使用YYYY-MM");
  return filterSales(sales).filter((s) => s.date.slice(0, 7) === month);
}

export function customerProducts(sales: Sale[]): CustomerProduct[] {
  const products = new Map<string, CustomerProduct>();
  for (const sale of sales) {
    const item = products.get(sale.productName) || {
      name: sale.productName,
      profit: 0,
      count: 0,
    };
    item.profit += sale.revenue - sale.cost;
    item.count++;
    products.set(item.name, item);
  }
  return [...products.values()].sort(
    (a, b) =>
      b.profit - a.profit || b.count - a.count || a.name.localeCompare(b.name),
  );
}

export function customerRanking(
  customers: Customer[],
  sales: Sale[],
  period: unknown,
  tasks: CustomerTask[] = [],
): CustomerRankingResult {
  const rows = periodSales(sales, parseRankPeriod(period));
  const names = new Map(customers.map((c) => [c.name, c.id]));
  const byId = new Map(customers.map((c) => [c.id, c]));
  const roots = customerRoots(customers);
  const pending = new Map<string, number>();
  for (const task of tasks) {
    const root = roots.get(task.customerId);
    if (root && !task.deletedAt && !task.completedAt)
      pending.set(root, (pending.get(root) ?? 0) + 1);
  }
  const aliases = new Map<string, string[]>();
  for (const c of customers) {
    const root = roots.get(c.id)!;
    if (root === c.id) continue;
    const list = aliases.get(root) || [];
    list.push(c.name);
    aliases.set(root, list);
  }
  for (const names of aliases.values())
    names.sort((a, b) => a.localeCompare(b));
  const groups = new Map<string, Sale[]>();
  const unassigned: Sale[] = [];
  for (const row of rows) {
    if (!row.customer.trim()) {
      unassigned.push(row);
      continue;
    }
    const id = names.get(row.customer);
    if (!id) throw new Error("客户档案尚未初始化");
    const root = roots.get(id)!;
    const group = groups.get(root) || [];
    group.push(row);
    groups.set(root, group);
  }
  const items = [...groups]
    .map(([id, rows]) => ({
      rank: 0,
      customerId: id,
      pendingTaskCount: pending.get(id) ?? 0,
      name: byId.get(id)!.name,
      aliases: aliases.get(id) || [],
      products: customerProducts(rows),
      totals: totals(rows),
    }))
    .sort(
      (a, b) =>
        b.totals.profit - a.totals.profit ||
        b.totals.count - a.totals.count ||
        displayCustomerName(a.name).localeCompare(
          displayCustomerName(b.name),
        ) ||
        a.customerId.localeCompare(b.customerId),
    );
  items.forEach((item, i) => {
    item.rank = i + 1;
  });
  return { items, unassigned: totals(unassigned), totals: totals(rows) };
}

/** Suspected same-customer groups: ✅/IP variants first, then case-only variants. */
export function customerSuggestions(
  customers: Customer[],
  sales: Sale[],
  tasks: CustomerTask[],
): CustomerSuggestionGroup[] {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const byName = new Map(customers.map((c) => [c.name, c.id]));
  const roots = customerRoots(customers);
  const active = customers.filter((c) => !c.mergedInto);
  const rootTotals = new Map<string, Totals>();
  for (const row of filterSales(sales)) {
    if (!row.customer.trim()) continue;
    const id = byName.get(row.customer);
    if (!id) continue;
    const root = roots.get(id)!;
    const t = rootTotals.get(root) || {
      revenue: 0,
      cost: 0,
      profit: 0,
      count: 0,
    };
    t.revenue += row.revenue;
    t.cost += row.cost;
    t.profit += row.revenue - row.cost;
    t.count++;
    rootTotals.set(root, t);
  }
  const rootTasks = new Map<string, number>();
  for (const task of tasks) {
    const c = byId.get(task.customerId);
    if (!c) continue;
    const root = roots.get(c.id)!;
    rootTasks.set(root, (rootTasks.get(root) || 0) + 1);
  }
  const member = (id: string): CustomerSuggestionMember => ({
    customer: byId.get(id)!,
    totals: rootTotals.get(id) || {
      revenue: 0,
      cost: 0,
      profit: 0,
      count: 0,
    },
    taskCount: rootTasks.get(id) || 0,
  });
  const cleanRank = (name: string) =>
    name === displayCustomerName(name) ? 0 : 1;
  const pickTarget = (members: CustomerSuggestionMember[]) =>
    [...members].sort(
      (a, b) =>
        b.totals.count - a.totals.count ||
        cleanRank(a.customer.name) - cleanRank(b.customer.name) ||
        a.customer.createdAt.localeCompare(b.customer.createdAt) ||
        a.customer.id.localeCompare(b.customer.id),
    )[0].customer.id;
  const makeGroup = (
    reason: "ip_or_symbol" | "case",
    ids: string[],
  ): CustomerSuggestionGroup => {
    const members = ids.map(member);
    const targetId = pickTarget(members);
    const ordered = members.sort(
      (a, b) =>
        (a.customer.id === targetId ? 0 : 1) -
          (b.customer.id === targetId ? 0 : 1) ||
        a.customer.name.localeCompare(b.customer.name),
    );
    const combined: Totals = ordered.reduce(
      (t, m) => ({
        revenue: t.revenue + m.totals.revenue,
        cost: t.cost + m.totals.cost,
        profit: t.profit + m.totals.profit,
        count: t.count + m.totals.count,
      }),
      { revenue: 0, cost: 0, profit: 0, count: 0 },
    );
    return {
      id: `${reason}:${targetId}`,
      reason,
      targetId,
      members: ordered,
      totals: combined,
      taskCount: ordered.reduce((n, m) => n + m.taskCount, 0),
    };
  };
  const groups: CustomerSuggestionGroup[] = [];
  const keyGroups = new Map<string, string[]>();
  for (const c of active) {
    const list = keyGroups.get(customerKey(c.name)) || [];
    list.push(c.id);
    keyGroups.set(customerKey(c.name), list);
  }
  const covered = new Set<string>();
  for (const [key, ids] of keyGroups) {
    if (!key || ids.length < 2) continue;
    ids.forEach((id) => covered.add(id));
    groups.push(makeGroup("ip_or_symbol", ids));
  }
  const caseGroups = new Map<string, string[]>();
  for (const c of active) {
    if (covered.has(c.id)) continue;
    const lower = customerKey(c.name).toLocaleLowerCase();
    const list = caseGroups.get(lower) || [];
    list.push(c.id);
    caseGroups.set(lower, list);
  }
  for (const [lower, ids] of caseGroups) {
    if (!lower || ids.length < 2) continue;
    groups.push(makeGroup("case", ids));
  }
  return groups.sort((a, b) => a.id.localeCompare(b.id));
}
