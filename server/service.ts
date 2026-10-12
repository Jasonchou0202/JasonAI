import type {
  Sale,
  SaleInput,
  Product,
  ImportRow,
  ImportBatch,
  Backup,
  Filters,
} from "../src/domain/model";
import {
  validateSale,
  validateProduct,
  filterSales,
  totals,
  dashboard,
  monthlyTotals,
} from "../src/domain/finance";
import { today, validDate } from "../src/domain/dates";
import { signature, validateBackup } from "../src/domain/import";

export type Collection = "sales" | "products" | "batches";
export interface Transaction {
  get<T>(collection: Collection, id: string): Promise<T | null>;
  put<T>(collection: Collection, id: string, value: T): Promise<void>;
}
export interface Store extends Transaction {
  list<T>(collection: Collection): Promise<T[]>;
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
}
export interface Context {
  uid: string | null;
  ownerUid: string;
  now?: () => string;
  hash: (text: string) => Promise<string>;
}
interface Ledger {
  hasSales: boolean;
  restoreId?: string | null;
}
export const CHUNK_SIZE = 20;
export function identity(ctx: Context) {
  if (!ctx.ownerUid) throw new Error("后台尚未绑定所有者，暂不允许访问");
  if (!ctx.uid || ctx.uid !== ctx.ownerUid)
    throw new Error("无权访问这个私人账本");
}
function recordId(id: unknown): string {
  if (typeof id !== "string" || !id || id.length > 128 || !/^[\w-]+$/.test(id))
    throw new Error("记录编号无效");
  return id;
}
function filters(value: Record<string, unknown>): Filters {
  for (const key of ["from", "to", "search", "productId"])
    if (value[key] !== undefined && typeof value[key] !== "string")
      throw new Error("筛选条件无效");
  const f = value as Filters;
  if (
    (f.from && !validDate(f.from)) ||
    (f.to && !validDate(f.to)) ||
    (f.from && f.to && f.from > f.to)
  )
    throw new Error("筛选日期无效");
  return f;
}
async function writable(tx: Transaction) {
  const ledger = await tx.get<Ledger>("batches", "_ledger");
  if (ledger?.restoreId) throw new Error("正在恢复备份，请完成恢复后再记账");
  return ledger || { hasSales: false };
}
async function visible(store: Store): Promise<Sale[]> {
  const [rows, batches] = await Promise.all([
    store.list<Sale>("sales"),
    store.list<ImportBatch>("batches"),
  ]);
  const complete = new Set(
    batches.filter((b) => b.status === "complete").map((b) => b.id),
  );
  return rows.filter((r) => !r.importBatch || complete.has(r.importBatch));
}
export async function execute(
  store: Store,
  ctx: Context,
  action: string,
  payload: unknown = {},
): Promise<unknown> {
  identity(ctx);
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("请求格式无效");
  const p = payload as Record<string, any>;
  const now = () => ctx.now?.() || new Date().toISOString();
  switch (action) {
    case "session":
      return { uid: ctx.uid };
    case "dashboard":
      return dashboard(await visible(store), today(new Date(now())));
    case "sales.list": {
      const f = filters(p),
        rows = filterSales(await visible(store), f);
      const page = Math.max(1, Math.floor(Number(f.page) || 1));
      return {
        items: rows.slice((page - 1) * 30, page * 30),
        total: rows.length,
        totals: totals(rows),
      };
    }
    case "sales.get": {
      const id = recordId(p.id),
        row = (await visible(store)).find((r) => r.id === id);
      if (!row) throw new Error("记录不存在");
      return row;
    }
    case "customers":
      return [
        ...new Set(
          (await visible(store))
            .filter((r) => !r.deletedAt)
            .map((r) => r.customer)
            .filter(Boolean),
        ),
      ].sort();
    case "products.list":
      return (await store.list<Product>("products")).sort(
        (a, b) => a.order - b.order,
      );
    case "products.save": {
      const product = validateProduct(p as Product);
      recordId(product.id);
      return store.transaction(async (tx) => {
        await writable(tx);
        await tx.put("products", product.id, product);
        return product;
      });
    }
    case "sales.create": {
      const id = recordId(p.requestId),
        input = validateSale(p.sale as SaleInput);
      return store.transaction(async (tx) => {
        const ledger = await writable(tx),
          existing = await tx.get<Sale>("sales", id);
        if (existing) {
          if (signature(existing) !== signature(input))
            throw new Error("这次保存已完成，请刷新后再编辑");
          return existing;
        }
        const time = now(),
          sale: Sale = {
            ...input,
            id,
            createdAt: time,
            updatedAt: time,
            deletedAt: null,
            revision: 1,
          };
        await tx.put("batches", "_ledger", { ...ledger, hasSales: true });
        await tx.put("sales", id, sale);
        return sale;
      });
    }
    case "sales.update":
    case "sales.delete":
    case "sales.restore": {
      const id = recordId(p.id),
        requestId = recordId(p.requestId);
      const input =
        action === "sales.update" ? validateSale(p.sale) : undefined;
      return store.transaction(async (tx) => {
        await writable(tx);
        const old = await tx.get<Sale>("sales", id);
        if (!old) throw new Error("记录不存在");
        if (old.lastMutation === requestId) {
          if (input && signature(input) !== signature(old))
            throw new Error("这次修改已完成，请刷新后再编辑");
          return old;
        }
        if (old.revision !== p.revision)
          throw new Error("记录已在另一处修改，请刷新后重试");
        if (action === "sales.update" && old.deletedAt)
          throw new Error("请先恢复记录");
        const row: Sale = {
          ...old,
          ...input,
          deletedAt:
            action === "sales.delete"
              ? now()
              : action === "sales.restore"
                ? null
                : old.deletedAt,
          updatedAt: now(),
          revision: old.revision + 1,
          lastMutation: requestId,
        };
        await tx.put("sales", id, row);
        return row;
      });
    }
    case "import.preview": {
      const rows = validateImport(p.rows),
        existing = await visible(store);
      const sig = new Set(existing.filter((r) => !r.deletedAt).map(signature));
      return {
        totals: totals(rows),
        months: monthlyTotals(rows),
        duplicateRows: rows
          .filter((r) => sig.has(signature(r)))
          .map((r) => r.sourceRow),
        alreadyImported:
          (await store.get<ImportBatch>("batches", recordId(p.digest)))
            ?.status === "complete",
      };
    }
    case "import.commit": {
      const rows = validateImport(p.rows),
        id = recordId(p.digest);
      if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("文件指纹无效");
      if (typeof p.fileName !== "string" || p.fileName.length > 500)
        throw new Error("文件名无效");
      const fingerprint = await ctx.hash(JSON.stringify(rows));
      const products = await store.list<Product>("products");
      const byName = new Map(products.map((x) => [x.name, x]));
      for (const r of rows)
        if (!byName.has(r.productName))
          byName.set(r.productName, {
            id: "p_" + (await ctx.hash(r.productName)).slice(0, 24),
            name: r.productName,
            price: r.revenue,
            cost: r.cost,
            active: true,
            order: byName.size,
          });
      return store.transaction(async (tx) => {
        const ledger = await writable(tx),
          previous = await tx.get<ImportBatch>("batches", id);
        if (previous && previous.fingerprint !== fingerprint)
          throw new Error("同一导入文件的内容发生变化，请重新预检");
        const batch: ImportBatch = previous || {
          id,
          fingerprint,
          name: p.fileName,
          count: rows.length,
          createdAt: now(),
          status: "pending",
          processed: 0,
        };
        if (batch.status === "complete")
          return {
            count: batch.count,
            repeated: true,
            done: true,
            processed: batch.count,
          };
        const portion = rows.slice(
          batch.processed,
          batch.processed + CHUNK_SIZE,
        );
        const newProducts = [...new Set(portion.map((r) => r.productName))].map(
          (name) => byName.get(name)!,
        );
        const savedProducts = await Promise.all(
          newProducts.map((x) => tx.get<Product>("products", x.id)),
        );
        // Source row is part of the ID, preserving identical genuine orders.
        const sales = portion.map((r) => {
          const { sourceRow, sourceProfit, ...input } = r;
          return {
            ...input,
            productId: byName.get(r.productName)!.id,
            id: "i_" + id.slice(0, 40) + "_" + sourceRow,
            revision: 1,
            createdAt: batch.createdAt,
            updatedAt: batch.createdAt,
            deletedAt: null,
            importBatch: id,
            sourceRow,
          } satisfies Sale;
        });
        const savedSales = await Promise.all(
          sales.map((x) => tx.get<Sale>("sales", x.id)),
        );
        const processed = batch.processed + portion.length,
          done = processed === rows.length;
        await Promise.all([
          ...newProducts
            .filter((_, i) => !savedProducts[i])
            .map((x) => tx.put("products", x.id, x)),
          ...sales
            .filter((_, i) => !savedSales[i])
            .map((x) => tx.put("sales", x.id, x)),
          tx.put("batches", "_ledger", { ...ledger, hasSales: true }),
          tx.put("batches", id, {
            ...batch,
            processed,
            status: done ? "complete" : "pending",
          }),
        ]);
        return { count: rows.length, processed, done, repeated: false };
      });
    }
    case "export":
      return filterSales(await visible(store), filters(p));
    case "backup": {
      const batches = await store.list<ImportBatch>("batches");
      if (batches.some((b) => b.status === "pending"))
        throw new Error("请先完成正在进行的导入或恢复，再下载完整备份");
      return validateBackup({
        format: "zhangyuge-sales",
        version: 1,
        exportedAt: now(),
        sales: await visible(store),
        products: await store.list<Product>("products"),
      } satisfies Backup);
    }
    case "backup.restore": {
      const b = validateBackup(p.backup),
        digest = await ctx.hash(JSON.stringify(b)),
        id = "restore_" + digest.slice(0, 40);
      const existing = await store.list<Sale>("sales");
      return store.transaction(async (tx) => {
        const ledger = await tx.get<Ledger>("batches", "_ledger"),
          previous = await tx.get<ImportBatch>("batches", id);
        if (previous?.status === "complete")
          return { count: b.sales.length, done: true, repeated: true };
        if (ledger?.restoreId && ledger.restoreId !== id)
          throw new Error("请先完成另一份备份的恢复");
        if (
          (!ledger?.restoreId && ledger?.hasSales) ||
          existing.some((r) => r.importBatch !== id)
        )
          throw new Error("备份恢复仅用于空账本，现有记录不会被覆盖");
        const count = b.products.length + b.sales.length;
        const batch: ImportBatch = previous || {
          id,
          fingerprint: digest,
          name: "备份恢复",
          count,
          createdAt: now(),
          status: "pending",
          processed: 0,
        };
        const objects = [
          ...b.products.map((v) => ({ c: "products" as const, v })),
          ...b.sales.map((v) => ({
            c: "sales" as const,
            v: { ...v, importBatch: id },
          })),
        ];
        const portion = objects.slice(
            batch.processed,
            batch.processed + CHUNK_SIZE,
          ),
          processed = batch.processed + portion.length,
          done = processed === count;
        await Promise.all([
          ...portion.map((x) => tx.put(x.c, x.v.id, x.v)),
          tx.put("batches", id, {
            ...batch,
            processed,
            status: done ? "complete" : "pending",
          }),
          tx.put("batches", "_ledger", {
            hasSales: true,
            restoreId: done ? null : id,
          }),
        ]);
        return {
          count: b.sales.length,
          done,
          processed: Math.max(0, processed - b.products.length),
        };
      });
    }
    default:
      throw new Error("不支持的操作");
  }
}
function validateImport(value: unknown): ImportRow[] {
  if (!Array.isArray(value) || !value.length || value.length > 2000)
    throw new Error("每次导入须为1至2000条记录");
  const sourceRows = new Set<number>();
  return value.map((r) => {
    const input = validateSale(r);
    if (
      !Number.isInteger(r.sourceRow) ||
      r.sourceRow < 2 ||
      sourceRows.has(r.sourceRow)
    )
      throw new Error("原始行号无效或重复");
    sourceRows.add(r.sourceRow);
    if (
      r.sourceProfit !== undefined &&
      r.sourceProfit !== input.revenue - input.cost
    )
      throw new Error("原表行利润不一致");
    return {
      ...input,
      sourceRow: r.sourceRow,
      ...(r.sourceProfit !== undefined ? { sourceProfit: r.sourceProfit } : {}),
    };
  });
}
