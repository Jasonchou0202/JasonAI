import type {
  Sale,
  SaleInput,
  Product,
  ImportRow,
  ImportBatch,
  Backup,
  Filters,
  Customer,
  CustomerTask,
} from "../src/domain/model";
import {
  customerId,
  resolveCustomerId,
  customerAliases,
  customerProducts,
  customerRanking,
  customerSuggestions,
  customerKey,
  customerRoots,
  displayCustomerName,
  monthSales,
  parseRankPeriod,
} from "../src/domain/customers";
import {
  filterTasks,
  validateTaskInput,
  utcInstant,
} from "../src/domain/tasks";
import {
  validateSale,
  validateProduct,
  filterSales,
  totals,
  dashboard,
  monthlyTotals,
} from "../src/domain/finance";
import { today, validDate } from "../src/domain/dates";
import { mergeProfiles, validateProfile } from "../src/domain/profile";
import { signature, validateBackup } from "../src/domain/import";
import {
  customerChoices,
  productCatalog,
  groupProducts,
  isAcceptanceCustomer,
  isAcceptanceProduct,
} from "../src/domain/catalog";

export type Collection =
  | "sales"
  | "products"
  | "batches"
  | "customers"
  | "tasks"
  | "subscriptions"
  | "deliveries"
  | "taskSyncLog";
export interface Transaction {
  get<T>(collection: Collection, id: string): Promise<T | null>;
  put<T>(collection: Collection, id: string, value: T): Promise<void>;
  del(collection: Collection, id: string): Promise<void>;
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
  hasData?: boolean;
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
async function ensureCustomer(
  tx: Transaction,
  name: string,
  ctx: Context,
  time: string,
  redirect?: string | null,
): Promise<Customer | null> {
  const id = await customerId(name, ctx.hash);
  if (!id) return null;
  const old = await tx.get<Customer>("customers", id);
  if (old) {
    if (old.name !== name) throw new Error("客户编号冲突");
    if (old.archivedAt) throw new Error("客户资料已删除，请先在设置中恢复");
    return old;
  }
  const customer: Customer = {
    id,
    name,
    mergedInto: redirect && redirect !== id ? redirect : null,
    revision: 1,
    createdAt: time,
    updatedAt: time,
  };
  await tx.put("customers", id, customer);
  return customer;
}

/** Preferred root per canonical key: cleanest name first, then earliest, then id. */
function customerKeyRoots(customers: Customer[]): Map<string, string> {
  const roots = customerRoots(customers);
  const byKey = new Map<string, string>();
  const cleanRank = (c: Customer) =>
    c.name === displayCustomerName(c.name) ? 0 : 1;
  const sorted = [...customers].sort(
    (a, b) =>
      cleanRank(a) - cleanRank(b) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
  for (const c of sorted) {
    const key = customerKey(c.name);
    if (key && !byKey.has(key)) byKey.set(key, roots.get(c.id)!);
  }
  return byKey;
}

function redirectFor(byKey: Map<string, string>, name: string): string | null {
  return byKey.get(customerKey(name)) ?? null;
}
/** Includes deleted and pending historical sales; exact original text is the identity. */
async function initializeCustomers(
  store: Store,
  ctx: Context,
  time: string,
): Promise<Customer[]> {
  await writable(store);
  const [sales, customers] = await Promise.all([
    store.list<Sale>("sales"),
    store.list<Customer>("customers"),
  ]);
  const names = new Set(customers.map((c) => c.name));
  const missing = [
    ...new Set(
      sales.map((s) => s.customer).filter((n) => n.trim() && !names.has(n)),
    ),
  ];
  if (!missing.length) return customers;
  // Deterministic redirect plan: the cleanest name per key becomes the root;
  // ✅/IP variants attach to it. Independent of batch timing.
  const rootsMap = customerRoots(customers);
  const idsByName = new Map<string, string>();
  const candidates: { id: string; name: string; createdAt: string }[] =
    customers.map((c) => ({
      id: c.id,
      name: c.name,
      createdAt: c.createdAt,
    }));
  for (const name of missing)
    idsByName.set(name, (await customerId(name, ctx.hash))!);
  for (const [name, id] of idsByName)
    candidates.push({ id, name, createdAt: time });
  const cleanRank = (name: string) =>
    name === displayCustomerName(name) ? 0 : 1;
  const rootFor = new Map<string, string>();
  for (const c of candidates.sort(
    (a, b) =>
      cleanRank(a.name) - cleanRank(b.name) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  )) {
    const key = customerKey(c.name);
    if (key && !rootFor.has(key)) rootFor.set(key, rootsMap.get(c.id) ?? c.id);
  }
  const redirects = new Map<string, string | null>();
  for (const name of missing) {
    const root = rootFor.get(customerKey(name));
    redirects.set(name, root && root !== idsByName.get(name) ? root : null);
  }
  // Disjoint batches only read the shared ledger; at most four transactions run
  // together. Each transaction still serializes its own database operations.
  const parallelBatches = 4;
  for (let i = 0; i < missing.length; i += CHUNK_SIZE * parallelBatches) {
    const batches = Array.from({ length: parallelBatches }, (_, batch) =>
      missing.slice(i + batch * CHUNK_SIZE, i + (batch + 1) * CHUNK_SIZE),
    ).filter((batch) => batch.length);
    const results = await Promise.allSettled(
      batches.map((names) =>
        store.transaction(async (tx) => {
          await writable(tx);
          for (const name of names)
            await ensureCustomer(tx, name, ctx, time, redirects.get(name));
        }),
      ),
    );
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
  return store.list<Customer>("customers");
}
async function customerRoot(
  tx: Transaction,
  id: string,
  forbidden?: string,
): Promise<Customer> {
  const seen = new Set<string>();
  for (;;) {
    if (id === forbidden) throw new Error("客户不能合并到自己或形成循环");
    if (seen.has(id)) throw new Error("客户合并形成循环");
    seen.add(id);
    const c = await tx.get<Customer>("customers", id);
    if (!c) throw new Error("客户不存在");
    if (!c.mergedInto) return c;
    id = c.mergedInto;
  }
}
interface MutationReceipt<T> {
  fingerprint: string;
  result: T;
}
/** Durable receipts keep older retries harmless even after later edits. */
/**
 * 合并时把来源客户的 profile 并到目标所在的根客户（同一事务内）。来源档案保持原样，
 * 所以撤销合并后来源仍有自己的原始信息；目标保留合并后的结果。
 */
async function absorbProfile(
  tx: Transaction,
  targetId: string,
  source: Customer,
  time: string,
  requestId: string,
) {
  if (!source.profile) return;
  let id = targetId;
  for (let i = 0; i < 1000; i++) {
    const c = await tx.get<Customer>("customers", id);
    if (!c) throw new Error("客户不存在");
    if (c.mergedInto) {
      id = c.mergedInto;
      continue;
    }
    const profile = mergeProfiles(c.profile, source.profile);
    if (JSON.stringify(profile) === JSON.stringify(c.profile)) return;
    await tx.put("customers", id, {
      ...c,
      profile,
      updatedAt: time,
      revision: c.revision + 1,
      lastMutation: requestId,
    });
    return;
  }
  throw new Error("客户合并形成循环");
}
async function mutation<T>(
  tx: Transaction,
  ctx: Context,
  request: unknown,
  action: string,
  input: unknown,
  apply: () => Promise<T>,
): Promise<T> {
  const requestId = recordId(request),
    id = "mutation_" + (await ctx.hash(requestId));
  const fingerprint = await ctx.hash(JSON.stringify([action, input]));
  const prior = await tx.get<MutationReceipt<T>>("batches", id);
  if (prior) {
    if (prior.fingerprint !== fingerprint)
      throw new Error("请求编号已用于其他修改，请刷新后重试");
    return prior.result;
  }
  const result = await apply();
  await tx.put("batches", id, { fingerprint, result });
  return result;
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
      return customerChoices(await initializeCustomers(store, ctx, now())).map(
        (c) => c.name,
      );
    case "customers.list":
      return (await initializeCustomers(store, ctx, now()))
        .filter((c) => !c.archivedAt)
        .sort(
          (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
        );
    case "customers.ranking": {
      const customers = await initializeCustomers(store, ctx, now());
      const [sales, tasks] = await Promise.all([
        visible(store),
        store.list<CustomerTask>("tasks"),
      ]);
      return customerRanking(
        customers,
        sales,
        parseRankPeriod(p.period ?? p.month ?? "all"),
        tasks,
      );
    }
    case "customers.suggestions": {
      const customers = await initializeCustomers(store, ctx, now());
      const [sales, tasks] = await Promise.all([
        visible(store),
        store.list<CustomerTask>("tasks"),
      ]);
      return customerSuggestions(customers, sales, tasks);
    }
    case "customers.detail": {
      const id = recordId(p.id),
        customers = await initializeCustomers(store, ctx, now());
      const root = resolveCustomerId(customers, id),
        customer = customers.find((c) => c.id === root)!;
      const aliases = customerAliases(customers, root),
        names = new Set([customer, ...aliases].map((c) => c.name));
      const sales = monthSales(await visible(store), p.month).filter((s) =>
        names.has(s.customer),
      );
      return {
        customer,
        aliases: aliases.map((c) => c.name),
        totals: totals(sales),
        products: customerProducts(sales),
        sales,
      };
    }
    case "customers.merge":
    case "customers.unmerge": {
      await initializeCustomers(store, ctx, now());
      const sourceId = recordId(p.sourceId ?? p.id);
      const targetId =
        action === "customers.merge" ? recordId(p.targetId) : null;
      return store.transaction(async (tx) => {
        await writable(tx);
        return mutation(
          tx,
          ctx,
          p.requestId,
          action,
          { sourceId, targetId, revision: p.revision },
          async () => {
            const source = await tx.get<Customer>("customers", sourceId);
            if (!source) throw new Error("客户不存在");
            if (source.revision !== p.revision)
              throw new Error("客户已在另一处修改，请刷新后重试");
            // Preserve the chosen redirect, including subtrees, so an unmerge restores the original IDs.
            if (targetId) {
              await customerRoot(tx, targetId, sourceId);
            }
            const row: Customer = {
              ...source,
              mergedInto: targetId,
              updatedAt: now(),
              revision: source.revision + 1,
              lastMutation: recordId(p.requestId),
            };
            await tx.put("customers", sourceId, row);
            if (targetId)
              await absorbProfile(tx, targetId, source, now(), recordId(p.requestId));
            return row;
          },
        );
      });
    }
    case "customers.profile.save": {
      // 只改这一位客户档案上的可选 profile 字段，其他字段原样保留
      await initializeCustomers(store, ctx, now());
      const id = recordId(p.id);
      const profile = validateProfile(p.profile);
      if (!Number.isInteger(p.revision) || p.revision < 1) throw new Error("客户版本无效");
      return store.transaction(async (tx) => {
        await writable(tx);
        return mutation(tx, ctx, p.requestId, action, { id, profile, revision: p.revision }, async () => {
          const old = await tx.get<Customer>("customers", id);
          if (!old || old.archivedAt) throw new Error("客户不存在");
          if (old.revision !== p.revision) throw new Error("客户已在另一处修改，请刷新后重试");
          const row: Customer = {
            ...old,
            profile,
            updatedAt: now(),
            revision: old.revision + 1,
            lastMutation: recordId(p.requestId),
          };
          await tx.put("customers", id, row);
          return row;
        });
      });
    }
    case "customers.mergeMany": {
      await initializeCustomers(store, ctx, now());
      const targetId = recordId(p.targetId);
      if (
        !Array.isArray(p.sources) ||
        !p.sources.length ||
        p.sources.length > 200
      )
        throw new Error("合并来源无效");
      const sources = p.sources.map((source: any) => ({
        id: recordId(source?.id),
        revision: Number(source?.revision),
      }));
      if (
        sources.some((s) => !Number.isInteger(s.revision) || s.revision < 1) ||
        sources.some((s) => s.id === targetId)
      )
        throw new Error("合并来源无效");
      return store.transaction(async (tx) => {
        await writable(tx);
        return mutation(
          tx,
          ctx,
          p.requestId,
          action,
          { targetId, sources },
          async () => {
            const target = await tx.get<Customer>("customers", targetId);
            if (!target || target.mergedInto)
              throw new Error("目标客户不存在或已合并");
            let merged = 0;
            for (const source of sources) {
              const row = await tx.get<Customer>("customers", source.id);
              if (!row) throw new Error("客户不存在");
              if (row.mergedInto === targetId) continue;
              if (row.mergedInto || row.revision !== source.revision)
                throw new Error("客户已在另一处修改，请刷新后重试");
              await customerRoot(tx, targetId, source.id);
              await tx.put("customers", source.id, {
                ...row,
                mergedInto: targetId,
                updatedAt: now(),
                revision: row.revision + 1,
                lastMutation: recordId(p.requestId),
              });
              await absorbProfile(tx, targetId, row, now(), recordId(p.requestId));
              merged++;
            }
            return { merged };
          },
        );
      });
    }
    case "tasks.list": {
      const customers = await initializeCustomers(store, ctx, now());
      return filterTasks(await store.list<CustomerTask>("tasks"), customers, p);
    }
    case "tasks.get": {
      await writable(store);
      const row = await store.get<CustomerTask>("tasks", recordId(p.id));
      if (!row) throw new Error("日程不存在");
      return row;
    }
    case "tasks.create": {
      await initializeCustomers(store, ctx, now());
      const id = recordId(p.requestId),
        input = validateTaskInput(p.task ?? p);
      return store.transaction(async (tx) => {
        const ledger = await writable(tx);
        return mutation(tx, ctx, id, action, input, async () => {
          if (await tx.get<CustomerTask>("tasks", id))
            throw new Error("日程编号已存在");
          await customerRoot(tx, input.customerId);
          const time = utcInstant(now());
          const task: CustomerTask = {
            ...input,
            id,
            completedAt: null,
            deletedAt: null,
            createdAt: time,
            updatedAt: time,
            revision: 1,
            lastMutation: id,
            reminderStartAt: time,
            reminderGeneration: await ctx.hash(
              JSON.stringify([id, time, "create"]),
            ),
          };
          await tx.put("tasks", id, task);
          await tx.put("batches", "_ledger", { ...ledger, hasData: true });
          return task;
        });
      });
    }
    case "tasks.purge": {
      const id = recordId(p.id),
        requestId = recordId(p.requestId);
      return store.transaction(async (tx) => {
        await writable(tx);
        return mutation(
          tx,
          ctx,
          requestId,
          action,
          { id, revision: p.revision },
          async () => {
            const old = await tx.get<CustomerTask>("tasks", id);
            if (!old) throw new Error("日程不存在");
            if (old.revision !== p.revision)
              throw new Error("日程已在另一处修改，请刷新后重试");
            if (!old.deletedAt) throw new Error("只能彻底删除回收站中的日程");
            await tx.del("tasks", id);
            return { purged: true };
          },
        );
      });
    }
    case "tasks.update":
    case "tasks.complete":
    case "tasks.reopen":
    case "tasks.delete":
    case "tasks.restore": {
      const id = recordId(p.id),
        requestId = recordId(p.requestId);
      // Updates accept a full task or a partial patch; only editable input fields are applied.
      const patch =
        action === "tasks.update" ? (p.task ?? p.patch ?? p) : undefined;
      const editable = [
        "customerId",
        "at",
        "title",
        "feedback",
        "nextAction",
        "reminder",
      ] as const;
      const changes: Record<string, unknown> = {};
      if (patch !== undefined) {
        if (!patch || typeof patch !== "object" || Array.isArray(patch))
          throw new Error("日程格式无效");
        for (const key of editable)
          if (Object.hasOwn(patch, key)) changes[key] = patch[key];
      }
      return store.transaction(async (tx) => {
        await writable(tx);
        return mutation(
          tx,
          ctx,
          requestId,
          action,
          { id, revision: p.revision, changes },
          async () => {
            const old = await tx.get<CustomerTask>("tasks", id);
            if (!old) throw new Error("日程不存在");
            if (old.revision !== p.revision)
              throw new Error("日程已在另一处修改，请刷新后重试");
            if (old.deletedAt && action !== "tasks.restore")
              throw new Error("请先恢复日程");
            const input =
              action === "tasks.update"
                ? validateTaskInput({ ...old, ...changes })
                : validateTaskInput(old);
            await customerRoot(tx, input.customerId);
            const time = utcInstant(now());
            const completedAt =
              action === "tasks.complete"
                ? (old.completedAt ?? time)
                : action === "tasks.reopen"
                  ? null
                  : old.completedAt;
            const deletedAt =
              action === "tasks.delete"
                ? (old.deletedAt ?? time)
                : action === "tasks.restore"
                  ? null
                  : old.deletedAt;
            const reminderChanged =
              input.at !== old.at ||
              input.reminder !== old.reminder ||
              completedAt !== old.completedAt ||
              deletedAt !== old.deletedAt;
            const row: CustomerTask = {
              ...old,
              ...input,
              completedAt,
              deletedAt,
              updatedAt: time,
              revision: old.revision + 1,
              lastMutation: requestId,
              reminderGeneration: reminderChanged
                ? await ctx.hash(
                    JSON.stringify([old.reminderGeneration, requestId, action]),
                  )
                : old.reminderGeneration,
              reminderStartAt: reminderChanged ? time : old.reminderStartAt,
            };
            await tx.put("tasks", id, row);
            return row;
          },
        );
      });
    }
    case "products.list":
      return groupProducts(
        (await store.list<Product>("products")).filter((p) => !p.archivedAt),
      ).flatMap((g) => g.items);
    case "products.catalog":
      return productCatalog(
        await store.list<Product>("products"),
        await visible(store),
      );
    case "catalog.cleanup.preview": {
      const customers = await initializeCustomers(store, ctx, now());
      const [products, sales, tasks] = await Promise.all([
        store.list<Product>("products"),
        visible(store),
        store.list<CustomerTask>("tasks"),
      ]);
      const roots = customerRoots(customers);
      const customerCandidates = customers
        .filter((c) => !c.archivedAt && isAcceptanceCustomer(c.name))
        .map((c) => ({
          id: c.id,
          name: c.name,
          revision: c.revision,
          blocked:
            customers.some(
              (a) =>
                roots.get(a.id) === roots.get(c.id) &&
                !isAcceptanceCustomer(a.name),
            ) ||
            sales.some((s) => !s.deletedAt && s.customer === c.name) ||
            tasks.some((t) => roots.get(t.customerId) === roots.get(c.id)),
        }));
      const productCandidates = products
        .filter((p) => !p.archivedAt && isAcceptanceProduct(p.name))
        .map((p) => ({
          id: p.id,
          name: p.name,
          blocked: sales.some(
            (s) =>
              !s.deletedAt &&
              (s.productId === p.id || s.productName === p.name),
          ),
        }));
      return { customers: customerCandidates, products: productCandidates };
    }
    case "catalog.cleanup": {
      const preview = (await execute(
        store,
        ctx,
        "catalog.cleanup.preview",
      )) as {
        customers: { id: string; revision: number; blocked: boolean }[];
        products: { id: string; blocked: boolean }[];
      };
      if (
        preview.customers.some((c) => c.blocked) ||
        preview.products.some((c) => c.blocked)
      )
        throw new Error("验收清单仍关联销售或日程，请先核对，未删除任何资料");
      return store.transaction(async (tx) => {
        await writable(tx);
        return mutation(tx, ctx, p.requestId, action, {}, async () => {
          let customerCount = 0,
            productCount = 0;
          for (const c of preview.customers) {
            const row = await tx.get<Customer>("customers", c.id);
            if (!row || row.revision !== c.revision)
              throw new Error("客户已在另一处修改，请刷新后重试");
            await tx.put("customers", c.id, {
              ...row,
              archivedAt: now(),
              updatedAt: now(),
              revision: row.revision + 1,
            });
            customerCount++;
          }
          for (const c of preview.products) {
            const row = await tx.get<Product>("products", c.id);
            if (!row || !isAcceptanceProduct(row.name))
              throw new Error("商品资料已修改，请刷新后重试");
            await tx.put("products", c.id, { ...row, archivedAt: now() });
            productCount++;
          }
          return { customers: customerCount, products: productCount };
        });
      });
    }
    case "catalog.deleted": {
      const [customers, products] = await Promise.all([
        store.list<Customer>("customers"),
        store.list<Product>("products"),
      ]);
      return [
        ...customers
          .filter((c) => c.archivedAt)
          .map((c) => ({ kind: "customer", id: c.id, name: c.name })),
        ...products
          .filter((c) => c.archivedAt)
          .map((c) => ({ kind: "product", id: c.id, name: c.name })),
      ];
    }
    case "catalog.restore": {
      const collection =
        p.kind === "customer"
          ? "customers"
          : p.kind === "product"
            ? "products"
            : null;
      if (!collection) throw new Error("清单类型无效");
      const id = recordId(p.id);
      return store.transaction(async (tx) => {
        await writable(tx);
        return mutation(
          tx,
          ctx,
          p.requestId,
          action,
          { id, kind: p.kind },
          async () => {
            const row = await tx.get<Customer & Product>(collection, id);
            if (!row?.archivedAt) throw new Error("资料未删除");
            await tx.put(collection, id, {
              ...row,
              archivedAt: null,
              ...(collection === "customers"
                ? { updatedAt: now(), revision: row.revision + 1 }
                : {}),
            });
            return { restored: true };
          },
        );
      });
    }
    case "products.create":
    case "products.save": {
      const raw = action === "products.create" ? p.product : p;
      const product = validateProduct({
        ...raw,
        name: typeof raw?.name === "string" ? raw.name.trim() : raw?.name,
      });
      recordId(product.id);
      const nameKey = "product_name_" + (await ctx.hash(product.name));
      const candidates = (await store.list<Product>("products"))
        .filter((row) => row.name.trim() === product.name)
        .sort((a, b) => a.id.localeCompare(b.id));
      return store.transaction(async (tx) => {
        await writable(tx);
        const apply = async () => {
          const registry = await tx.get<{ productId: string }>(
            "batches",
            nameKey,
          );
          const registered = registry
            ? await tx.get<Product>("products", registry.productId)
            : null;
          let sameName =
            registered?.name.trim() === product.name ? registered : null;
          if (!sameName)
            for (const candidate of candidates) {
              const current = await tx.get<Product>("products", candidate.id);
              if (current?.name.trim() === product.name) {
                sameName = current;
                break;
              }
            }
          if (action === "products.create" && sameName) {
            if (sameName.archivedAt)
              throw new Error("同名商品已删除，请到设置中恢复");
            if (!sameName.active)
              throw new Error("同名商品已停用，请到设置中启用");
            await tx.put("batches", nameKey, { productId: sameName.id });
            return { product: sameName, reused: true };
          }
          if (sameName && sameName.id !== product.id)
            throw new Error("同名商品已存在，请选择已有商品");
          const old = await tx.get<Product>("products", product.id);
          if (action === "products.create" && old)
            throw new Error("商品编号已存在，请重新打开增加商品");
          if (old?.archivedAt) throw new Error("商品已删除，请到设置中恢复");
          const saved = validateProduct({ ...old, ...product });
          await tx.put("products", saved.id, saved);
          await tx.put("batches", nameKey, { productId: saved.id });
          return { product: saved, reused: false };
        };
        if (action === "products.create")
          return mutation(tx, ctx, p.requestId, action, product, apply);
        return (await apply()).product;
      });
    }
    case "sales.create": {
      const id = recordId(p.requestId),
        input = validateSale(p.sale as SaleInput);
      const customers = await store.list<Customer>("customers");
      const byKey = customerKeyRoots(customers);
      return store.transaction(async (tx) => {
        const ledger = await writable(tx),
          existing = await tx.get<Sale>("sales", id);
        if (await tx.get("batches", "_purged_sale_" + (await ctx.hash(id))))
          throw new Error("这次保存的记录已彻底删除，请新建一笔销售");
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
        await ensureCustomer(
          tx,
          sale.customer,
          ctx,
          time,
          redirectFor(byKey, sale.customer),
        );
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
      const customers = await store.list<Customer>("customers");
      const byKey = customerKeyRoots(customers);
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
        await ensureCustomer(
          tx,
          row.customer,
          ctx,
          row.updatedAt,
          redirectFor(byKey, row.customer),
        );
        return row;
      });
    }
    case "sales.purge": {
      const id = recordId(p.id),
        requestId = recordId(p.requestId);
      return store.transaction(async (tx) => {
        await writable(tx);
        return mutation(
          tx,
          ctx,
          requestId,
          action,
          { id, revision: p.revision },
          async () => {
            const old = await tx.get<Sale>("sales", id);
            if (!old) throw new Error("记录不存在");
            if (old.revision !== p.revision)
              throw new Error("记录已在另一处修改，请刷新后重试");
            if (!old.deletedAt) throw new Error("只能彻底删除回收站中的记录");
            await tx.put("batches", "_purged_sale_" + (await ctx.hash(id)), {
              id,
            });
            await tx.del("sales", id);
            return { purged: true };
          },
        );
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
      const customers = await store.list<Customer>("customers");
      const byKey = customerKeyRoots(customers);
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
        for (const name of new Set(sales.map((s) => s.customer))) {
          const customer = await ensureCustomer(
            tx,
            name,
            ctx,
            batch.createdAt,
            redirectFor(byKey, name),
          );
          if (customer && !byKey.has(customerKey(name)))
            byKey.set(customerKey(name), customer.mergedInto || customer.id);
        }
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
      const customers = await initializeCustomers(store, ctx, now());
      return validateBackup({
        format: "zhangyuge-sales",
        version: 2,
        exportedAt: now(),
        sales: await visible(store),
        products: await store.list<Product>("products"),
        customers,
        tasks: await store.list<CustomerTask>("tasks"),
      } satisfies Backup);
    }
    case "backup.restore": {
      const b = validateBackup(p.backup),
        digest = await ctx.hash(JSON.stringify(b)),
        id = "restore_" + digest.slice(0, 40);
      const customers: Customer[] = b.version === 2 ? b.customers : [];
      if (b.version === 2) {
        for (const customer of customers)
          if ((await customerId(customer.name, ctx.hash)) !== customer.id)
            throw new Error("备份客户编号与原名不一致");
      } else {
        for (const name of new Set(
          b.sales.map((s) => s.customer).filter((n) => n.trim()),
        ))
          customers.push({
            id: (await customerId(name, ctx.hash))!,
            name,
            mergedInto: null,
            revision: 1,
            createdAt: new Date(b.exportedAt).toISOString(),
            updatedAt: new Date(b.exportedAt).toISOString(),
          });
      }
      const [existing, existingCustomers, existingTasks] = await Promise.all([
        store.list<Sale>("sales"),
        store.list<Customer>("customers"),
        store.list<CustomerTask>("tasks"),
      ]);
      return store.transaction(async (tx) => {
        const ledger = await tx.get<Ledger>("batches", "_ledger"),
          previous = await tx.get<ImportBatch>("batches", id);
        if (previous?.status === "complete")
          return { count: b.sales.length, done: true, repeated: true };
        if (ledger?.restoreId && ledger.restoreId !== id)
          throw new Error("请先完成另一份备份的恢复");
        if (
          (!ledger?.restoreId && (ledger?.hasSales || ledger?.hasData)) ||
          existing.some((r) => r.importBatch !== id) ||
          (!previous &&
            (existingCustomers.length > 0 || existingTasks.length > 0))
        )
          throw new Error("备份恢复仅用于空账本，现有记录不会被覆盖");
        const tasks = b.version === 2 ? b.tasks : [];
        const count =
          b.products.length + b.sales.length + customers.length + tasks.length;
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
          ...customers.map((v) => ({ c: "customers" as const, v })),
          ...tasks.map((v) => ({ c: "tasks" as const, v })),
        ];
        const portion = await Promise.all(
          objects
            .slice(batch.processed, batch.processed + CHUNK_SIZE)
            .map(async (object) => {
              if (object.c !== "tasks") return object;
              const { lastMutation, ...v } = object.v;
              return {
                c: "tasks" as const,
                v: {
                  ...v,
                  reminderStartAt: utcInstant(batch.createdAt),
                  reminderGeneration: await ctx.hash(
                    JSON.stringify([
                      v.reminderGeneration,
                      id,
                      batch.createdAt,
                      "restore",
                    ]),
                  ),
                },
              };
            }),
        );
        const processed = batch.processed + portion.length,
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
          processed: Math.min(
            b.sales.length,
            Math.max(0, processed - b.products.length),
          ),
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
