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
  it("预设不含受限措辞", () => {
    expect(NEED_PRESETS.concat(OCCUPATION_PRESETS).join()).not.toMatch(/梯子|翻墙|VPN|科学上网/i);
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
