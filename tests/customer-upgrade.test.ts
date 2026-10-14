import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../server/memory-store";
import { execute, type Context } from "../server/service";
import type {
  Customer,
  CustomerRankingResult,
  CustomerSuggestionGroup,
  Sale,
  SaleInput,
} from "../src/domain/model";
import {
  customerKey,
  customerId,
  customerSuggestions,
  displayCustomerName,
  parseRankPeriod,
  periodSales,
  rankPeriodLabel,
  rankPeriodMonths,
  shiftRankPeriod,
} from "../src/domain/customers";

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
  return { store, ctx, call, time: (v: string) => (time = v) };
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

describe("customer name normalization", () => {
  it("strips leading ✅ and trailing IP markers without touching other digits", () => {
    expect(displayCustomerName("✅李德嘉")).toBe("李德嘉");
    expect(displayCustomerName("✅✅ 李德嘉")).toBe("李德嘉");
    expect(displayCustomerName("李德嘉 63.124.162.53")).toBe("李德嘉");
    expect(displayCustomerName("李德嘉63.124.162.53")).toBe("李德嘉");
    expect(displayCustomerName("Rika48.45.32.85")).toBe("Rika");
    expect(displayCustomerName("63.124.162.53")).toBe("63.124.162.53");
    expect(displayCustomerName("李德嘉2026")).toBe("李德嘉2026");
    expect(displayCustomerName("  Alpha ")).toBe("Alpha");
    expect(displayCustomerName("A✅  B✅")).toBe("A  B");
    expect(displayCustomerName("A999.999.999.999")).toBe("A999.999.999.999");
    expect(customerKey("✅Faith63.124.162.1")).toBe(customerKey("Faith"));
  });
});

describe("ranking periods", () => {
  it("parses, labels and shifts every period type across year boundaries", () => {
    expect(parseRankPeriod("all")).toEqual({ type: "all" });
    expect(parseRankPeriod("2026-10")).toEqual({
      type: "month",
      value: "2026-10",
    });
    expect(parseRankPeriod({ type: "quarter", value: "2026-Q4" })).toEqual({
      type: "quarter",
      value: "2026-Q4",
    });
    expect(parseRankPeriod({ type: "half", value: "2026-H2" })).toEqual({
      type: "half",
      value: "2026-H2",
    });
    expect(parseRankPeriod({ type: "year", value: "2026" })).toEqual({
      type: "year",
      value: "2026",
    });
    expect(() => parseRankPeriod("2026-13")).toThrow("月份");
    expect(() =>
      parseRankPeriod({ type: "quarter", value: "2026-Q5" }),
    ).toThrow("周期");
    expect(shiftRankPeriod({ type: "month", value: "2026-12" }, 1)).toEqual({
      type: "month",
      value: "2027-01",
    });
    expect(shiftRankPeriod({ type: "quarter", value: "2026-Q4" }, 1)).toEqual({
      type: "quarter",
      value: "2027-Q1",
    });
    expect(shiftRankPeriod({ type: "half", value: "2026-H2" }, 1)).toEqual({
      type: "half",
      value: "2027-H1",
    });
    expect(shiftRankPeriod({ type: "year", value: "2026" }, 1)).toEqual({
      type: "year",
      value: "2027",
    });
    expect(shiftRankPeriod({ type: "all" }, 1)).toEqual({ type: "all" });
    expect(rankPeriodLabel({ type: "all" })).toContain("全部");
    expect(rankPeriodLabel({ type: "quarter", value: "2026-Q4" })).toBe(
      "2026年Q4（10-12月）",
    );
    expect(rankPeriodLabel({ type: "half", value: "2026-H1" })).toBe(
      "2026年上半年（1-6月）",
    );
    expect(rankPeriodMonths({ type: "quarter", value: "2026-Q1" })).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
    expect(rankPeriodMonths({ type: "half", value: "2026-H2" })).toHaveLength(
      6,
    );
    expect(rankPeriodMonths({ type: "year", value: "2026" })).toHaveLength(12);
  });

  it("filters sales per period, keeping zero and negative profit rows", () => {
    const archive = {
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      deletedAt: null,
      revision: 1,
    };
    const rows = [
      { ...base, id: "a", customer: "A", date: "2025-12-31" },
      { ...base, id: "b", customer: "B", date: "2026-01-15" },
      { ...base, id: "c", customer: "C", date: "2026-06-30" },
      { ...base, id: "d", customer: "D", date: "2026-10-05", revenue: 0 },
      {
        ...base,
        id: "e",
        customer: "E",
        date: "2026-12-20",
        revenue: 100,
        cost: 250,
      },
      {
        ...base,
        id: "f",
        customer: "F",
        date: "2026-08-01",
        deletedAt: "2026-08-02",
      },
    ].map((row) => ({ ...archive, ...row })) satisfies Sale[];
    expect(periodSales(rows, { type: "year", value: "2026" })).toHaveLength(4);
    expect(
      periodSales(rows, { type: "quarter", value: "2026-Q4" }),
    ).toHaveLength(2);
    expect(periodSales(rows, { type: "half", value: "2026-H1" })).toHaveLength(
      2,
    );
    expect(periodSales(rows, { type: "all" })).toHaveLength(5);
    expect(periodSales(rows, { type: "month", value: "2025-12" })).toHaveLength(
      1,
    );
  });

  it("ranks whole quarters, halves and years through the service", async () => {
    const c = client();
    await add(c, "q1", {
      customer: "Q1",
      date: "2026-02-01",
      revenue: 300,
      cost: 100,
    });
    await add(c, "q2", {
      customer: "Q2",
      date: "2026-05-01",
      revenue: 200,
      cost: 100,
    });
    await add(c, "q3", {
      customer: "Q3",
      date: "2026-10-01",
      revenue: 150,
      cost: 50,
    });
    await add(c, "q4", {
      customer: "Q4",
      date: "2026-12-01",
      revenue: 80,
      cost: 20,
    });
    const quarter = await c.call<CustomerRankingResult>("customers.ranking", {
      period: { type: "quarter", value: "2026-Q4" },
    });
    expect(quarter.items.map((i) => i.name)).toEqual(["Q3", "Q4"]);
    expect(quarter.totals.profit).toBe(160);
    const half = await c.call<CustomerRankingResult>("customers.ranking", {
      period: { type: "half", value: "2026-H2" },
    });
    expect(half.items.map((i) => i.name)).toEqual(["Q3", "Q4"]);
    const year = await c.call<CustomerRankingResult>("customers.ranking", {
      period: { type: "year", value: "2026" },
    });
    expect(year.items.map((i) => i.name)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(year.totals.count).toBe(4);
    const all = await c.call<CustomerRankingResult>("customers.ranking", {
      period: { type: "all" },
    });
    expect(all.totals.count).toBe(4);
    // Legacy month string still works.
    const legacy = await c.call<CustomerRankingResult>("customers.ranking", {
      month: "2026-10",
    });
    expect(legacy.items.map((i) => i.name)).toEqual(["Q3"]);
  });
});

describe("suggestion groups", () => {
  it("groups IP/✅ variants by key and case variants separately, preferring the busiest clean target", async () => {
    const c = client();
    const names = [
      "Faith",
      "faith",
      "Bob",
      "✅Bob 63.1.2.3",
      "Bob63.9.9.9",
      "Only",
    ];
    // Simulate the pre-upgrade archive: independent customer records per name.
    for (const name of names)
      await c.store.put<Customer>(
        "customers",
        (await customerId(name, hash))!,
        {
          id: (await customerId(name, hash))!,
          name,
          mergedInto: null,
          revision: 1,
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
        },
      );
    for (const [i, name] of names.entries()) {
      await add(c, "s-" + i, { customer: name });
      await add(c, "s2-" + i, { customer: name });
    }
    await add(c, "faith-extra", { customer: "faith" });
    const groups = await c.call<CustomerSuggestionGroup[]>(
      "customers.suggestions",
    );
    const byId = new Map(groups.map((g) => [g.reason, g]));
    expect(byId.get("ip_or_symbol")!.members).toHaveLength(3);
    expect(
      byId.get("ip_or_symbol")!.members.map((m) => m.customer.name),
    ).toEqual(expect.arrayContaining(["Bob", "✅Bob 63.1.2.3", "Bob63.9.9.9"]));
    expect(byId.get("ip_or_symbol")!.targetId).toBe(
      await customerId("Bob", hash),
    );
    const caseGroup = groups.find((g) => g.reason === "case")!;
    expect(caseGroup.members).toHaveLength(2);
    expect(caseGroup.members.map((m) => m.customer.name)).toEqual(
      expect.arrayContaining(["Faith", "faith"]),
    );
    // The busiest member wins: faith has 3 sales.
    expect(caseGroup.targetId).toBe(await customerId("faith", hash));
    expect(byId.get("ip_or_symbol")!.totals.count).toBe(6);
  });
});

describe("auto grouping, batch merge and purge", () => {
  it("groups variants created within one import batch and excludes pending import suggestions", async () => {
    const c = client();
    await c.call("import.commit", {
      digest: "a".repeat(64),
      fileName: "aliases.csv",
      rows: ["Alpha", "✅Alpha63.1.2.3"].map((customer, i) => ({
        ...base,
        customer,
        sourceRow: i + 2,
      })),
    });
    const ranking = await c.call<CustomerRankingResult>("customers.ranking", {
      period: { type: "all" },
    });
    expect(ranking.items).toHaveLength(1);
    expect(ranking.items[0].totals.count).toBe(2);
  });
  it("batch merge rolls back stale sources, preserves subtrees, and replays the same request", async () => {
    const c = client();
    for (const customer of ["A", "B", "C"])
      await add(c, `atomic-${customer}`, { customer });
    const a = (await customerId("A", hash))!,
      b = (await customerId("B", hash))!,
      cc = (await customerId("C", hash))!;
    await expect(
      c.call("customers.mergeMany", {
        requestId: "bad-revision",
        targetId: a,
        sources: [
          { id: b, revision: 1 },
          { id: cc, revision: 99 },
        ],
      }),
    ).rejects.toThrow("修改");
    expect(
      (await c.store.get<Customer>("customers", b))!.mergedInto,
    ).toBeNull();
    await c.call("customers.merge", {
      requestId: "subtree",
      sourceId: cc,
      targetId: b,
      revision: 1,
    });
    const payload = {
      requestId: "atomic-merge",
      targetId: a,
      sources: [{ id: b, revision: 1 }],
    };
    expect(await c.call("customers.mergeMany", payload)).toEqual({ merged: 1 });
    expect(await c.call("customers.mergeMany", payload)).toEqual({ merged: 1 });
    expect((await c.store.get<Customer>("customers", cc))!.mergedInto).toBe(b);
    await c.call("customers.unmerge", {
      requestId: "unmerge-subtree",
      id: b,
      revision: 2,
    });
    const ranking = await c.call<CustomerRankingResult>("customers.ranking", {
      period: { type: "all" },
    });
    expect(
      ranking.items.find((item) => item.customerId === b)!.totals.count,
    ).toBe(2);
  });
  it("attaches new name variants to the existing root on sale save, in both directions", async () => {
    const c = client();
    await add(c, "first", { customer: "李德嘉63.124.162.53" });
    await add(c, "second", { customer: "李德嘉" });
    const customers = await c.call<Customer[]>("customers.list");
    const ip = customers.find((x) => x.name === "李德嘉63.124.162.53")!;
    const clean = customers.find((x) => x.name === "李德嘉")!;
    expect(clean.mergedInto).toBe(ip.id);
    const ranking = await c.call<CustomerRankingResult>("customers.ranking", {
      month: "2026-10",
    });
    expect(ranking.items).toHaveLength(1);
    expect(ranking.items[0].totals.count).toBe(2);

    const d = client();
    await add(d, "clean-first", { customer: "Clean" });
    await add(d, "variant", { customer: "✅Clean 63.1.2.3" });
    const list = await d.call<Customer[]>("customers.list");
    expect(list.find((x) => x.name === "✅Clean 63.1.2.3")!.mergedInto).toBe(
      list.find((x) => x.name === "Clean")!.id,
    );
  });

  it("mergeMany validates revisions, blocks cycles and stays idempotent", async () => {
    const c = client();
    for (const name of ["A", "B", "C"])
      await add(c, "m-" + name, { customer: name });
    const ids = async (name: string) => customerId(name, hash);
    const a = await ids("A"),
      b = await ids("B"),
      cc = await ids("C");
    const result = await c.call("customers.mergeMany", {
      requestId: "many-1",
      targetId: a,
      sources: [
        { id: b, revision: 1 },
        { id: cc, revision: 1 },
      ],
    });
    expect(result).toEqual({ merged: 2 });
    // Idempotent replay returns merged 0 without error.
    expect(
      await c.call("customers.mergeMany", {
        requestId: "many-2",
        targetId: a,
        sources: [
          { id: b, revision: 2 },
          { id: cc, revision: 2 },
        ],
      }),
    ).toEqual({ merged: 0 });
    // Target must be an unmerged root; stale revisions are rejected.
    await expect(
      c.call("customers.mergeMany", {
        requestId: "many-3",
        targetId: b,
        sources: [{ id: a, revision: 1 }],
      }),
    ).rejects.toThrow("目标客户");
    await expect(
      c.call("customers.mergeMany", {
        requestId: "many-4",
        targetId: a,
        sources: [{ id: await ids("D"), revision: 1 }],
      }),
    ).rejects.toThrow("客户不存在");
  });

  it("purges only soft-deleted sales and tasks, with revision checks", async () => {
    const c = client();
    await add(c, "purge-sale", { customer: "Purge" });
    await expect(
      c.call("sales.purge", { id: "purge-sale", revision: 1, requestId: "p1" }),
    ).rejects.toThrow("回收站");
    await c.call("sales.delete", {
      id: "purge-sale",
      revision: 1,
      requestId: "del-1",
    });
    await expect(
      c.call("sales.purge", { id: "purge-sale", revision: 1, requestId: "p2" }),
    ).rejects.toThrow("已在另一处修改");
    expect(
      await c.call("sales.purge", {
        id: "purge-sale",
        revision: 2,
        requestId: "p3",
      }),
    ).toEqual({ purged: true });
    expect(await c.store.get("sales", "purge-sale")).toBeNull();
    await expect(add(c, "purge-sale", { customer: "Purge" })).rejects.toThrow(
      "已彻底删除",
    );

    const task = await c.call<{ id: string; revision: number }>(
      "tasks.create",
      {
        requestId: "purge-task",
        task: {
          customerId: await customerId("Purge", hash),
          at: "2026-11-01T04:00:00Z",
          title: "跟进",
          feedback: "",
          nextAction: "",
          reminder: "off",
        },
      },
    );
    await expect(
      c.call("tasks.purge", {
        id: task.id,
        revision: task.revision,
        requestId: "p4",
      }),
    ).rejects.toThrow("回收站");
    await c.call("tasks.delete", {
      id: task.id,
      revision: task.revision,
      requestId: "tdel",
    });
    expect(
      await c.call("tasks.purge", {
        id: task.id,
        revision: task.revision + 1,
        requestId: "p5",
      }),
    ).toEqual({ purged: true });
    expect(await c.store.get("tasks", task.id)).toBeNull();
  });
});
