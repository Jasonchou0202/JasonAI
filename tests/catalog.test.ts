import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { MemoryStore } from "../server/memory-store";
import { execute, type Context } from "../server/service";
import type {
  Customer,
  Product,
  CustomerTask,
  SaleInput,
  Backup,
} from "../src/domain/model";
import {
  customerChoices,
  matchesCustomer,
  groupProducts,
  productCatalog,
  isAcceptanceCustomer,
} from "../src/domain/catalog";
import { sortTasksTodayFirst } from "../src/domain/tasks";
const instant = "2026-10-14T04:00:00.000Z";
const ctx: Context = {
  uid: "owner",
  ownerUid: "owner",
  now: () => instant,
  hash: async (s) => createHash("sha256").update(s).digest("hex"),
};
const sale: SaleInput = {
  productName: "ChatGPT Plus",
  productId: "",
  customer: "小林",
  revenue: 1000,
  cost: 200,
  date: "2026-10-14",
  note: "",
};
const customer = (
  id: string,
  name: string,
  mergedInto: string | null = null,
): Customer => ({
  id,
  name,
  mergedInto,
  revision: 1,
  createdAt: instant,
  updatedAt: instant,
});
describe("customer and product directories", () => {
  it("shows each merged root once and searches every alias", () => {
    const choices = customerChoices([
      customer("root", "小林"),
      customer("alias", "林先生", "root"),
      customer("ip", "✅小林63.1.2.3", "alias"),
      { ...customer("fake", "虚构导入验收客户1"), archivedAt: instant },
    ]);
    expect(choices.map((c) => c.name)).toEqual(["小林"]);
    expect(matchesCustomer(choices[0], "林先生")).toBe(true);
    expect(matchesCustomer(choices[0], "不存在")).toBe(false);
    expect(isAcceptanceCustomer("张验收老师")).toBe(false);
  });
  it("groups presets and historical-only product names by type, excluding deleted sales", () => {
    const preset: Product = {
      id: "p",
      name: "Claude Max 5x",
      price: 10,
      cost: 2,
      order: 0,
      active: true,
    };
    const snapshot = {
      ...sale,
      id: "s",
      createdAt: instant,
      updatedAt: instant,
      revision: 1,
      deletedAt: null,
    };
    const products = productCatalog(
      [preset],
      [
        snapshot,
        {
          ...snapshot,
          id: "deleted",
          productName: "验收隐藏",
          deletedAt: instant,
        },
      ],
    );
    expect(products.map((p) => p.name)).toEqual([
      "ChatGPT Plus",
      "Claude Max 5x",
    ]);
    expect(
      groupProducts([
        { name: "Verizon D套餐" },
        { name: "ChatGPT Pro 20x" },
        { name: "ChatGPT Pro 5x" },
      ]).map((g) => g.items.map((p) => p.name)),
    ).toEqual([["ChatGPT Pro 5x", "ChatGPT Pro 20x"], ["Verizon D套餐"]]);
  });
  it("places all today's tasks first, using Beijing dates across midnight", () => {
    const tasks = [
      "2026-10-15T01:00:00Z",
      "2026-10-13T15:00:00Z",
      "2026-10-13T16:00:00Z",
      "2026-10-14T03:00:00Z",
    ].map((at, i) => ({ id: String(i), at }) as CustomerTask);
    expect(sortTasksTodayFirst(tasks, "2026-10-14").map((t) => t.id)).toEqual([
      "2",
      "3",
      "0",
      "1",
    ]);
  });
});
describe("acceptance-only cleanup", () => {
  it("is recoverable, idempotent and preserves sales and v2 backup flags", async () => {
    const store = new MemoryStore();
    const call = (action: string, payload = {}) =>
      execute(store, ctx, action, payload);
    await call("sales.create", {
      requestId: "fake-sale",
      sale: {
        ...sale,
        customer: "虚构导入验收客户1",
        productName: "虚构导入验收商品",
        productId: "fake-product",
      },
    });
    await call("sales.delete", {
      id: "fake-sale",
      revision: 1,
      requestId: "remove-sale",
    });
    await call("products.save", {
      id: "fake-product",
      name: "虚构导入验收商品",
      price: 10,
      cost: 2,
      order: 0,
      active: true,
    });
    const before = (await call("backup")) as Backup;
    expect(await call("catalog.cleanup", { requestId: "cleanup" })).toEqual({
      customers: 1,
      products: 1,
    });
    expect(await call("catalog.cleanup", { requestId: "cleanup" })).toEqual({
      customers: 1,
      products: 1,
    });
    expect(await call("customers.list")).toEqual([]);
    expect(await call("products.list")).toEqual([]);
    const backup = (await call("backup")) as Extract<Backup, { version: 2 }>;
    expect(backup.sales).toEqual(before.sales);
    expect(backup.customers[0].archivedAt).toBe(instant);
    expect(backup.products[0].archivedAt).toBe(instant);
    const restored = new MemoryStore();
    await execute(restored, ctx, "backup.restore", { backup });
    expect(await execute(restored, ctx, "customers.list")).toEqual([]);
    await call("catalog.restore", {
      requestId: "restore-c",
      kind: "customer",
      id: backup.customers[0].id,
    });
    await call("catalog.restore", {
      requestId: "restore-p",
      kind: "product",
      id: "fake-product",
    });
    expect((await call("customers.list")) as Customer[]).toHaveLength(1);
    expect((await call("products.list")) as Product[]).toHaveLength(1);
    await expect(
      execute(store, { ...ctx, uid: null }, "catalog.deleted"),
    ).rejects.toThrow("无权");
  });
  it("blocks cleanup of active sales, non-test merged groups, and any customer tasks", async () => {
    const store = new MemoryStore();
    const call = (action: string, payload = {}) =>
      execute(store, ctx, action, payload);
    await call("sales.create", {
      requestId: "fake-active",
      sale: { ...sale, customer: "虚构云端验收客户 ✅" },
    });
    await expect(
      call("catalog.cleanup", { requestId: "blocked" }),
    ).rejects.toThrow("仍关联");
    await call("sales.delete", {
      id: "fake-active",
      revision: 1,
      requestId: "remove-active",
    });
    const customers = (await call("customers.list")) as Customer[];
    await call("tasks.create", {
      requestId: "fake-task",
      task: {
        customerId: customers[0].id,
        at: instant,
        title: "不可丢失",
        feedback: "",
        nextAction: "",
        reminder: "off",
      },
    });
    await expect(
      call("catalog.cleanup", { requestId: "blocked-task" }),
    ).rejects.toThrow("仍关联");
  });
});
