import type {
  Sale,
  SaleInput,
  Totals,
  Filters,
  Dashboard,
  Bucket,
  Period,
  Product,
} from "./model";
import { addDays, periodRange, shiftPeriod, today, validDate } from "./dates";
import { productCategories } from "./catalog";
export const MAX_MONEY = 999_999_999_99;
export function parseMoney(value: unknown): number {
  const s = String(value ?? "")
    .trim()
    .replace(/^(-?)\s*[¥￥]\s*/, "$1")
    .replace(/,/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s))
    throw new Error("金额须为数字，最多两位小数");
  const neg = s.startsWith("-");
  const [a, b = ""] = s.replace("-", "").split(".");
  const n = Number(a) * 100 + Number(b.padEnd(2, "0"));
  if (!Number.isSafeInteger(n) || n > MAX_MONEY)
    throw new Error("金额超出支持范围");
  return neg ? -n : n;
}
export const money = (value: number) =>
  new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
export const moneyInput = (value: number) => (value / 100).toFixed(2);
export const emptyTotals = (): Totals => ({
  revenue: 0,
  cost: 0,
  profit: 0,
  count: 0,
});
export function totals(rows: Pick<SaleInput, "revenue" | "cost">[]): Totals {
  return rows.reduce<Totals>(
    (t, r) => ({
      revenue: t.revenue + r.revenue,
      cost: t.cost + r.cost,
      profit: t.profit + r.revenue - r.cost,
      count: t.count + 1,
    }),
    emptyTotals(),
  );
}
export function validateSale(raw: SaleInput): SaleInput {
  if (!raw || typeof raw !== "object") throw new Error("记录格式无效");
  if (
    typeof raw.productName !== "string" ||
    !raw.productName.trim() ||
    raw.productName.length > 200
  )
    throw new Error("请选择或填写商品，名称最多200字");
  if (!validDate(raw.date)) throw new Error("请选择有效日期");
  for (const v of [raw.revenue, raw.cost])
    if (!Number.isSafeInteger(v) || Math.abs(v) > MAX_MONEY)
      throw new Error("金额格式无效");
  if (
    typeof raw.customer !== "string" ||
    raw.customer.length > 500 ||
    typeof raw.note !== "string" ||
    raw.note.length > 2000
  )
    throw new Error("客户或备注过长");
  if (typeof raw.productId !== "string" || raw.productId.length > 200)
    throw new Error("商品编号无效");
  return {
    productId: raw.productId,
    productName: raw.productName,
    customer: raw.customer,
    date: raw.date,
    revenue: raw.revenue,
    cost: raw.cost,
    note: raw.note,
  };
}
export function validateProduct(p: Product): Product {
  if (p?.category !== undefined && !productCategories.includes(p.category))
    throw new Error("商品类目无效");
  for (const value of [p?.hasDefaultPrice, p?.hasDefaultCost])
    if (value !== undefined && typeof value !== "boolean")
      throw new Error("商品默认金额标记无效");
  if (
    p?.archivedAt != null &&
    (typeof p.archivedAt !== "string" ||
      !Number.isFinite(Date.parse(p.archivedAt)))
  )
    throw new Error("商品删除日期无效");
  if (
    !p ||
    typeof p.id !== "string" ||
    !p.id ||
    p.id.length > 200 ||
    typeof p.name !== "string" ||
    !p.name.trim() ||
    p.name.length > 200 ||
    typeof p.active !== "boolean" ||
    !Number.isSafeInteger(p.order)
  )
    throw new Error("商品资料无效");
  for (const n of [p.price, p.cost])
    if (!Number.isSafeInteger(n) || Math.abs(n) > MAX_MONEY)
      throw new Error("商品金额无效");
  return {
    id: p.id,
    name: p.name,
    price: p.price,
    cost: p.cost,
    active: p.active,
    order: p.order,
    ...(p.archivedAt !== undefined ? { archivedAt: p.archivedAt } : {}),
    ...(p.category !== undefined ? { category: p.category } : {}),
    ...(p.hasDefaultPrice !== undefined
      ? { hasDefaultPrice: p.hasDefaultPrice }
      : {}),
    ...(p.hasDefaultCost !== undefined
      ? { hasDefaultCost: p.hasDefaultCost }
      : {}),
  };
}
export function filterSales(sales: Sale[], f: Filters = {}): Sale[] {
  const search = (f.search || "").toLocaleLowerCase();
  return sales
    .filter(
      (r) =>
        Boolean(r.deletedAt) === Boolean(f.deleted) &&
        (!f.from || r.date >= f.from) &&
        (!f.to || r.date <= f.to) &&
        (!f.productId || r.productId === f.productId) &&
        (!search ||
          `${r.productName} ${r.customer} ${r.note}`
            .toLocaleLowerCase()
            .includes(search)),
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.createdAt.localeCompare(a.createdAt) ||
        b.id.localeCompare(a.id),
    );
}
export function buckets(
  sales: SaleInput[],
  period: Period,
  anchor: string,
  count: number,
): Bucket[] {
  return Array.from({ length: count }, (_, i) => {
    const date = shiftPeriod(anchor, period, i - count + 1);
    const { from, to } = periodRange(date, period);
    return {
      key: from,
      from,
      to,
      label:
        period === "month"
          ? `${Number(from.slice(5, 7))}月`
          : `${Number(from.slice(5, 7))}/${Number(from.slice(8))}`,
      ...totals(sales.filter((r) => r.date >= from && r.date <= to)),
    };
  });
}
export function dashboard(sales: Sale[], date = today()): Dashboard {
  const active = filterSales(sales);
  const at = (period: Period) => {
    const { from, to } = periodRange(date, period);
    return totals(active.filter((r) => r.date >= from && r.date <= to));
  };
  const groups = new Map<
    string,
    { name: string; profit: number; count: number }
  >();
  active
    .filter((r) => r.date.slice(0, 7) === date.slice(0, 7))
    .forEach((r) => {
      const p = groups.get(r.productName) || {
        name: r.productName,
        profit: 0,
        count: 0,
      };
      p.profit += r.revenue - r.cost;
      p.count++;
      groups.set(r.productName, p);
    });
  return {
    today: at("day"),
    week: at("week"),
    month: at("month"),
    all: totals(active),
    days: buckets(active, "day", date, 7),
    weeks: buckets(active, "week", date, 8),
    months: buckets(active, "month", date, 12),
    recent: active.slice(0, 5),
    products: [...groups.values()]
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 5),
  };
}
export function monthlyTotals(rows: SaleInput[]): Bucket[] {
  const months = [...new Set(rows.map((r) => r.date.slice(0, 7)))].sort();
  return months.map((month) => ({
    key: month,
    label: month,
    ...periodRange(month + "-01", "month"),
    ...totals(rows.filter((r) => r.date.startsWith(month))),
  }));
}
