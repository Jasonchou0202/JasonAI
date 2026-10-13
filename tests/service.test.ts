import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../server/memory-store";
import { execute, CHUNK_SIZE, type Context } from "../server/service";
import { handle } from "../server/handler";
import type {
  Backup,
  Dashboard,
  ImportRow,
  Sale,
  SalesPage,
} from "../src/domain/model";
const hash = async (s: string) => createHash("sha256").update(s).digest("hex");
const context: Context = {
  uid: "fixed-owner",
  ownerUid: "fixed-owner",
  now: () => "2026-10-12T04:00:00Z",
  hash,
};
const sale = {
  productId: "",
  productName: "示例商品",
  customer: "✅示例客户 1.2.3.4",
  date: "2026-10-12",
  revenue: 10050,
  cost: 2025,
  note: "",
};
function client(store = new MemoryStore()) {
  return {
    store,
    call: <T>(action: string, p: unknown = {}) =>
      execute(store, context, action, p) as Promise<T>,
  };
}
async function finish<T>(
  call: (action: string, p: unknown) => Promise<T>,
  action: string,
  p: unknown,
) {
  let r: any;
  do {
    r = await call(action, p);
  } while (!r.done);
  return r;
}
function imports(count: number): ImportRow[] {
  return Array.from({ length: count }, (_, i) => ({
    ...sale,
    sourceRow: i + 2,
    sourceProfit: sale.revenue - sale.cost,
  }));
}
describe("private cloud business operations", () => {
  it("diagnoses SDK errors without exposing payload or provider messages", async () => {
    const codes: string[] = [];
    const store = new MemoryStore();
    store.list = async () => {
      throw { code: "DATABASE_TRANSACTION_FAIL", message: "private payload" };
    };
    const result = await handle(
      () => store,
      context,
      { action: "dashboard" },
      (code) => codes.push(code),
    );
    expect(result).toEqual({
      ok: false,
      code: "DATABASE_TRANSACTION_FAIL",
      error: "云端操作未完成，请稍后重试",
    });
    expect(codes).toEqual(["DATABASE_TRANSACTION_FAIL"]);
    store.list = async () => {
      throw { code: "private payload" };
    };
    await handle(
      () => store,
      context,
      { action: "dashboard" },
      (code) => codes.push(code),
    );
    expect(codes).toHaveLength(1);
  });
  it("rejects every action for guests and other accounts without touching the database", async () => {
    for (const uid of [null, "other"])
      for (const action of [
        "session",
        "dashboard",
        "sales.list",
        "sales.get",
        "customers",
        "products.list",
        "products.save",
        "sales.create",
        "sales.update",
        "sales.delete",
        "sales.restore",
        "import.preview",
        "import.commit",
        "export",
        "backup",
        "backup.restore",
      ]) {
        const result = await handle(
          () => {
            throw new Error("Database must not be initialized");
          },
          { ...context, uid },
          { action, payload: { uid: "fixed-owner" }, uid: "fixed-owner" },
        );
        expect(result).toEqual({ ok: false, error: "无权访问这个私人账本" });
      }
    expect(
      await handle(
        () => new MemoryStore(),
        { ...context, ownerUid: "" },
        { action: "session" },
      ),
    ).toEqual({ ok: false, error: "后台尚未绑定所有者，暂不允许访问" });
  });
  it("creates just one sale on concurrent clicks and response-loss retries", async () => {
    const c = client(),
      payload = { requestId: "one-request", sale };
    await Promise.all(
      Array.from({ length: 8 }, () => c.call("sales.create", payload)),
    );
    expect((await c.call<SalesPage>("sales.list")).total).toBe(1);
    await expect(
      c.call("sales.create", { ...payload, sale: { ...sale, revenue: 20000 } }),
    ).rejects.toThrow("保存已完成");
    expect((await c.call<Dashboard>("dashboard")).today.profit).toBe(8025);
  });
  it("updates, soft deletes and restores, checking revision conflicts and idempotent mutation retries", async () => {
    const c = client();
    await c.call("sales.create", { requestId: "s", sale });
    const change = {
      id: "s",
      revision: 1,
      requestId: "edit-1",
      sale: { ...sale, revenue: 0 },
    };
    const row = await c.call<Sale>("sales.update", change);
    expect(row.revision).toBe(2);
    expect((await c.call<Sale>("sales.update", change)).revision).toBe(2);
    await expect(
      c.call("sales.update", { ...change, requestId: "edit-2" }),
    ).rejects.toThrow("另一处修改");
    const deleted = await c.call<Sale>("sales.delete", {
      id: "s",
      revision: 2,
      requestId: "delete-1",
    });
    expect((await c.call<Dashboard>("dashboard")).all.count).toBe(0);
    expect(
      (await c.call<SalesPage>("sales.list", { deleted: true })).total,
    ).toBe(1);
    await c.call("sales.restore", {
      id: "s",
      revision: deleted.revision,
      requestId: "restore-1",
    });
    expect((await c.call<Dashboard>("dashboard")).all.profit).toBe(-2025);
  });
  it("keeps totals over all filtered pages rather than the current 30 rows", async () => {
    const c = client();
    for (let i = 0; i < 65; i++)
      await c.call("sales.create", { requestId: "r-" + i, sale });
    const page = await c.call<SalesPage>("sales.list", {
      page: 3,
      search: "1.2.3.4",
    });
    expect(page.items).toHaveLength(5);
    expect(page.total).toBe(65);
    expect(page.totals.profit).toBe(65 * 8025);
    expect(await c.call<Sale[]>("export")).toHaveLength(65);
    await expect(
      c.call("sales.list", { from: "2026-10-13", to: "2026-10-12" }),
    ).rejects.toThrow();
  });
  it("commits imports in resumable batches, hides incomplete sales, and preserves equal real orders", async () => {
    const c = client(),
      payload = {
        rows: imports(CHUNK_SIZE + 3),
        digest: "a".repeat(64),
        fileName: "sample.csv",
      };
    const first = await c.call<any>("import.commit", payload);
    expect(first.done).toBe(false);
    expect(first.processed).toBe(CHUNK_SIZE);
    expect((await c.call<Dashboard>("dashboard")).all.count).toBe(0);
    await expect(c.call("backup")).rejects.toThrow("完成");
    await finish(c.call, "import.commit", payload);
    expect((await c.call<SalesPage>("sales.list")).total).toBe(CHUNK_SIZE + 3);
    const repeated = await finish(c.call, "import.commit", payload);
    expect(repeated.repeated).toBe(true);
    expect((await c.call<Dashboard>("dashboard")).all.count).toBe(
      CHUNK_SIZE + 3,
    );
    const preview = await c.call<any>("import.preview", {
      ...payload,
      digest: "b".repeat(64),
    });
    expect(preview.duplicateRows).toHaveLength(CHUNK_SIZE + 3);
    await finish(c.call, "import.commit", {
      ...payload,
      digest: "b".repeat(64),
    });
    expect((await c.call<Dashboard>("dashboard")).all.count).toBe(
      (CHUNK_SIZE + 3) * 2,
    );
    expect((await c.call<Sale[]>("export"))[0].customer).toBe(sale.customer);
  });
  it("rejects formula tampering, row collisions and changed contents under the same file hash", async () => {
    const c = client(),
      payload = {
        rows: imports(1),
        digest: "c".repeat(64),
        fileName: "sample.csv",
      };
    await expect(
      c.call("import.commit", {
        ...payload,
        rows: [{ ...payload.rows[0], sourceProfit: 0 }],
      }),
    ).rejects.toThrow("利润不一致");
    await expect(
      c.call("import.commit", {
        ...payload,
        rows: [payload.rows[0], payload.rows[0]],
      }),
    ).rejects.toThrow("行号");
    await finish(c.call, "import.commit", payload);
    await expect(
      c.call("import.commit", {
        ...payload,
        rows: [{ ...payload.rows[0], customer: "改过的客户" }],
      }),
    ).rejects.toThrow("内容发生变化");
  });
  it("backs up and restores all amounts and deleted rows, without overwriting a nonempty ledger", async () => {
    const source = client();
    for (let i = 0; i < 45; i++)
      await source.call("sales.create", { requestId: "s-" + i, sale });
    await source.call("sales.delete", {
      id: "s-0",
      revision: 1,
      requestId: "delete-0",
    });
    const b = await source.call<Backup>("backup"),
      target = client();
    expect((await target.call<any>("backup.restore", { backup: b })).done).toBe(
      false,
    );
    await expect(
      target.call("sales.create", { requestId: "blocked", sale }),
    ).rejects.toThrow("正在恢复");
    await finish(target.call, "backup.restore", { backup: b });
    const copy = await target.call<Backup>("backup");
    expect(copy.sales).toEqual(b.sales);
    expect(copy.products).toEqual(b.products);
    expect((await target.call<Dashboard>("dashboard")).all).toEqual(
      (await source.call<Dashboard>("dashboard")).all,
    );
    expect(
      (await finish(target.call, "backup.restore", { backup: b })).repeated,
    ).toBe(true);
    await expect(source.call("backup.restore", { backup: b })).rejects.toThrow(
      "空账本",
    );
  });
  it("rolls back failed transactions and permits a clean retry", async () => {
    const c = client();
    await expect(
      c.store.transaction(async (tx) => {
        await tx.put("sales", "s", sale);
        throw new Error("simulated network failure");
      }),
    ).rejects.toThrow();
    expect(await c.store.list("sales")).toHaveLength(0);
    await c.call("sales.create", { requestId: "s", sale });
    expect((await c.call<SalesPage>("sales.list")).total).toBe(1);
  });
  it("does not overwrite edited imported records when the original file is reimported after backup recovery", async () => {
    const source = client(),
      payload = {
        rows: imports(1),
        digest: "d".repeat(64),
        fileName: "sample.csv",
      };
    await finish(source.call, "import.commit", payload);
    const original = (await source.call<Sale[]>("export"))[0];
    await source.call("sales.update", {
      id: original.id,
      revision: 1,
      requestId: "edit",
      sale: { ...sale, revenue: 123 },
    });
    const target = client(),
      backup = await source.call<Backup>("backup");
    await finish(target.call, "backup.restore", { backup });
    await finish(target.call, "import.commit", payload);
    expect((await target.call<SalesPage>("sales.list")).total).toBe(1);
    expect((await target.call<Sale[]>("export"))[0].revenue).toBe(123);
  });
});
