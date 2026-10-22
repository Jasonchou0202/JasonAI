import { validateProfile } from "./profile";
import type {
  ImportRow,
  ImportIssue,
  ImportPreview,
  Sale,
  Backup,
  Customer,
  CustomerTask,
} from "./model";
import { customerRoots } from "./customers";
import { utcInstant, validRecordId, validateTaskInput } from "./tasks";
import {
  parseMoney,
  totals,
  monthlyTotals,
  validateSale,
  validateProduct,
} from "./finance";
import { validDate } from "./dates";
const cleanHeader = (v: unknown) =>
  String(v ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
export const columns = {
  product: ["商品名称", "商品"],
  customer: ["客户名称", "客户"],
  date: ["日期", "业务日期"],
  revenue: ["销售额", "收入"],
  cost: ["出资", "成本"],
  profit: ["纯利", "利润"],
  note: ["备注"],
};
export function parseGrid(
  grid: unknown[][],
  fileName: string,
  digest: string,
): ImportPreview {
  const rows: ImportRow[] = [];
  const issues: ImportIssue[] = [];
  const headers = (grid[0] || []).map(cleanHeader);
  const index = (key: keyof typeof columns) =>
    headers.findIndex((h) => columns[key].includes(h));
  for (const key of ["product", "date", "revenue", "cost"] as const)
    if (index(key) < 0)
      issues.push({
        row: 1,
        kind: "error",
        message: `缺少必需列：${columns[key][0]}`,
      });
  if (issues.length)
    return {
      rows,
      issues,
      totals: totals([]),
      months: [],
      fileName,
      digest,
      duplicateRows: [],
    };
  grid.slice(1).forEach((cells, i) => {
    if (
      cells.every(
        (c) => c === null || c === undefined || String(c).trim() === "",
      )
    )
      return;
    const row = i + 2;
    const value = (k: keyof typeof columns) =>
      index(k) < 0 ? "" : (cells[index(k)] ?? "");
    try {
      let date = String(value("date")).trim().replace(/\//g, "-");
      const match = date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+00:00:00)?$/);
      if (match)
        date = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
      if (typeof value("date") === "number") {
        const serial = value("date") as number;
        if (!Number.isInteger(serial))
          throw new Error("日期包含时间，请导出为纯日期");
        const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
        date = d.toISOString().slice(0, 10);
      }
      if (!validDate(date)) throw new Error("日期无效");
      if (
        String(value("revenue")).trim() === "" ||
        String(value("cost")).trim() === ""
      )
        throw new Error("销售额或成本为空，请补全，零金额请填写0");
      const input = validateSale({
        productId: "",
        productName: String(value("product")),
        customer: String(value("customer")),
        date,
        revenue: parseMoney(value("revenue")),
        cost: parseMoney(value("cost")),
        note: String(value("note")),
      });
      let sourceProfit: number | undefined;
      if (String(value("profit")).trim() !== "") {
        sourceProfit = parseMoney(value("profit"));
        if (sourceProfit !== input.revenue - input.cost)
          issues.push({
            row,
            kind: "error",
            message: "原利润与销售额减成本不一致，请核对",
          });
      }
      rows.push({ ...input, sourceRow: row, sourceProfit });
    } catch (e) {
      issues.push({
        row,
        kind: "error",
        message: e instanceof Error ? e.message : "记录无效",
      });
    }
  });
  return {
    rows,
    issues,
    totals: totals(rows),
    months: monthlyTotals(rows),
    fileName,
    digest,
    duplicateRows: [],
  };
}
export function signature(
  row: Pick<
    Sale,
    "productName" | "customer" | "date" | "revenue" | "cost" | "note"
  >,
): string {
  return JSON.stringify([
    row.productName,
    row.customer,
    row.date,
    row.revenue,
    row.cost,
    row.note,
  ]);
}
export function validateBackup(value: unknown): Backup {
  const b = value as Backup;
  if (
    !b ||
    b.format !== "zhangyuge-sales" ||
    (b.version !== 1 && b.version !== 2) ||
    !Array.isArray(b.sales) ||
    !Array.isArray(b.products)
  )
    throw new Error("不是本系统的备份文件");
  if (b.sales.length > 100000 || b.products.length > 2000)
    throw new Error("备份文件超出支持范围");
  const ids = new Set<string>();
  const sales = b.sales.map((sale) => {
    const input = validateSale(sale);
    if (
      typeof sale.id !== "string" ||
      !sale.id ||
      sale.id.length > 128 ||
      !/^[\w-]+$/.test(sale.id) ||
      ids.has(sale.id)
    )
      throw new Error("备份有无效或重复的记录编号");
    ids.add(sale.id);
    if (
      !Number.isInteger(sale.revision) ||
      sale.revision < 1 ||
      typeof sale.createdAt !== "string" ||
      typeof sale.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(sale.createdAt)) ||
      !Number.isFinite(Date.parse(sale.updatedAt)) ||
      (sale.deletedAt !== null &&
        (typeof sale.deletedAt !== "string" ||
          !Number.isFinite(Date.parse(sale.deletedAt))))
    )
      throw new Error("备份记录元数据无效");
    return {
      ...input,
      id: sale.id,
      revision: sale.revision,
      createdAt: sale.createdAt,
      updatedAt: sale.updatedAt,
      deletedAt: sale.deletedAt,
    };
  });
  const pids = new Set<string>();
  const products = b.products.map((p) => {
    const product = validateProduct(p);
    if (!/^[\w-]+$/.test(p.id) || pids.has(p.id))
      throw new Error("备份商品编号无效或重复");
    pids.add(p.id);
    return product;
  });
  if (
    typeof b.exportedAt !== "string" ||
    !Number.isFinite(Date.parse(b.exportedAt))
  )
    throw new Error("备份时间无效");
  const base = {
    format: "zhangyuge-sales",
    exportedAt: b.exportedAt,
    sales,
    products,
  } as const;
  if (b.version === 1) return { ...base, version: 1 };
  if (
    !Array.isArray(b.customers) ||
    !Array.isArray(b.tasks) ||
    b.customers.length > 100000 ||
    b.tasks.length > 100000
  )
    throw new Error("备份客户或日程无效或超出支持范围");
  const metadata = (v: Customer | CustomerTask) => {
    if (!validRecordId(v.id) || !Number.isInteger(v.revision) || v.revision < 1)
      throw new Error("备份编号或版本无效");
    utcInstant(v.createdAt);
    utcInstant(v.updatedAt);
    if (v.lastMutation !== undefined && !validRecordId(v.lastMutation))
      throw new Error("备份请求编号无效");
  };
  const customerIds = new Set<string>(),
    names = new Set<string>();
  const customers = b.customers.map((c): Customer => {
    metadata(c);
    if (c.archivedAt != null) utcInstant(c.archivedAt);
    if (
      typeof c.name !== "string" ||
      !c.name.trim() ||
      c.name.length > 500 ||
      names.has(c.name) ||
      customerIds.has(c.id) ||
      (c.mergedInto !== null && !validRecordId(c.mergedInto))
    )
      throw new Error("备份客户无效或重复");
    customerIds.add(c.id);
    names.add(c.name);
    return {
      id: c.id,
      name: c.name,
      mergedInto: c.mergedInto,
      revision: c.revision,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      ...(c.lastMutation ? { lastMutation: c.lastMutation } : {}),
      ...(c.archivedAt !== undefined ? { archivedAt: c.archivedAt } : {}),
      ...(c.profile !== undefined ? { profile: validateProfile(c.profile) } : {}),
    };
  });
  customerRoots(customers);
  if (sales.some((s) => s.customer.trim() && !names.has(s.customer)))
    throw new Error("备份缺少销售客户档案");
  const taskIds = new Set<string>();
  const tasks = b.tasks.map((t): CustomerTask => {
    metadata(t);
    const input = validateTaskInput(t);
    if (
      taskIds.has(t.id) ||
      !customerIds.has(t.customerId) ||
      typeof t.reminderGeneration !== "string" ||
      !t.reminderGeneration ||
      t.reminderGeneration.length > 200
    )
      throw new Error("备份日程无效或重复");
    taskIds.add(t.id);
    if (t.completedAt !== null) utcInstant(t.completedAt);
    if (t.deletedAt !== null) utcInstant(t.deletedAt);
    utcInstant(t.reminderStartAt);
    return {
      ...input,
      id: t.id,
      revision: t.revision,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      completedAt: t.completedAt,
      deletedAt: t.deletedAt,
      reminderGeneration: t.reminderGeneration,
      reminderStartAt: t.reminderStartAt,
      ...(t.lastMutation ? { lastMutation: t.lastMutation } : {}),
    };
  });
  return { ...base, version: 2, customers, tasks };
}
export function exportCsv(rows: Sale[]): string {
  const cell = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = [
    "商品名称",
    "客户名称",
    "日期",
    "销售额",
    "出资",
    "纯利",
    "备注",
  ];
  return (
    "\uFEFF" +
    [
      header.map(cell).join(","),
      ...rows.map((r) =>
        [
          r.productName,
          r.customer,
          r.date,
          (r.revenue / 100).toFixed(2),
          (r.cost / 100).toFixed(2),
          ((r.revenue - r.cost) / 100).toFixed(2),
          r.note,
        ]
          .map((v, i) => (i >= 3 && i <= 5 ? `"${v}"` : cell(v)))
          .join(","),
      ),
    ].join("\r\n")
  );
}
