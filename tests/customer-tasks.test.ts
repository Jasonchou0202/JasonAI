import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../server/memory-store";
import { CloudStore } from "../server/cloud-store";
import { CHUNK_SIZE, execute, type Context } from "../server/service";
import type {
  Backup,
  BackupV2,
  Customer,
  CustomerDetail,
  CustomerRankingResult,
  CustomerTask,
  Sale,
  SaleInput,
} from "../src/domain/model";
import { customerId, resolveCustomerId } from "../src/domain/customers";
import { validateBackup } from "../src/domain/import";

const hash = async (text: string) =>
  createHash("sha256").update(text).digest("hex");
const base: SaleInput = {
  productId: "p",
  productName: "商品",
  customer: "Alpha",
  date: "2026-10-01",
  revenue: 10050,
  cost: 2025,
  note: "",
};
function client(store = new MemoryStore()) {
  let time = "2026-10-13T04:00:00.000Z";
  const ctx: Context = {
    uid: "owner",
    ownerUid: "owner",
    now: () => time,
    hash,
  };
  const call = <T = any>(action: string, payload: unknown = {}) =>
    execute(store, ctx, action, payload) as Promise<T>;
  return {
    store,
    ctx,
    call,
    time: (value: string) => {
      time = value;
    },
  };
}
async function finish(c: ReturnType<typeof client>, backup: Backup) {
  let result;
  do {
    result = await c.call("backup.restore", { backup });
  } while (!result.done);
  return result;
}
async function add(
  c: ReturnType<typeof client>,
  id: string,
  changes: Partial<SaleInput> = {},
) {
  return c.call<Sale>("sales.create", {
    requestId: id,
    sale: { ...base, ...changes },
  });
}
async function task(
  c: ReturnType<typeof client>,
  requestId = "task",
  name = "Alpha",
  changes = {},
) {
  return c.call<CustomerTask>("tasks.create", {
    requestId,
    task: {
      customerId: await customerId(name, hash),
      at: "2026-11-01T04:00:00Z",
      title: "跟进",
      feedback: "",
      nextAction: "",
      reminder: "both",
      ...changes,
    },
  });
}
async function merge(
  c: ReturnType<typeof client>,
  source: string,
  target: string,
  requestId = "merge",
  revision = 1,
) {
  return c.call<Customer>("customers.merge", {
    sourceId: await customerId(source, hash),
    targetId: await customerId(target, hash),
    revision,
    requestId,
  });
}

describe("customer archive and rankings", () => {
  it("initializes 404 historical sales / 200 customers within a 60s simulated CloudStore budget and uses zero warm transactions", async () => {
    const backing = new MemoryStore(),
      ctx = client().ctx;
    for (let i = 0; i < 404; i++) {
      const id = "historical-" + String(i).padStart(4, "0");
      backing.data.sales[id] = {
        ...base,
        id,
        customer: "客户-" + (i % 200),
        revision: 1,
        createdAt: ctx.now!(),
        updatedAt: ctx.now!(),
        deletedAt: i % 7 === 0 ? ctx.now!() : null,
      };
    }
    // Real CloudStore paging and transaction serialization, simulated 150ms per
    // SDK round trip (including transaction begin/commit), no live cloud writes.
    const latencyMs = 150;
    const pause = () =>
      new Promise<void>((resolve) => setTimeout(resolve, latencyMs));
    let transactions = 0,
      active = 0,
      peak = 0,
      sdkCalls = 0,
      peakTransactionOperations = 0;
    const collection = (
      c: keyof typeof backing.data,
      state?: { operations: number },
    ) => {
      let after = "",
        limit = 100;
      async function operation<T>(fn: () => T): Promise<T> {
        sdkCalls++;
        if (state) {
          state.operations++;
          peakTransactionOperations = Math.max(
            peakTransactionOperations,
            state.operations,
          );
        }
        try {
          await pause();
          return fn();
        } finally {
          if (state) state.operations--;
        }
      }
      const q = {
        orderBy: () => q,
        limit: (count: number) => {
          limit = count;
          return q;
        },
        where: (condition: { _id: string }) => {
          after = condition._id;
          return q;
        },
        get: () =>
          operation(() => ({
            data: Object.entries(backing.data[c])
              .sort(([a], [b]) => a.localeCompare(b))
              .filter(([id]) => id > after)
              .slice(0, limit)
              .map(([id, v]) => ({ ...(v as object), _id: id })),
          })),
        doc: (id: string) => ({
          get: () =>
            operation(() => ({
              data: backing.data[c][id]
                ? { ...(backing.data[c][id] as object), _id: id }
                : [],
            })),
          set: (v: unknown) =>
            operation(() => {
              backing.data[c][id] = structuredClone(v);
            }),
        }),
      };
      return q;
    };
    const store = new CloudStore({
      command: { gt: (value: string) => value },
      collection,
      runTransaction: async (
        fn: (tx: {
          collection: (
            c: keyof typeof backing.data,
          ) => ReturnType<typeof collection>;
        }) => Promise<unknown>,
      ) => {
        transactions++;
        active++;
        peak = Math.max(peak, active);
        const state = { operations: 0 };
        try {
          sdkCalls++;
          await pause();
          const result = await fn({ collection: (c) => collection(c, state) });
          sdkCalls++;
          await pause();
          return result;
        } finally {
          active--;
        }
      },
    });
    const started = performance.now();
    const customers = (await execute(
      store,
      ctx,
      "customers.list",
    )) as Customer[];
    const coldMs = performance.now() - started;
    expect(customers).toHaveLength(200);
    expect(transactions).toBe(10);
    expect(peak).toBe(4);
    expect(peakTransactionOperations).toBe(1);
    expect(sdkCalls).toBe(440);
    expect(coldMs).toBeLessThan(60_000);
    const before = transactions,
      callsBefore = sdkCalls,
      warmStarted = performance.now();
    expect(await execute(store, ctx, "customers.list")).toEqual(customers);
    const warmMs = performance.now() - warmStarted;
    expect(transactions).toBe(before);
    expect(sdkCalls - callsBefore).toBe(9);
    expect(
      await execute(store, ctx, "customers.ranking", { month: "2026-10" }),
    ).toMatchObject({ totals: { count: 346 } });
    console.info(
      `customer-init: 404 sales, 200 customers; simulated SDK RTT=${latencyMs}ms; cold=${Math.round(coldMs)}ms/10 transactions (peak 4); warm=${Math.round(warmMs)}ms/0 transactions`,
    );
  }, 60_000);
  it("initializes exact original names from all historical rows, including deleted rows, idempotently", async () => {
    const c = client();
    const names = ["Alpha", " Alpha ", "alpha", "✅原名 1.2.3.4", "", " \t "];
    for (const [i, name] of names.entries()) {
      const row: Sale = {
        ...base,
        customer: name,
        id: "history-" + i,
        revision: 1,
        deletedAt: i === 3 ? c.ctx.now!() : null,
        createdAt: c.ctx.now!(),
        updatedAt: c.ctx.now!(),
      };
      await c.store.put("sales", row.id, row);
    }
    const lists = await Promise.all(
      Array.from({ length: 4 }, () => c.call<Customer[]>("customers.list")),
    );
    expect(lists.every((l) => l.length === 4)).toBe(true);
    const alpha = lists[0].find((c) => c.name === "Alpha")!;
    const spaced = lists[0].find((c) => c.name === " Alpha ")!;
    const lower = lists[0].find((c) => c.name === "alpha")!;
    const check = lists[0].find((c) => c.name === "✅原名 1.2.3.4")!;
    for (const row of [alpha, spaced, lower, check]) {
      expect(row.id).toBe("c_" + (await hash(row.name)));
      expect(row.revision).toBe(1);
    }
    // The clean "Alpha" wins the shared key; the space variant attaches to it.
    expect(spaced.mergedInto).toBe(alpha.id);
    expect(alpha.mergedInto).toBeNull();
    expect(lower.mergedInto).toBeNull();
    expect(check.mergedInto).toBeNull();
    expect(await c.call("customers.list")).toEqual(lists[0]);
    expect(await c.call("customers")).toEqual(
      [" \t ", " Alpha ", "Alpha", "alpha"].sort(),
    );
  });

  it("ranks the complete selected month in cents, with negative amounts, product totals, unassigned and deterministic ties", async () => {
    const c = client();
    for (let i = 0; i < 35; i++)
      await add(c, "many-" + i, { customer: "Many", revenue: 101, cost: 1 });
    await add(c, "a", { customer: "A", revenue: 300, cost: 100 });
    await add(c, "b", { customer: "B", revenue: 300, cost: 100 });
    await add(c, "count-1", { customer: "Count", revenue: 100, cost: 0 });
    await add(c, "count-2", {
      customer: "Count",
      revenue: 100,
      cost: 0,
      productName: "另商品",
    });
    await add(c, "negative", { customer: "Loss", revenue: -100, cost: 50 });
    await add(c, "unassigned", { customer: "  ", revenue: 7, cost: 2 });
    await add(c, "previous", {
      customer: "Prior",
      date: "2026-09-30",
      revenue: 999999,
      cost: 0,
    });
    await add(c, "deleted", { customer: "Deleted", revenue: 999999, cost: 0 });
    await c.call("sales.delete", {
      id: "deleted",
      revision: 1,
      requestId: "delete",
    });
    const r = await c.call<CustomerRankingResult>("customers.ranking", {
      month: "2026-10",
      page: 999,
      search: "Prior",
    });
    expect(r.items.map((i) => i.name)).toEqual([
      "Many",
      "Count",
      "A",
      "B",
      "Loss",
    ]);
    expect(r.items.map((i) => i.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(r.items[0].products).toEqual([
      { name: "商品", profit: 3500, count: 35 },
    ]);
    expect(r.items.at(-1)!.totals.profit).toBe(-150);
    expect(r.unassigned).toEqual({ revenue: 7, cost: 2, profit: 5, count: 1 });
    expect(r.totals).toEqual({
      revenue: 4242,
      cost: 287,
      profit: 3955,
      count: 41,
    });
    const previous = await c.call<CustomerRankingResult>("customers.ranking", {
      month: "2026-09",
    });
    expect(previous.items.map((i) => i.name)).toEqual(["Prior"]);
    expect(
      (
        await c.call<CustomerRankingResult>("customers.ranking", {
          month: "2026-08",
        })
      ).totals.count,
    ).toBe(0);
    await expect(
      c.call("customers.ranking", { month: "2026-13" }),
    ).rejects.toThrow("月份");
  });

  it("keeps money and original IDs unchanged across mixed alias merges, chains and unmerges", async () => {
    const c = client();
    for (const name of ["Alpha", "Alias", "Third"]) {
      await add(c, "oct-" + name, { customer: name });
      await add(c, "sep-" + name, {
        customer: name,
        date: "2026-09-01",
        productName: "历史商品",
      });
    }
    const originals = await c.store.list<Sale>("sales");
    const totals = (
      await c.call<CustomerRankingResult>("customers.ranking", {
        month: "2026-10",
      })
    ).totals;
    await merge(c, "Alias", "Alpha", "merge-1");
    await merge(c, "Alpha", "Third", "merge-2");
    const profiles = await c.call<Customer[]>("customers.list");
    expect(profiles).toHaveLength(3);
    expect(
      resolveCustomerId(profiles, (await customerId("Alias", hash))!),
    ).toBe(await customerId("Third", hash));
    const detail = await c.call<CustomerDetail>("customers.detail", {
      id: await customerId("Alias", hash),
      month: "all",
    });
    expect(detail.customer.name).toBe("Third");
    expect(detail.aliases).toEqual(["Alias", "Alpha"]);
    expect(detail.totals.count).toBe(6);
    expect(detail.products).toHaveLength(2);
    expect(detail).not.toHaveProperty("tasks");
    const r = await c.call<CustomerRankingResult>("customers.ranking", {
      month: "2026-10",
    });
    expect(r.items).toHaveLength(1);
    expect(r.totals).toEqual(totals);
    await c.call("customers.unmerge", {
      sourceId: await customerId("Alpha", hash),
      revision: 2,
      requestId: "unmerge-1",
    });
    const split = await c.call<CustomerRankingResult>("customers.ranking", {
      month: "2026-10",
    });
    expect(split.items.map((i) => i.name)).toEqual(["Alpha", "Third"]);
    expect(split.items[0].aliases).toEqual(["Alias"]);
    await c.call("customers.unmerge", {
      id: await customerId("Alias", hash),
      revision: 2,
      requestId: "unmerge-2",
    });
    expect(
      (
        await c.call<CustomerRankingResult>("customers.ranking", {
          month: "2026-10",
        })
      ).totals,
    ).toEqual(totals);
    expect(await c.store.list("sales")).toEqual(originals);
    expect(
      (
        await c.call<CustomerDetail>("customers.detail", {
          id: await customerId("Alias", hash),
          month: "2026-09",
        })
      ).totals.count,
    ).toBe(1);
  });

  it("rejects redirect cycles and stale revisions, and keeps old retries harmless after subsequent mutations", async () => {
    const c = client();
    for (const name of ["Alpha", "Alias", "Third"])
      await add(c, name, { customer: name });
    const first = await merge(c, "Alias", "Alpha");
    await expect(merge(c, "Alpha", "Alias", "cycle")).rejects.toThrow("循环");
    await expect(merge(c, "Alias", "Alias", "self", 2)).rejects.toThrow("循环");
    await expect(merge(c, "Alias", "Third", "stale")).rejects.toThrow("另一处");
    await c.call("customers.unmerge", {
      sourceId: first.id,
      revision: 2,
      requestId: "undo",
    });
    expect(await merge(c, "Alias", "Alpha")).toEqual(first);
    expect(
      (await c.store.get<Customer>("customers", first.id))!.mergedInto,
    ).toBeNull();
    await expect(merge(c, "Alias", "Third")).rejects.toThrow("请求编号");
    const concurrent = await Promise.allSettled([
      merge(c, "Alias", "Alpha", "ab", 3),
      merge(c, "Alpha", "Alias", "ba", 1),
    ]);
    expect(concurrent.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("independent customer tasks", () => {
  it("interprets plain dates as Beijing days, including yesterday UTC16:00 and excluding the next midnight", async () => {
    const c = client();
    await add(c, "sale");
    const previous = await task(c, "previous-day", "Alpha", {
      at: "2026-09-30T15:59:59.999Z",
    });
    const start = await task(c, "beijing-midnight", "Alpha", {
      at: "2026-09-30T16:00:00.000Z",
    });
    const end = await task(c, "beijing-end", "Alpha", {
      at: "2026-10-01T15:59:59.999Z",
    });
    const next = await task(c, "next-midnight", "Alpha", {
      at: "2026-10-01T16:00:00.000Z",
    });
    expect(
      await c.call("tasks.list", { from: "2026-10-01", to: "2026-10-01" }),
    ).toEqual([start, end]);
    expect(await c.call("tasks.list", { from: "2026-10-01" })).toEqual([
      start,
      end,
      next,
    ]);
    expect(await c.call("tasks.list", { to: "2026-10-01" })).toEqual([
      previous,
      start,
      end,
    ]);
    expect(
      await c.call("tasks.list", {
        from: "2026-09-30T16:00:00Z",
        to: "2026-10-01T15:59:59.999Z",
      }),
    ).toEqual([start, end]);
    expect(
      await c.call("tasks.list", { from: "2026-10-01", to: "2026-10-02" }),
    ).toEqual([start, end, next]);
  });
  it("creates once under concurrent retries, validates UTC/customer inputs, and rejects reused request IDs", async () => {
    const c = client();
    await add(c, "sale");
    const copies = await Promise.all(Array.from({ length: 8 }, () => task(c)));
    expect(await c.store.list("tasks")).toHaveLength(1);
    expect(
      copies.every(
        (t) => t.revision === 1 && t.at === "2026-11-01T04:00:00.000Z",
      ),
    ).toBe(true);
    expect(typeof copies[0].reminderGeneration).toBe("string");
    expect(copies[0].reminderStartAt).toBe(c.ctx.now!());
    await expect(task(c, "task", "Alpha", { title: "改了" })).rejects.toThrow(
      "请求编号",
    );
    await expect(task(c, "invalid-customer", "missing")).rejects.toThrow(
      "客户不存在",
    );
    for (const at of [
      "2026-02-30T00:00:00Z",
      "2026-11-01T12:00:00+08:00",
      "not-time",
    ])
      await expect(task(c, "bad-time", "Alpha", { at })).rejects.toThrow("UTC");
    await expect(task(c, "bad-title", "Alpha", { title: " " })).rejects.toThrow(
      "标题",
    );
    await expect(
      task(c, "bad-reminder", "Alpha", { reminder: "email" }),
    ).rejects.toThrow("提醒");
  });

  it("lists all dates independently of sales month and resolves alias roots through merge and unmerge", async () => {
    const c = client();
    await add(c, "sale");
    await add(c, "alias-sale", { customer: "Alias" });
    const a = await task(c, "jan", "Alpha", { at: "2027-01-01T00:00:00Z" });
    const b = await task(c, "sep", "Alias", { at: "2026-09-01T15:59:59.999Z" });
    await c.call("tasks.complete", {
      id: a.id,
      revision: 1,
      requestId: "complete",
    });
    await merge(c, "Alias", "Alpha");
    for (const name of ["Alias", "Alpha"])
      expect(
        await c.call("tasks.list", {
          customerId: await customerId(name, hash),
          month: "2026-10",
        }),
      ).toHaveLength(2);
    expect(
      await c.call("tasks.list", { from: "2026-09-01", to: "2026-09-01" }),
    ).toEqual([b]);
    expect(
      await c.call("tasks.list", {
        from: "2026-09-01T15:59:59.999Z",
        to: "2026-09-01T15:59:59.999Z",
      }),
    ).toEqual([b]);
    await c.call("customers.unmerge", {
      sourceId: b.customerId,
      revision: 2,
      requestId: "split",
    });
    expect(await c.call("tasks.list", { customerId: b.customerId })).toEqual([
      b,
    ]);
    await c.call("tasks.delete", {
      id: b.id,
      revision: 1,
      requestId: "delete",
    });
    expect(await c.call("tasks.list", { customerId: b.customerId })).toEqual(
      [],
    );
    expect(await c.call("tasks.list", { deleted: true })).toHaveLength(1);
    expect(
      (await c.call<CustomerTask>("tasks.get", { id: b.id })).deletedAt,
    ).toBeTruthy();
    await expect(
      c.call("tasks.list", { from: "2027-01-01", to: "2026-01-01" }),
    ).rejects.toThrow("日期");
    await expect(c.call("tasks.list", { deleted: "yes" })).rejects.toThrow(
      "筛选",
    );
  });

  it("preserves reminders on ordinary edits, regenerates only on reminder lifecycle changes, and enforces revisions", async () => {
    const c = client();
    await add(c, "sale");
    let current = await task(c);
    const original = current;
    c.time("2026-10-14T04:00:00.000Z");
    const feedback = {
      id: current.id,
      revision: 1,
      requestId: "feedback",
      task: { feedback: "有意向", nextAction: "报价", title: "更新标题" },
    };
    current = await c.call("tasks.update", feedback);
    expect(current.reminderGeneration).toBe(original.reminderGeneration);
    expect(current.reminderStartAt).toBe(original.reminderStartAt);
    await expect(
      c.call("tasks.update", { ...feedback, requestId: "stale" }),
    ).rejects.toThrow("另一处");
    for (const [action, patch] of [
      ["tasks.update", { at: "2026-09-01T00:00:00Z" }],
      ["tasks.update", { reminder: "due" }],
      ["tasks.complete", undefined],
      ["tasks.reopen", undefined],
      ["tasks.delete", undefined],
      ["tasks.restore", undefined],
    ] as const) {
      const prior = current;
      c.time("2026-10-15T04:00:00.000Z");
      const payload = {
        id: prior.id,
        revision: prior.revision,
        requestId: "change-" + prior.revision,
        task: patch,
      };
      current = await c.call(action, payload);
      expect(current.reminderGeneration).not.toBe(prior.reminderGeneration);
      expect(current.reminderStartAt).toBe(c.ctx.now!());
      expect(await c.call(action, payload)).toEqual(current);
      if (action === "tasks.delete")
        await expect(
          c.call("tasks.update", {
            id: current.id,
            revision: current.revision,
            requestId: "edit-deleted",
            task: { title: "x" },
          }),
        ).rejects.toThrow("恢复");
    }
    expect(current.completedAt).toBeNull();
    expect(current.deletedAt).toBeNull();
    expect(await c.call("tasks.update", feedback)).toMatchObject({
      revision: 2,
    });
    expect(
      await c.call("tasks.create", {
        requestId: "task",
        task: {
          customerId: original.customerId,
          at: "2026-11-01T04:00:00Z",
          title: "跟进",
          feedback: "",
          nextAction: "",
          reminder: "both",
        },
      }),
    ).toEqual(original);
    expect(await c.call("tasks.get", { id: current.id })).toEqual(current);
    await expect(
      c.call("tasks.complete", {
        id: current.id,
        revision: current.revision,
        requestId: "feedback",
      }),
    ).rejects.toThrow("请求编号");
  });

  it("does not regenerate on customer reassignment or a no-op time edit", async () => {
    const c = client();
    await add(c, "sale");
    await add(c, "other", { customer: "Other" });
    const original = await task(c);
    const changed = await c.call<CustomerTask>("tasks.update", {
      id: original.id,
      revision: 1,
      requestId: "assign",
      patch: {
        customerId: await customerId("Other", hash),
        at: "2026-11-01T04:00:00Z",
      },
    });
    expect(changed.reminderGeneration).toBe(original.reminderGeneration);
    expect(changed.reminderStartAt).toBe(original.reminderStartAt);
    expect(
      await c.call("tasks.list", { customerId: original.customerId }),
    ).toEqual([]);
  });
});

describe("backup v1/v2 and authorization", () => {
  it("restores v2 in chunks with exact customer mapping, task state and amounts, new reminder epochs, and no subscriptions", async () => {
    const source = client();
    await add(source, "sale");
    await add(source, "alias", { customer: "Alias" });
    await merge(source, "Alias", "Alpha");
    for (let i = 0; i < CHUNK_SIZE + 4; i++)
      await task(source, "task-" + i, i % 2 ? "Alpha" : "Alias");
    await source.call("tasks.complete", {
      id: "task-0",
      revision: 1,
      requestId: "complete",
    });
    await source.call("tasks.delete", {
      id: "task-1",
      revision: 1,
      requestId: "delete",
    });
    await source.store.put("subscriptions", "secret", {
      endpoint: "private",
      extraField: "extensible",
    });
    await source.store.put("deliveries", "sent", { arbitrary: true });
    const backup = await source.call<BackupV2>("backup");
    expect(backup.version).toBe(2);
    expect(backup).not.toHaveProperty("subscriptions");
    expect(backup).not.toHaveProperty("deliveries");
    const target = client();
    target.time("2026-12-01T04:00:00.000Z");
    expect((await target.call("backup.restore", { backup })).done).toBe(false);
    await expect(target.call("customers.list")).rejects.toThrow("正在恢复");
    await expect(target.call("tasks.list")).rejects.toThrow("正在恢复");
    await expect(
      target.call("tasks.complete", {
        id: "task-0",
        revision: 1,
        requestId: "blocked",
      }),
    ).rejects.toThrow("正在恢复");
    await expect(
      target.call("backup.restore", {
        backup: { ...backup, exportedAt: "2026-10-14T00:00:00Z" },
      }),
    ).rejects.toThrow("另一份");
    await finish(target, backup);
    const copy = await target.call<BackupV2>("backup");
    expect(copy.customers).toEqual(backup.customers);
    expect(copy.sales).toEqual(backup.sales);
    for (const old of backup.tasks) {
      const restored = copy.tasks.find((t) => t.id === old.id)!;
      expect(restored).toMatchObject({
        customerId: old.customerId,
        completedAt: old.completedAt,
        deletedAt: old.deletedAt,
        revision: old.revision,
        at: old.at,
      });
      expect(restored.reminderGeneration).not.toBe(old.reminderGeneration);
      expect(restored.reminderStartAt).toBe("2026-12-01T04:00:00.000Z");
    }
    expect((await finish(target, backup)).repeated).toBe(true);
    expect((await target.call<BackupV2>("backup")).tasks).toEqual(copy.tasks);
    expect(await target.store.list("subscriptions")).toEqual([]);
    expect(await target.store.list("deliveries")).toEqual([]);
    expect(
      (
        await target.call<CustomerRankingResult>("customers.ranking", {
          month: "2026-10",
        })
      ).totals,
    ).toEqual(
      (
        await source.call<CustomerRankingResult>("customers.ranking", {
          month: "2026-10",
        })
      ).totals,
    );
    await expect(source.call("backup.restore", { backup })).rejects.toThrow(
      "空账本",
    );
  });

  it("accepts v1, includes deleted historical customers and whitespace unassigned, and upgrades export to v2", async () => {
    const source = client();
    await add(source, "active");
    await add(source, "deleted", { customer: "Deleted" });
    await add(source, "empty", { customer: "  " });
    await source.call("sales.delete", {
      id: "deleted",
      revision: 1,
      requestId: "delete",
    });
    const b = await source.call<BackupV2>("backup");
    const v1 = {
      format: b.format,
      version: 1 as const,
      exportedAt: "2026-10-13T12:00:00+08:00",
      sales: b.sales,
      products: b.products,
    };
    expect(validateBackup(v1).version).toBe(1);
    const target = client();
    await finish(target, v1);
    const upgraded = await target.call<BackupV2>("backup");
    expect(upgraded.version).toBe(2);
    expect(upgraded.tasks).toEqual([]);
    expect(upgraded.customers.map((c) => c.name).sort()).toEqual([
      "Alpha",
      "Deleted",
    ]);
    expect(upgraded.sales).toEqual(b.sales);
  });

  it("rejects corrupt v2 customer graphs, mappings, timestamps and task references before restoring", async () => {
    const source = client();
    await add(source, "sale");
    await task(source);
    const b = await source.call<BackupV2>("backup");
    const variants = [
      { ...b, customers: [...b.customers, b.customers[0]] },
      {
        ...b,
        customers: [{ ...b.customers[0], mergedInto: b.customers[0].id }],
      },
      { ...b, customers: [{ ...b.customers[0], mergedInto: "missing" }] },
      { ...b, customers: [] },
      { ...b, tasks: [{ ...b.tasks[0], customerId: "missing" }] },
      { ...b, tasks: [{ ...b.tasks[0], reminderStartAt: "invalid" }] },
      { ...b, tasks: [{ ...b.tasks[0], completedAt: undefined }] },
      { ...b, customers: [{ ...b.customers[0], name: "Changed" }], sales: [] },
    ];
    for (const backup of variants) {
      const target = client();
      await expect(target.call("backup.restore", { backup })).rejects.toThrow();
      expect(await target.store.list("sales")).toEqual([]);
      expect(await target.store.list("tasks")).toEqual([]);
    }
    expect(
      validateBackup({
        ...b,
        subscriptions: [{ secret: true }],
        tasks: [{ ...b.tasks[0], injected: true }],
      }),
    ).not.toHaveProperty("subscriptions");
    expect(
      (
        validateBackup({
          ...b,
          tasks: [{ ...b.tasks[0], injected: true }],
        }) as BackupV2
      ).tasks[0],
    ).not.toHaveProperty("injected");
  });

  it("rolls back failed restore chunks and keeps reminder epochs stable when resuming later", async () => {
    const source = client();
    await add(source, "sale");
    for (let i = 0; i < 25; i++) await task(source, "t-" + i);
    const backup = await source.call<BackupV2>("backup"),
      target = client();
    target.time("2026-11-01T00:00:00.000Z");
    await target.call("backup.restore", { backup });
    const saved = structuredClone(target.store.data),
      put = target.store.put.bind(target.store);
    let writes = 0;
    target.store.put = async (collection, id, value) => {
      if (++writes === 3) throw new Error("write failed");
      await put(collection, id, value);
    };
    await expect(target.call("backup.restore", { backup })).rejects.toThrow(
      "write failed",
    );
    expect(target.store.data).toEqual(saved);
    target.store.put = put;
    target.time("2026-11-02T00:00:00.000Z");
    await finish(target, backup);
    expect(
      (await target.store.list<CustomerTask>("tasks")).every(
        (t) => t.reminderStartAt === "2026-11-01T00:00:00.000Z",
      ),
    ).toBe(true);
  });

  it("refuses nonempty customer/task ledgers even when all sales were removed", async () => {
    const source = client();
    await add(source, "sale");
    await task(source);
    const b = await source.call<BackupV2>("backup");
    source.store.data.sales = {};
    source.store.data.batches = {};
    await expect(source.call("backup.restore", { backup: b })).rejects.toThrow(
      "空账本",
    );
  });

  it("checks the fixed owner before every new action or database access", async () => {
    for (const uid of [null, "other"])
      for (const action of [
        "customers.list",
        "customers.ranking",
        "customers.detail",
        "customers.merge",
        "customers.unmerge",
        "customers.suggestions",
        "customers.mergeMany",
        "sales.purge",
        "tasks.purge",
        "tasks.list",
        "tasks.get",
        "tasks.create",
        "tasks.update",
        "tasks.complete",
        "tasks.reopen",
        "tasks.delete",
        "tasks.restore",
        "backup",
        "backup.restore",
      ]) {
        const c = client(),
          get = vi.spyOn(c.store, "get"),
          list = vi.spyOn(c.store, "list"),
          tx = vi.spyOn(c.store, "transaction");
        await expect(
          execute(c.store, { ...c.ctx, uid }, action, {
            ownerUid: "other",
            uid: "owner",
          }),
        ).rejects.toThrow("无权");
        expect(get).not.toHaveBeenCalled();
        expect(list).not.toHaveBeenCalled();
        expect(tx).not.toHaveBeenCalled();
      }
    const c = client();
    await expect(
      execute(c.store, { ...c.ctx, ownerUid: "" }, "tasks.list"),
    ).rejects.toThrow("绑定");
  });
});
