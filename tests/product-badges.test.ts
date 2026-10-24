import { it, expect } from "vitest";
import { createHash } from "node:crypto";
import { MemoryStore } from "../server/memory-store";
import { execute, type Context } from "../server/service";
import type {
  Product,
  Customer,
  CustomerTask,
  Sale,
  CustomerRankingResult,
  Backup,
} from "../src/domain/model";
import { validateProduct } from "../src/domain/finance";
import { groupProducts } from "../src/domain/catalog";
import { validateBackup } from "../src/domain/import";
const time = "2026-10-14T04:00:00.000Z";
const ctx: Context = {
  uid: "owner",
  ownerUid: "owner",
  now: () => time,
  hash: async (s) => createHash("sha256").update(s).digest("hex"),
};
const product: Product = {
  id: "new-product",
  name: "新服务",
  category: "培训与教程",
  price: 0,
  cost: 0,
  hasDefaultPrice: false,
  hasDefaultCost: false,
  active: true,
  order: 0,
};
it("creates one product across simultaneous requests and reuses names without overwriting defaults", async () => {
  const store = new MemoryStore();
  const [a, b] = (await Promise.all([
    execute(store, ctx, "products.create", { requestId: "r1", product }),
    execute(store, ctx, "products.create", {
      requestId: "r2",
      product: {
        ...product,
        id: "second",
        name: " 新服务 ",
        price: 500,
        hasDefaultPrice: true,
      },
    }),
  ])) as { product: Product; reused: boolean }[];
  expect(a.product.id).toBe(b.product.id);
  expect(await store.list("products")).toHaveLength(1);
  expect(b.product.hasDefaultPrice).toBe(false);
  await execute(store, ctx, "products.save", {
    ...a.product,
    price: 200,
    hasDefaultPrice: true,
  });
  expect(
    await execute(store, ctx, "products.create", { requestId: "r1", product }),
  ).toEqual(a);
  await expect(
    execute(store, ctx, "products.create", {
      requestId: "r1",
      product: { ...product, name: "不同提交" },
    }),
  ).rejects.toThrow("请求编号");
  await expect(
    execute(store, { ...ctx, uid: null }, "products.create", {
      requestId: "unauthorized",
      product,
    }),
  ).rejects.toThrow("无权");
});
it("uses legacy presets, prevents inactive/archived duplicates and rejects duplicate rename", async () => {
  const store = new MemoryStore();
  await store.put("products", "old", {
    ...product,
    id: "old",
    name: "旧商品",
    price: 900,
    hasDefaultPrice: true,
  });
  const reused = (await execute(store, ctx, "products.create", {
    requestId: "legacy",
    product: { ...product, name: "旧商品" },
  })) as { product: Product };
  expect(reused.product.price).toBe(900);
  await store.put("products", "inactive", {
    ...product,
    id: "inactive",
    name: "已停用",
    active: false,
  });
  await expect(
    execute(store, ctx, "products.create", {
      requestId: "inactive-r",
      product: { ...product, name: "已停用" },
    }),
  ).rejects.toThrow("启用");
  await store.put("products", "archived", {
    ...product,
    id: "archived",
    name: "已删除",
    archivedAt: time,
  });
  await expect(
    execute(store, ctx, "products.create", {
      requestId: "archived-r",
      product: { ...product, name: "已删除" },
    }),
  ).rejects.toThrow("恢复");
  await expect(
    execute(store, ctx, "products.save", { ...product, name: "旧商品" }),
  ).rejects.toThrow("同名");
});
it("preserves optional defaults and manual categories through v2 backup/restore, and validates metadata", async () => {
  const store = new MemoryStore();
  await execute(store, ctx, "products.create", {
    requestId: "create",
    product: { ...product, name: "ChatGPT 培训" },
  });
  const backup = validateBackup(
    (await execute(store, ctx, "backup")) as Backup,
  );
  expect(backup.products[0]).toMatchObject({
    category: "培训与教程",
    hasDefaultPrice: false,
    hasDefaultCost: false,
  });
  expect(groupProducts(backup.products)[0].category).toBe("培训与教程");
  const restored = new MemoryStore();
  await execute(restored, ctx, "backup.restore", {
    requestId: "restore",
    backup,
  });
  expect(await restored.get("products", product.id)).toEqual(
    backup.products[0],
  );
  expect(() => validateProduct({ ...product, category: "不存在" })).toThrow(
    "类目",
  );
  expect(() =>
    validateProduct({ ...product, hasDefaultCost: "false" as any }),
  ).toThrow("标记");
  const { category, hasDefaultCost, hasDefaultPrice, ...legacy } = product;
  expect(validateProduct(legacy)).not.toHaveProperty("hasDefaultPrice");
});
it("counts all pending tasks once per merged root regardless of ranking period, and updates after unmerge", async () => {
  const store = new MemoryStore();
  const c = (
    id: string,
    name: string,
    mergedInto: string | null = null,
  ): Customer => ({
    id,
    name,
    mergedInto,
    createdAt: time,
    updatedAt: time,
    revision: 1,
  });
  await store.put("customers", "root", c("root", "客户"));
  await store.put("customers", "alias", c("alias", "别名", "root"));
  const sale: Sale = {
    id: "sale",
    productId: "",
    productName: "服务",
    customer: "客户",
    date: "2026-10-14",
    revenue: 500,
    cost: 100,
    note: "",
    createdAt: time,
    updatedAt: time,
    deletedAt: null,
    revision: 1,
  };
  await store.put("sales", sale.id, sale);
  await store.put("sales", "alias-sale", {
    ...sale,
    id: "alias-sale",
    customer: "别名",
  });
  for (const [id, customerId, at, completedAt, deletedAt] of [
    ["old", "root", "2025-01-01T00:00:00Z", null, null],
    ["future", "alias", "2027-01-01T00:00:00Z", null, null],
    ["done", "alias", time, time, null],
    ["deleted", "root", time, null, time],
  ] as const)
    await store.put("tasks", id, {
      id,
      customerId,
      at,
      completedAt,
      deletedAt,
      title: id,
      feedback: "",
      nextAction: "",
      reminder: "off",
      createdAt: time,
      updatedAt: time,
      revision: 1,
      reminderGeneration: "generation",
      reminderStartAt: time,
    } satisfies CustomerTask);
  for (const period of [
    { type: "all" },
    { type: "month", value: "2026-10" },
    { type: "quarter", value: "2026-Q4" },
    { type: "half", value: "2026-H2" },
    { type: "year", value: "2026" },
  ]) {
    const rank = (await execute(store, ctx, "customers.ranking", {
      period,
    })) as CustomerRankingResult;
    expect(rank.items[0].pendingTaskCount).toBe(2);
  }
  await execute(store, ctx, "customers.unmerge", {
    requestId: "unmerge",
    id: "alias",
    revision: 1,
  });
  const rank = (await execute(
    store,
    ctx,
    "customers.ranking",
    {},
  )) as CustomerRankingResult;
  expect(rank.items.map((i) => i.pendingTaskCount)).toEqual([1, 1]);
});
it("offers Grok as the 3rd category, accepts it server-side, and never auto-assigns it", async () => {
  const { productCategories, productCategory } = await import("../src/domain/catalog");
  expect(productCategories.slice(0, 4)).toEqual(["ChatGPT", "Claude", "Grok", "Gemini"]);
  expect(validateProduct({ ...product, category: "Grok" }).category).toBe("Grok");
  expect(productCategory("Grok 会员")).toBe("其他");
});
