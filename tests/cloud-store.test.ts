import { expect, it } from "vitest";
import { createRequire } from "node:module";
import { CloudStore, documentData } from "../server/cloud-store";
const require = createRequire(import.meta.url);
const set = require("../vendor/lodash-set/index.cjs"),
  unset = require("../vendor/lodash-unset/index.cjs");
it("normalizes CloudBase transaction and document result shapes", () => {
  expect(documentData({ data: [{ _id: "x", id: "x", amount: 50 }] })).toEqual({
    id: "x",
    amount: 50,
  });
  expect(documentData({ data: { _id: "x", id: "x" } })).toEqual({ id: "x" });
  expect(documentData({ data: [] })).toBe(null);
});
it("reads beyond a CloudBase database page without truncating statistics", async () => {
  const records = Array.from({ length: 305 }, (_, i) => ({
    _id: String(i).padStart(4, "0"),
    id: "s-" + i,
  }));
  const db = {
    command: { gt: (v: string) => v },
    collection: () => {
      let after = "";
      const q = {
        orderBy: () => q,
        limit: () => q,
        where: (condition: { _id: string }) => {
          after = condition._id;
          return q;
        },
        get: async () => ({
          data: records.filter((r) => r._id > after).slice(0, 100),
        }),
      };
      return q;
    },
  };
  expect(await new CloudStore(db).list("sales")).toHaveLength(305);
});
it("serializes transaction operations and stops queued writes after a failed operation", async () => {
  let active = 0,
    maximum = 0,
    fail = false;
  const writes: string[] = [];
  const operation = async (id: string, write: boolean) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await Promise.resolve();
    await Promise.resolve();
    active -= 1;
    if (fail) throw new Error("database failure");
    if (write) writes.push(id);
    return { data: { _id: id, id } };
  };
  const db = {
    runTransaction: (fn: (tx: any) => unknown) =>
      fn({
        collection: () => ({
          doc: (id: string) => ({
            get: () => operation(id, false),
            set: () => operation(id, true),
          }),
        }),
      }),
  };
  const store = new CloudStore(db);
  await store.transaction(async (tx) => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => tx.get("sales", String(i))),
    );
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        tx.put("sales", String(i), { id: String(i) }),
      ),
    );
  });
  expect(maximum).toBe(1);
  expect(writes).toHaveLength(20);
  fail = true;
  await expect(
    store.transaction((tx) =>
      Promise.all([
        tx.get("sales", "bad"),
        tx.put("sales", "must-not-write", {}),
      ]),
    ),
  ).rejects.toThrow("database failure");
  expect(writes).not.toContain("must-not-write");
});
it("patched legacy lodash adapters preserve operations and block prototype pollution", () => {
  const value = {};
  set(value, "a.b", 1);
  expect(value).toEqual({ a: { b: 1 } });
  unset(value, "a.b");
  expect(value).toEqual({ a: {} });
  set(value, "__proto__.salesPolluted", true);
  set(value, "constructor.prototype.salesPolluted", true);
  expect(({} as any).salesPolluted).toBeUndefined();
});
