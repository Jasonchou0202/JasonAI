import type {
  Customer,
  CustomerProduct,
  CustomerRankingResult,
  Sale,
} from "./model";
import { filterSales, totals } from "./finance";
import { validDate } from "./dates";

export async function customerId(
  name: string,
  hash: (text: string) => Promise<string>,
): Promise<string | null> {
  return name.trim() ? "c_" + (await hash(name)) : null;
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
  month: unknown,
): CustomerRankingResult {
  const rows = monthSales(sales, month);
  const names = new Map(customers.map((c) => [c.name, c.id]));
  const byId = new Map(customers.map((c) => [c.id, c]));
  const roots = customerRoots(customers);
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
      name: byId.get(id)!.name,
      aliases: aliases.get(id) || [],
      products: customerProducts(rows),
      totals: totals(rows),
    }))
    .sort(
      (a, b) =>
        b.totals.profit - a.totals.profit ||
        b.totals.count - a.totals.count ||
        a.name.localeCompare(b.name) ||
        a.customerId.localeCompare(b.customerId),
    );
  items.forEach((item, i) => {
    item.rank = i + 1;
  });
  return { items, unassigned: totals(unassigned), totals: totals(rows) };
}
