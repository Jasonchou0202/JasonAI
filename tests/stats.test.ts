import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../server/memory-store";
import {
  dailyStats,
  handleStats,
  newCustomersByDay,
  readOnly,
  tokenMatches,
  type HttpResponse,
} from "../server/stats";
import type { Collection } from "../server/service";
import type { Customer, ImportBatch, Sale } from "../src/domain/model";

const T = "2026-10-01T00:00:00.000Z";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const id = (name: string) => "c_" + sha(name);
const NOW = new Date("2026-10-19T04:46:00Z"); // 北京时间 2026-10-19 12:46
const TODAY = "2026-10-19";
const DAYS = [
  "2026-10-13",
  "2026-10-14",
  "2026-10-15",
  "2026-10-16",
  "2026-10-17",
  "2026-10-18",
  "2026-10-19",
];
let n = 0;
function sale(customer: string, date: string, extra: Partial<Sale> = {}): Sale {
  return {
    id: "s" + n++,
    productId: "",
    productName: "示例商品",
    customer,
    date,
    revenue: 100,
    cost: 0,
    note: "",
    createdAt: T,
    updatedAt: T,
    deletedAt: null,
    revision: 1,
    ...extra,
  };
}
function customer(name: string, extra: Partial<Customer> = {}): Customer {
  return {
    id: id(name),
    name,
    mergedInto: null,
    revision: 1,
    createdAt: T,
    updatedAt: T,
    ...extra,
  };
}
const count = (
  customers: Customer[],
  sales: Sale[],
  batches: ImportBatch[] = [],
) => Object.fromEntries(newCustomersByDay(customers, sales, batches, DAYS));

describe("新客户定义", () => {
  it("counts a customer on the date of its earliest sale only", () => {
    const r = count(
      [customer("甲"), customer("乙")],
      [sale("甲", "2026-10-15"), sale("甲", TODAY), sale("乙", TODAY)],
    );
    expect(r["2026-10-15"]).toBe(1);
    expect(r[TODAY]).toBe(1);
  });
  it("merged aliases belong to their root: an alias's sale is not a new customer", () => {
    const root = customer("小林");
    const alias = customer("林同学", { mergedInto: root.id });
    const chained = customer("小林2", { mergedInto: alias.id });
    const r = count(
      [root, alias, chained],
      [
        sale("小林", "2026-10-14"),
        sale("林同学", TODAY),
        sale("小林2", "2026-10-18"),
      ],
    );
    expect(r["2026-10-14"]).toBe(1);
    expect(r[TODAY]).toBe(0);
    expect(r["2026-10-18"]).toBe(0);
  });
  it("✅ and trailing-IP variants without a document map to the existing customer", () => {
    const r = count(
      [customer("小王")],
      [
        sale("小王", "2026-10-13"),
        sale("✅小王", TODAY),
        sale("小王 63.1.2.3", "2026-10-18"),
      ],
    );
    expect(r["2026-10-13"]).toBe(1);
    expect(r[TODAY]).toBe(0);
    expect(r["2026-10-18"]).toBe(0);
  });
  it("variants with no document at all form one group by their cleaned name", () => {
    const r = count(
      [],
      [
        sale("✅阿远 1.2.3.4", TODAY),
        sale("阿远", TODAY),
        sale("✅阿远", "2026-10-17"),
      ],
    );
    expect(r["2026-10-17"]).toBe(1);
    expect(r[TODAY]).toBe(0);
  });
  it("ignores deleted sales and sales from unfinished imports", () => {
    const r = count(
      [customer("丙"), customer("丁")],
      [
        sale("丙", "2026-10-13", { deletedAt: T }),
        sale("丙", TODAY),
        sale("丁", "2026-10-14", { importBatch: "b-pending" }),
        sale("丁", "2026-10-16", { importBatch: "b-done" }),
      ],
      [
        { id: "b-pending", status: "pending" } as ImportBatch,
        { id: "b-done", status: "complete" } as ImportBatch,
      ],
    );
    expect(r["2026-10-13"]).toBe(0);
    expect(r[TODAY]).toBe(1);
    expect(r["2026-10-14"]).toBe(0);
    expect(r["2026-10-16"]).toBe(1);
  });
  it("a backdated earlier sale means the customer is not new today", () => {
    const r = count(
      [customer("戊")],
      [
        sale("戊", TODAY),
        sale("戊", "2026-05-01", { createdAt: NOW.toISOString() }),
      ],
    );
    expect(Object.values(r).reduce((a, b) => a + b, 0)).toBe(0);
  });
  it("excludes blank customer names", () => {
    const r = count([], [sale("", TODAY), sale("   ", TODAY)]);
    expect(r[TODAY]).toBe(0);
  });
  it("excludes customers whose root profile was deleted (archived), but not archived aliases", () => {
    const gone = customer("己", { archivedAt: T });
    const root = customer("庚");
    const alias = customer("庚哥", { mergedInto: root.id, archivedAt: T });
    const r = count(
      [gone, root, alias],
      [sale("己", TODAY), sale("✅己", TODAY), sale("庚哥", TODAY)],
    );
    expect(r[TODAY]).toBe(1);
  });
});

function seeded() {
  const store = new MemoryStore();
  const root = customer("小林");
  store.data.customers[root.id] = root;
  const alias = customer("✅小林 1.2.3.4", { mergedInto: root.id });
  store.data.customers[alias.id] = alias;
  for (const s of [
    sale("小林", "2026-10-15"),
    sale("✅小林 1.2.3.4", TODAY),
    sale("新朋友", TODAY),
    sale("未建档客户", "2026-10-17"),
  ])
    store.data.sales[s.id] = s;
  return store;
}
/** 记录所有写入调用的仓库，用来证明统计不写任何数据 */
function spy(store: MemoryStore) {
  const writes: string[] = [];
  const reads: string[] = [];
  const wrapped = {
    list: (c: Collection) => {
      reads.push(c);
      return store.list(c);
    },
    get: (c: Collection, i: string) => {
      reads.push(c + "/" + i);
      return store.get(c, i);
    },
    put: async (c: Collection) => {
      writes.push("put " + c);
    },
    del: async (c: Collection) => {
      writes.push("del " + c);
    },
    transaction: async () => {
      writes.push("transaction");
    },
  };
  return { wrapped, writes, reads };
}

describe("只读每日统计", () => {
  it("returns only asOf and 7 days of new_customers, oldest first, in Beijing time", async () => {
    const r = await dailyStats(readOnly(seeded()), NOW);
    expect(Object.keys(r).sort()).toEqual(["asOf", "days"]);
    expect(r.asOf).toBe("2026-10-19T12:46:00+08:00");
    expect(r.days.map((d) => d.date)).toEqual(DAYS);
    for (const d of r.days)
      expect(Object.keys(d).sort()).toEqual(["date", "new_customers"]);
    expect(r.days.find((d) => d.date === "2026-10-15")!.new_customers).toBe(1);
    expect(r.days.find((d) => d.date === "2026-10-17")!.new_customers).toBe(1);
    expect(r.days.find((d) => d.date === TODAY)!.new_customers).toBe(1);
    expect(JSON.stringify(r)).not.toMatch(/小林|新朋友|未建档|c_|revenue|100/);
  });
  it("uses the Beijing calendar day just after midnight", async () => {
    const r = await dailyStats(
      readOnly(new MemoryStore()),
      new Date("2026-10-18T16:30:00Z"),
    );
    expect(r.days.at(-1)!.date).toBe("2026-10-19");
    expect(r.asOf).toBe("2026-10-19T00:30:00+08:00");
  });
  it("performs zero writes and leaves the data unchanged", async () => {
    const store = seeded();
    const before = structuredClone(store.data);
    const { wrapped, writes, reads } = spy(store);
    await dailyStats(readOnly(wrapped), NOW);
    const token = "t".repeat(40);
    await handleStats(
      {
        httpMethod: "GET",
        headers: { Authorization: "Bearer " + token },
      },
      { STATS_TOKEN_SHA256: sha(token) },
      () => readOnly(wrapped),
      () => NOW,
    );
    expect(writes).toEqual([]);
    expect(new Set(reads)).toEqual(new Set(["customers", "sales", "batches"]));
    expect(store.data).toEqual(before);
  });
  it("the read-only wrapper throws on any write method and limits collections and size", async () => {
    const r = readOnly(new MemoryStore()) as Record<string, any>;
    for (const m of ["put", "del", "transaction", "get"])
      expect(() => r[m]("customers", "x", {})).toThrow(/只读/);
    await expect(r.list("tasks")).rejects.toThrow(/不读取/);
    const big = new MemoryStore();
    for (let i = 0; i < 3; i++) big.data.sales["s" + i] = sale("x", TODAY);
    await expect(readOnly(big, 2).list("sales")).rejects.toThrow(/上限/);
  });
});

describe("令牌与调用方式", () => {
  const token = "k".repeat(48);
  const env = { STATS_TOKEN_SHA256: sha(token) };
  const call = (event: unknown, e: { STATS_TOKEN_SHA256?: string } = env) =>
    handleStats(
      event,
      e,
      () => readOnly(seeded()),
      () => NOW,
    );
  const get = (headers: Record<string, string> = {}, extra = {}) =>
    call({ httpMethod: "GET", headers, ...extra }) as Promise<HttpResponse>;

  it("refuses everything when the env var is missing or malformed", async () => {
    for (const e of [
      {},
      { STATS_TOKEN_SHA256: "" },
      { STATS_TOKEN_SHA256: "abc" },
    ]) {
      const http = (await call(
        { httpMethod: "GET", headers: { authorization: "Bearer " + token } },
        e,
      )) as HttpResponse;
      expect(http.statusCode).toBe(503);
      expect(await call({ token }, e)).toEqual({
        ok: false,
        error: "统计接口未启用",
      });
    }
    expect(tokenMatches(token, undefined)).toBe(false);
  });
  it("rejects a missing, wrong or malformed token with 401 and no data", async () => {
    for (const h of [
      {} as Record<string, string>,
      { authorization: "Bearer " + "x".repeat(48) },
      { authorization: token },
      { authorization: "Bearer short" },
    ]) {
      const r = await get(h);
      expect(r.statusCode).toBe(401);
      expect(r.body).not.toMatch(/days/);
    }
    // 令牌放在网址参数里不被接受
    const q = await get({}, { queryStringParameters: { token } });
    expect(q.statusCode).toBe(401);
    expect(await call({ token: "x".repeat(48) })).toEqual({
      ok: false,
      error: "未授权",
    });
  });
  it("accepts the right token over HTTP GET with no CORS headers and no caching", async () => {
    const r = await get({ Authorization: "Bearer " + token });
    expect(r.statusCode).toBe(200);
    expect(r.headers["Cache-Control"]).toBe("no-store");
    expect(Object.keys(r.headers).some((k) => /access-control/i.test(k))).toBe(
      false,
    );
    const body = JSON.parse(r.body);
    expect(body.days).toHaveLength(7);
  });
  it("only allows GET over HTTP", async () => {
    const r = (await call({
      httpMethod: "POST",
      headers: { authorization: "Bearer " + token },
    })) as HttpResponse;
    expect(r.statusCode).toBe(405);
  });
  it("works through callFunction with { token }", async () => {
    const r = (await call({ token })) as { ok: boolean; data: unknown };
    expect(r.ok).toBe(true);
    expect((r.data as { days: unknown[] }).days).toHaveLength(7);
  });
  it("hides internal errors", async () => {
    const r = (await handleStats(
      { httpMethod: "GET", headers: { authorization: "Bearer " + token } },
      env,
      () =>
        readOnly({
          list: async () => {
            throw new Error("内部细节 c_123");
          },
        }),
      () => NOW,
    )) as HttpResponse;
    expect(r.statusCode).toBe(500);
    expect(r.body).not.toMatch(/c_123/);
  });
});
