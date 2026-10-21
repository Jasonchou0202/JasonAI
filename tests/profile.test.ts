import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../server/memory-store";
import { execute, type Context } from "../server/service";
import { monthsAgo, needShares, purchaseStatus, validateProfile, NEED_PRESETS, OCCUPATION_PRESETS } from "../src/domain/profile";
import type { Customer } from "../src/domain/model";

describe("复购 / 断购", () => {
  const t = "2026-10-21";
  it("连续每月都买、最近在本月或上月 → 复购", () => {
    expect(purchaseStatus(["2026-08-03", "2026-09-10", "2026-10-01"], t)).toBe("repeat");
    expect(purchaseStatus(["2026-08-03", "2026-09-10"], t)).toBe("repeat");
  });
  it("只有一个付款月份且未断购 → 新客", () => {
    expect(purchaseStatus(["2026-10-01", "2026-10-05"], t)).toBe("new");
    expect(purchaseStatus(["2026-08-21"], t)).toBe("new");
  });
  it("中间空月、或最近付款不在本月/上月 → 无标签", () => {
    expect(purchaseStatus(["2026-08-25", "2026-09-01"], "2026-11-01")).toBeNull();
    expect(purchaseStatus(["2026-07-01", "2026-09-10", "2026-10-01"], t)).toBeNull();
  });
  it("最近付款早于两个月前的同一天 → 断购；恰好两个月整不算", () => {
    expect(monthsAgo(t, 2)).toBe("2026-08-21");
    expect(purchaseStatus(["2026-08-20"], t)).toBe("lapsed");
    expect(purchaseStatus(["2026-08-21"], t)).toBe("new");
    expect(purchaseStatus(["2026-06-01", "2026-07-01", "2026-08-01"], t)).toBe("lapsed");
    expect(monthsAgo("2026-12-31", 2)).toBe("2026-10-31");
    expect(monthsAgo("2026-04-30", 2)).toBe("2026-02-28");
  });
  it("没有付款 → 无标签", () => expect(purchaseStatus([], t)).toBeNull());
});

describe("需求占比", () => {
  it("分母为记录了需求的客户", () => {
    const r = needShares([{ needs: ["A", "B"] }, { needs: ["A"] }, {}, undefined, { needs: [] }]);
    expect(r.total).toBe(2);
    expect(r.rows).toEqual([{ need: "A", count: 2, pct: 100 }, { need: "B", count: 1, pct: 50 }]);
    expect(needShares([]).rows).toEqual([]);
  });
});

describe("客户画像", () => {
  it("预设不含受限措辞（只存措辞的 SHA-256，不在仓库里写明文）", () => {
    const banned = new Set([
      "4b3aad803aeacfc88cc1752717cbc8d26e600b06274eaa0004d4485bc7983b05",
      "5d4bb2acf46133c9c75b4474eda2f492a8505836578c2dce75a2364517023822",
      "ebf20cefc9169e0b714703d63d480c3e63c64a8535a13acf5a62ea66c5f0ea8c",
      "518a075fe40fb3209fcc989ed10232db4c77b1da04aed3446c6b1ac849b8cfc1",
    ]);
    const sha = (s: string) => createHash("sha256").update(s).digest("hex");
    for (const text of [...NEED_PRESETS, ...OCCUPATION_PRESETS].map((t) => t.toLowerCase()))
      for (let i = 0; i < text.length; i++)
        for (let n = 2; n <= 4 && i + n <= text.length; n++)
          expect(banned.has(sha(text.slice(i, i + n)))).toBe(false);
  });
  it("校验：丢弃多余字段、去重、拒绝非法付款方式", () => {
    expect(validateProfile({ occupation: " 律师 ", needs: ["A", "A"], payment: "微信支付", x: 1 })).toEqual({ occupation: "律师", needs: ["A"], payment: "微信支付" });
    expect(() => validateProfile({ payment: "微信" })).toThrow("付款方式无效");
    expect(() => validateProfile({ payment: "比特币" })).toThrow("付款方式无效");
    expect(() => validateProfile([])).toThrow();
  });
  const hash = async (s: string) => createHash("sha256").update(s).digest("hex");
  const ctx: Context = { uid: "owner", ownerUid: "owner", hash, now: () => "2026-10-21T10:00:00.000Z" };
  it("customers.profile.save 只改 profile，其余字段不变；非所有者拒绝；备份保留画像", async () => {
    const store = new MemoryStore();
    await execute(store, ctx, "sales.create", { requestId: "r1", sale: { productId: "", productName: "Plus 会员", customer: "李德嘉", date: "2026-10-01", revenue: 1000, cost: 100, note: "" } });
    const list = await execute(store, ctx, "customers.list", {}) as Customer[];
    expect(list).toHaveLength(1);
    const c = list[0];
    const saved = await execute(store, ctx, "customers.profile.save", { id: c.id, revision: c.revision, requestId: "p1", profile: { occupation: "律师", needs: ["Agent 学习"], payment: "支付宝支付" } }) as Customer;
    expect(saved).toEqual({ ...c, profile: { occupation: "律师", needs: ["Agent 学习"], payment: "支付宝支付" }, revision: c.revision + 1, updatedAt: "2026-10-21T10:00:00.000Z", lastMutation: "p1" });
    await expect(execute(store, { ...ctx, uid: "other" }, "customers.profile.save", { id: c.id, revision: saved.revision, requestId: "p2", profile: {} })).rejects.toThrow();
    await expect(execute(store, ctx, "customers.profile.save", { id: c.id, revision: c.revision, requestId: "p3", profile: {} })).rejects.toThrow("另一处修改");
    const backup = await execute(store, ctx, "backup", {}) as { customers: Customer[] };
    expect(backup.customers[0].profile).toEqual(saved.profile);
  });
});

import { mergeProfiles } from "../src/domain/profile";
describe("合并客户时并入信息", () => {
  it("需求并集、目标优先职业/付款、需求记录拼接", () => {
    expect(mergeProfiles({ occupation: "律师", needs: ["A"], needNote: "甲" }, { occupation: "医生", needs: ["A", "B"], needNote: "乙", payment: "闲鱼支付" }))
      .toEqual({ occupation: "律师", needs: ["A", "B"], needNote: "甲\n——\n乙", payment: "闲鱼支付" });
    expect(mergeProfiles(undefined, { needs: ["A"] })).toEqual({ needs: ["A"] });
    expect(mergeProfiles({ needs: ["A"] }, undefined)).toEqual({ needs: ["A"] });
  });
  it("需求记录去控制字符、版本号必须是整数", async () => {
    expect(validateProfile({ needNote: "a\u0007b\nc" })).toEqual({ needNote: "ab\nc" });
  });
  const hash = async (s: string) => createHash("sha256").update(s).digest("hex");
  const ctx: Context = { uid: "o", ownerUid: "o", hash, now: () => "2026-10-21T10:00:00.000Z" };
  async function setup() {
    const store = new MemoryStore();
    for (const [i, name] of ["老王", "王总", "王哥"].entries())
      await execute(store, ctx, "sales.create", { requestId: "s" + i, sale: { productId: "", productName: "P", customer: name, date: "2026-10-01", revenue: 100, cost: 10, note: "" } });
    const list = await execute(store, ctx, "customers.list", {}) as Customer[];
    const by = (n: string) => list.find((c) => c.name === n)!;
    const save = async (c: Customer, profile: object, r: string) =>
      execute(store, ctx, "customers.profile.save", { id: c.id, revision: c.revision, requestId: r, profile }) as Promise<Customer>;
    const a = await save(by("老王"), { occupation: "律师", needs: ["A"], needNote: "甲" }, "p1");
    const b = await save(by("王总"), { occupation: "医生", needs: ["B"], needNote: "乙", payment: "微信支付" }, "p2");
    const c = await save(by("王哥"), { needs: ["C", "A"] }, "p3");
    return { store, a, b, c, get: async (id: string) => (await execute(store, ctx, "customers.list", {}) as Customer[]).find((x) => x.id === id)! };
  }
  it("customers.merge 把来源信息并到目标，来源保持原样；撤销合并后目标保留合并结果", async () => {
    const { store, a, b, get } = await setup();
    await expect(execute(store, ctx, "customers.profile.save", { id: a.id, revision: "2", requestId: "bad", profile: {} })).rejects.toThrow("客户版本无效");
    await execute(store, ctx, "customers.merge", { sourceId: b.id, targetId: a.id, revision: b.revision, requestId: "m1" });
    expect((await get(a.id)).profile).toEqual({ occupation: "律师", needs: ["A", "B"], needNote: "甲\n——\n乙", payment: "微信支付" });
    expect((await get(b.id)).profile).toEqual(b.profile);
    const src = await get(b.id);
    await execute(store, ctx, "customers.unmerge", { id: b.id, revision: src.revision, requestId: "u1" });
    expect((await get(a.id)).profile?.needs).toEqual(["A", "B"]);
    expect((await get(b.id)).profile).toEqual(b.profile);
  });
  it("customers.mergeMany 逐个并入、重试幂等", async () => {
    const { store, a, b, c, get } = await setup();
    const payload = { targetId: a.id, sources: [{ id: b.id, revision: b.revision }, { id: c.id, revision: c.revision }], requestId: "mm" };
    await execute(store, ctx, "customers.mergeMany", payload);
    await execute(store, ctx, "customers.mergeMany", payload);
    expect((await get(a.id)).profile).toEqual({ occupation: "律师", needs: ["A", "B", "C"], needNote: "甲\n——\n乙", payment: "微信支付" });
  });
});

import { needSharesByRoot } from "../src/domain/profile";
it("需求占比按根客户统计、并入已合并客户", () => {
  const r = needSharesByRoot([
    { id: "a", mergedInto: null, profile: { needs: ["A"] } },
    { id: "b", mergedInto: "a", profile: { needs: ["A", "B"] } },
    { id: "c", mergedInto: null, profile: { needs: ["B"] } },
    { id: "d", mergedInto: null, archivedAt: "2026-10-01T00:00:00.000Z", profile: { needs: ["Z"] } },
  ]);
  expect(r.total).toBe(2);
  expect(r.rows).toEqual([{ need: "B", count: 2, pct: 100 }, { need: "A", count: 1, pct: 50 }]);
});
