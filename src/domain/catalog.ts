import type { Customer, Product, Sale } from "./model";
import { customerRoots, displayCustomerName } from "./customers";

export interface CustomerChoice {
  id: string;
  name: string;
  aliases: string[];
}
export function customerChoices(
  customers: Pick<Customer, "id" | "name" | "mergedInto" | "archivedAt">[],
): CustomerChoice[] {
  const roots = customerRoots(customers as Customer[]);
  return customers
    .filter((c) => !c.mergedInto && !c.archivedAt)
    .map((c) => ({
      id: c.id,
      name: displayCustomerName(c.name),
      aliases: customers
        .filter((a) => !a.archivedAt && roots.get(a.id) === c.id)
        .map((a) => a.name),
    }))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, "zh-CN") || a.id.localeCompare(b.id),
    );
}
export function matchesCustomer(c: CustomerChoice, search: string): boolean {
  const query = search.trim().toLocaleLowerCase();
  return (
    !query ||
    [c.name, ...c.aliases.map(displayCustomerName), ...c.aliases].some((name) =>
      name.toLocaleLowerCase().includes(query),
    )
  );
}
export const productCategories = [
  "ChatGPT",
  "Claude",
  "Gemini",
  "Verizon 网络",
  "常规网络",
  "流量网络",
  "账号与接码",
  "开发与安装",
  "培训与教程",
  "视频与工作流",
  "其他",
];
export function productCategory(name: string): string {
  if (/chatgpt/i.test(name)) return "ChatGPT";
  if (/claude/i.test(name)) return "Claude";
  if (/gemini/i.test(name)) return "Gemini";
  if (/verizon/i.test(name)) return "Verizon 网络";
  if (/常规.*(?:套餐|🪜)/.test(name)) return "常规网络";
  if (/流量|🪜|网络套餐/.test(name)) return "流量网络";
  if (/账号|接码/.test(name)) return "账号与接码";
  if (/开发|安装|codex|skill|api/i.test(name)) return "开发与安装";
  if (/培训|教程/.test(name)) return "培训与教程";
  if (/视频|工作流/.test(name)) return "视频与工作流";
  return "其他";
}
export function groupProducts<T extends { name: string; category?: string }>(
  items: T[],
): { category: string; items: T[] }[] {
  return productCategories
    .map((category) => ({
      category,
      items: items
        .filter((p) => (p.category ?? productCategory(p.name)) === category)
        .sort((a, b) =>
          a.name.localeCompare(b.name, "zh-CN", { numeric: true }),
        ),
    }))
    .filter((g) => g.items.length);
}
export function productCatalog(products: Product[], sales: Sale[]): Product[] {
  const byName = new Map(
    products.filter((p) => !p.archivedAt).map((p) => [p.name, p]),
  );
  const archived = new Set(
    products.filter((p) => p.archivedAt).map((p) => p.name),
  );
  for (const sale of [...sales].sort(
    (a, b) =>
      b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt),
  )) {
    if (
      !sale.deletedAt &&
      !archived.has(sale.productName) &&
      !byName.has(sale.productName)
    )
      byName.set(sale.productName, {
        id: sale.productId || "",
        name: sale.productName,
        price: sale.revenue,
        cost: sale.cost,
        active: true,
        order: 0,
      });
  }
  return groupProducts([...byName.values()]).flatMap((g) => g.items);
}
export function isAcceptanceCustomer(name: string): boolean {
  return /^虚构(?:导入|云端)验收客户\d*$/.test(name.replace(/✅/g, "").trim());
}
export function isAcceptanceProduct(name: string): boolean {
  return /^虚构(?:导入|云端)验收商品\d*$/.test(name.trim());
}
