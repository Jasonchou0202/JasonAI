import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../server/memory-store";
import { handle } from "../server/handler";
import type { Context, Store } from "../server/service";
import { customerId } from "../src/domain/customers";
import {
  appendOnly,
  auditSync,
  guardAudit,
  AUDIT_COLLECTION,
  DenyThrottle,
  type AuditEntry,
} from "../server/audit";
import { MEMBER_ACTIONS, type TeamConfig } from "../server/team";
import { handleSync } from "../server/task-sync";

// 全部是虚构的人名和数据
const OWNER = "uid-owner";
const ALICE = "uid-alice";
const BOB = "uid-bob";
const STRANGER = "uid-stranger";
const NOW = "2026-11-12T04:00:00.000Z";
const hash = async (s: string) => createHash("sha256").update(s).digest("hex");
const ON: TeamConfig = { membersEnabled: true, auditEnabled: true };
const OFF: TeamConfig = { membersEnabled: false, auditEnabled: false };
const sale = (customer = "示例客户·甲") => ({
  productId: "",
  productName: "示例商品",
  customer,
  date: "2026-11-12",
  revenue: 10000,
  cost: 4000,
  note: "虚构",
});
function ctx(uid: string | null): Context {
  return { uid, ownerUid: OWNER, now: () => NOW, hash };
}
function caller(store: MemoryStore, team: TeamConfig | undefined, warn?: (c: string) => void, at?: () => string) {
  // 每个用例独立的节流器，互不影响
  const t = team && { ...team, throttle: new DenyThrottle() };
  return (uid: string | null, action: string, payload: unknown = {}) =>
    handle(() => store, { ...ctx(uid), ...(at ? { now: at } : {}) }, { action, payload }, warn, undefined, t) as Promise<any>;
}
const logs = (s: MemoryStore) =>
  Object.values(s.data.audit_logs) as AuditEntry[];
function activeMember(s: MemoryStore, uid: string, name: string, status = "active") {
  s.data.members[uid] = {
    uid, name, status, inviteId: "inv_x", createdAt: NOW, updatedAt: NOW, revision: 1,
  };
}
async function taskInput(name: string) {
  return {
    customerId: await customerId(name, hash),
    at: "2026-11-20T04:00:00Z",
    title: "回访",
    feedback: "",
    nextAction: "",
    reminder: "off",
  };
}

describe("开关关闭：行为与现在完全一致", () => {
  async function script(team: TeamConfig | undefined) {
    const s = new MemoryStore();
    const call = caller(s, team);
    const out: unknown[] = [];
    out.push(await call(OWNER, "session"));
    out.push(await call(OWNER, "sales.create", { requestId: "s1", sale: sale() }));
    out.push(await call(OWNER, "sales.update", { id: "s1", requestId: "u1", revision: 1, sale: { ...sale(), revenue: 12000 } }));
    out.push(await call(OWNER, "tasks.create", { requestId: "t1", task: await taskInput("示例客户·甲") }));
    out.push(await call(OWNER, "sales.delete", { id: "s1", requestId: "d1", revision: 2 }));
    out.push(await call(OWNER, "dashboard"));
    out.push(await call(STRANGER, "sales.list"));
    out.push(await call(null, "dashboard"));
    out.push(await call(OWNER, "members.me"));
    out.push(await call(OWNER, "audit.list"));
    return { out, data: s.data };
  }
  it("两个开关都关 = 不传开关（原有路径），返回值和库内数据逐项相同", async () => {
    const legacy = await script(undefined);
    const off = await script(OFF);
    expect(off.out).toEqual(legacy.out);
    expect(off.data).toEqual(legacy.data);
  });
  it("关闭时：外人照旧被拒（同一句话）、不写 createdBy、不建成员/日志数据、新 action 不存在", async () => {
    const { out, data } = await script(OFF);
    expect(out[6]).toEqual({ ok: false, error: "无权访问这个私人账本" });
    expect(out[7]).toEqual({ ok: false, error: "无权访问这个私人账本" });
    expect(out[8]).toEqual({ ok: false, code: "UNSUPPORTED_ACTION", error: "不支持的操作" });
    expect(out[9]).toEqual({ ok: false, code: "UNSUPPORTED_ACTION", error: "不支持的操作" });
    expect(data.members).toEqual({});
    expect(data.invites).toEqual({});
    expect(data.audit_logs).toEqual({});
    expect(JSON.stringify(data)).not.toContain("createdBy");
  });
  it("只开日志不开成员：外人仍被拒，管理员数据不带 createdBy", async () => {
    const s = new MemoryStore();
    const call = caller(s, { membersEnabled: false, auditEnabled: true });
    expect(await call(STRANGER, "dashboard")).toMatchObject({ ok: false, error: "无权访问这个私人账本" });
    expect((await call(OWNER, "sales.create", { requestId: "s1", sale: sale() })).ok).toBe(true);
    expect(JSON.stringify(s.data.sales)).not.toContain("createdBy");
    expect(logs(s).map((l) => [l.action, l.result])).toEqual(
      expect.arrayContaining([["dashboard", "denied"], ["sales.create", "ok"]]),
    );
  });
});

describe("OWNER_UID 兜底", () => {
  it("members 集合读写全坏，管理员照样能用全部功能（先判 OWNER_UID，不查库）", async () => {
    const s = new MemoryStore();
    const get = s.get.bind(s);
    s.get = (async (c: string, id: string) => {
      if (c === "members" || c === "invites") throw new Error("members broken");
      return get(c as never, id);
    }) as Store["get"];
    const call = caller(s, ON);
    expect(await call(OWNER, "session")).toEqual({ ok: true, data: { uid: OWNER, role: "admin", name: "管理员" } });
    expect((await call(OWNER, "sales.create", { requestId: "s1", sale: sale() })).ok).toBe(true);
    expect((await call(OWNER, "sales.delete", { id: "s1", requestId: "d1", revision: 1 })).ok).toBe(true);
    expect((await call(OWNER, "sales.purge", { id: "s1", requestId: "p1", revision: 2 })).ok).toBe(true);
    expect((await call(OWNER, "export")).ok).toBe(true);
  });
  it("成员表里伪造一条管理员本人的停用记录也锁不住，管理员也不能被停用", async () => {
    const s = new MemoryStore();
    activeMember(s, OWNER, "伪造", "disabled");
    const call = caller(s, ON);
    expect((await call(OWNER, "dashboard")).ok).toBe(true);
    expect(await call(OWNER, "members.disable", { uid: OWNER })).toMatchObject({ ok: false, error: "不能修改管理员本人" });
  });
});

describe("成员越权：云端拒绝并记 denied", () => {
  const ADMIN_ONLY = [
    "sales.restore", "sales.purge", "tasks.restore", "tasks.purge",
    "customers.merge", "customers.unmerge", "customers.mergeMany",
    "catalog.cleanup.preview", "catalog.cleanup", "catalog.deleted", "catalog.restore",
    "products.create", "products.save", "import.preview", "import.commit",
    "backup", "backup.restore",
    "push.config", "push.subscribe", "push.status", "push.unsubscribe", "push.test",
    "members.list", "members.invite.create", "members.invite.revoke",
    "members.approve", "members.disable", "members.enable",
    "content.daily.save", "something.new",
  ];
  it("成员白名单之外的每个 action 都拒绝，且每次都留一条 denied 日志", async () => {
    const s = new MemoryStore();
    activeMember(s, ALICE, "小甲");
    const call = caller(s, ON);
    for (const action of ADMIN_ONLY) {
      expect(MEMBER_ACTIONS.has(action)).toBe(false);
      const r = await call(ALICE, action, { id: "x", uid: BOB, name: "x", kind: "customer" });
      expect(r, action).toMatchObject({ ok: false });
      expect(["ADMIN_ONLY"]).toContain(r.code);
    }
    const denied = logs(s).filter((l) => l.result === "denied");
    expect(denied.map((l) => l.action).sort()).toEqual([...ADMIN_ONLY].sort());
    for (const l of denied) expect(l).toMatchObject({ actorUid: ALICE, actorName: "小甲", role: "member" });
  });
  it("回收站只给管理员：成员看回收站被拒", async () => {
    const s = new MemoryStore();
    activeMember(s, ALICE, "小甲");
    const r = await caller(s, ON)(ALICE, "sales.list", { deleted: true });
    expect(r).toMatchObject({ ok: false, code: "ADMIN_ONLY" });
  });
  it("未入队、待批准、已停用的人：业务全部拒绝，只能查自己状态/兑换邀请", async () => {
    const s = new MemoryStore();
    activeMember(s, ALICE, "小甲", "pending");
    activeMember(s, BOB, "小乙", "disabled");
    const call = caller(s, ON);
    expect(await call(STRANGER, "dashboard")).toMatchObject({ ok: false, code: "NOT_MEMBER" });
    expect(await call(ALICE, "dashboard")).toMatchObject({ ok: false, code: "MEMBER_PENDING" });
    expect(await call(BOB, "sales.create", { requestId: "s1", sale: sale() })).toMatchObject({ ok: false, code: "MEMBER_DISABLED" });
    expect(s.data.sales).toEqual({});
    expect((await call(ALICE, "members.me")).data).toMatchObject({ role: "none", status: "pending" });
    expect((await call(STRANGER, "members.me")).data).toMatchObject({ role: "none", status: "none" });
  });
});

describe("成员读写业务数据", () => {
  async function setup() {
    const s = new MemoryStore();
    activeMember(s, ALICE, "小甲");
    activeMember(s, BOB, "小乙");
    const call = caller(s, ON);
    // 旧数据：没有 createdBy
    s.data.sales.legacy = { ...sale("示例客户·乙"), id: "legacy", createdAt: NOW, updatedAt: NOW, deletedAt: null, revision: 1 };
    return { s, call };
  }
  it("能看全部客户和利润；能记一笔；createdBy 由云端写入，前端传的不算", async () => {
    const { s, call } = await setup();
    expect((await call(ALICE, "dashboard")).ok).toBe(true);
    expect((await call(ALICE, "customers.list")).ok).toBe(true);
    const r = await call(ALICE, "sales.create", { requestId: "a1", sale: { ...sale(), createdBy: BOB } });
    expect(r.ok).toBe(true);
    expect((s.data.sales.a1 as any).createdBy).toBe(ALICE);
    expect((await call(OWNER, "sales.create", { requestId: "o1", sale: sale() })).ok).toBe(true);
    expect((s.data.sales.o1 as any).createdBy).toBe(OWNER);
  });
  it("只能删除/修改自己录的：别人录的、旧数据（无录入人=管理员）都拒绝；删了进回收站", async () => {
    const { s, call } = await setup();
    await call(ALICE, "sales.create", { requestId: "a1", sale: sale() });
    await call(BOB, "sales.create", { requestId: "b1", sale: sale() });
    expect(await call(ALICE, "sales.delete", { id: "b1", requestId: "x1", revision: 1 })).toMatchObject({ ok: false, code: "NOT_OWNER_OF_RECORD" });
    expect(await call(ALICE, "sales.delete", { id: "legacy", requestId: "x2", revision: 1 })).toMatchObject({ ok: false, code: "NOT_OWNER_OF_RECORD" });
    expect(await call(ALICE, "sales.update", { id: "b1", requestId: "x3", revision: 1, sale: sale() })).toMatchObject({ ok: false, code: "NOT_OWNER_OF_RECORD" });
    expect((s.data.sales.b1 as any).deletedAt).toBeNull();
    expect((s.data.sales.legacy as any).deletedAt).toBeNull();
    const del = await call(ALICE, "sales.delete", { id: "a1", requestId: "x4", revision: 1 });
    expect(del.ok).toBe(true);
    expect((s.data.sales.a1 as any).deletedAt).toBe(NOW);
    expect(s.data.sales.a1).toBeDefined(); // 软删，记录还在
    expect(await call(ALICE, "sales.restore", { id: "a1", requestId: "x5", revision: 2 })).toMatchObject({ ok: false, code: "ADMIN_ONLY" });
    expect((await call(OWNER, "sales.delete", { id: "b1", requestId: "x6", revision: 1 })).ok).toBe(true);
  });
  it("日程：成员可建、可改/完成别人的，但只能删自己建的", async () => {
    const { s, call } = await setup();
    await call(OWNER, "sales.create", { requestId: "o1", sale: sale() });
    const input = await taskInput("示例客户·甲");
    expect((await call(BOB, "tasks.create", { requestId: "tb", task: input })).ok).toBe(true);
    expect((s.data.tasks.tb as any).createdBy).toBe(BOB);
    expect((await call(ALICE, "tasks.complete", { id: "tb", requestId: "c1", revision: 1 })).ok).toBe(true);
    expect(await call(ALICE, "tasks.delete", { id: "tb", requestId: "c2", revision: 2 })).toMatchObject({ ok: false, code: "NOT_OWNER_OF_RECORD" });
    expect((await call(BOB, "tasks.delete", { id: "tb", requestId: "c3", revision: 2 })).ok).toBe(true);
  });
});

describe("邀请、批准、停用", () => {
  it("邀请码只出现一次；库里只存哈希；兑换后待批准；批准后可用；停用立即失效", async () => {
    const s = new MemoryStore();
    const call = caller(s, ON);
    const inv = await call(OWNER, "members.invite.create", { name: "小丙" });
    expect(inv.ok).toBe(true);
    const code: string = inv.data.code;
    expect(code).toMatch(/^[0-9a-f]{32}$/);
    const everything = () => JSON.stringify(s.data);
    expect(everything()).not.toContain(code);
    expect(await call(STRANGER, "members.redeem", { code: "0".repeat(32) })).toMatchObject({ ok: false, code: "INVITE_INVALID" });
    expect((await call(STRANGER, "members.redeem", { code })).data).toEqual({ status: "pending" });
    expect(await call(BOB, "members.redeem", { code })).toMatchObject({ ok: false, code: "INVITE_USED" });
    expect(await call(STRANGER, "dashboard")).toMatchObject({ ok: false, code: "MEMBER_PENDING" });
    const list = await call(OWNER, "members.list");
    expect(list.data.members).toMatchObject([{ uid: STRANGER, name: "小丙", status: "pending" }]);
    expect(JSON.stringify(list)).not.toContain("codeHash");
    expect((await call(OWNER, "members.approve", { uid: STRANGER })).ok).toBe(true);
    expect((await call(STRANGER, "dashboard")).ok).toBe(true);
    expect((await call(STRANGER, "session")).data).toEqual({ uid: STRANGER, role: "member", name: "小丙" });
    expect((await call(OWNER, "members.disable", { uid: STRANGER })).ok).toBe(true);
    expect(await call(STRANGER, "dashboard")).toMatchObject({ ok: false, code: "MEMBER_DISABLED" });
    expect((await call(OWNER, "members.enable", { uid: STRANGER })).ok).toBe(true);
    expect((await call(STRANGER, "dashboard")).ok).toBe(true);
    expect(everything()).not.toContain(code);
  });
  it("过期和已撤销的邀请不能用", async () => {
    const s = new MemoryStore();
    let time = NOW;
    const call = (uid: string, action: string, payload: unknown = {}) =>
      handle(() => s, { ...ctx(uid), now: () => time }, { action, payload }, undefined, undefined, ON) as Promise<any>;
    const a = await call(OWNER, "members.invite.create", { name: "甲" });
    const b = await call(OWNER, "members.invite.create", { name: "乙" });
    await call(OWNER, "members.invite.revoke", { id: b.data.id });
    expect(await call(BOB, "members.redeem", { code: b.data.code })).toMatchObject({ code: "INVITE_INVALID" });
    time = "2026-11-15T05:00:00.000Z";
    expect(await call(ALICE, "members.redeem", { code: a.data.code })).toMatchObject({ code: "INVITE_INVALID" });
  });
});

describe("操作日志", () => {
  it("每个写操作成功后追加一条：操作人、角色、北京时间、action、目标、改前/改后摘要", async () => {
    const s = new MemoryStore();
    activeMember(s, ALICE, "小甲");
    const call = caller(s, ON);
    await call(ALICE, "sales.create", { requestId: "a1", sale: sale() });
    await call(ALICE, "sales.update", { id: "a1", requestId: "u1", revision: 1, sale: { ...sale(), revenue: 15000, note: "长".repeat(100) } });
    const rows = logs(s).filter((l) => l.action.startsWith("sales."));
    expect(rows).toHaveLength(2);
    const upd = rows.find((l) => l.action === "sales.update")!;
    expect(upd).toMatchObject({
      actorUid: ALICE, actorName: "小甲", role: "member", result: "ok",
      targetType: "sales", targetId: "a1", atBj: "2026-11-12 12:00:00", day: "2026-11-12",
    });
    expect(upd.before).toMatchObject({ revenue: 10000, revision: 1 });
    expect(upd.after).toMatchObject({ revenue: 15000, revision: 2 });
    expect(String(upd.after!.note).length).toBeLessThanOrEqual(41);
    // 读的时候自动补建客户也会记
    expect(logs(s).some((l) => l.action === "customers.autoCreate" || l.action === "sales.create")).toBe(true);
  });
  it("管理员看全部；成员只看自己的，传别人的 uid 也只返回自己的", async () => {
    const s = new MemoryStore();
    activeMember(s, ALICE, "小甲");
    activeMember(s, BOB, "小乙");
    const call = caller(s, ON);
    await call(ALICE, "sales.create", { requestId: "a1", sale: sale() });
    await call(BOB, "sales.create", { requestId: "b1", sale: sale() });
    await call(OWNER, "sales.create", { requestId: "o1", sale: sale() });
    const all = await call(OWNER, "audit.list", {});
    expect(new Set(all.data.rows.map((r: AuditEntry) => r.actorUid))).toEqual(new Set([ALICE, BOB, OWNER]));
    const onlyBob = await call(OWNER, "audit.list", { actor: BOB });
    expect(onlyBob.data.rows.every((r: AuditEntry) => r.actorUid === BOB)).toBe(true);
    for (const q of [{}, { actor: BOB }, { actor: OWNER }, { actor: "" }]) {
      const mine = await call(ALICE, "audit.list", q);
      expect(mine.ok).toBe(true);
      expect(mine.data.rows.length).toBeGreaterThan(0);
      expect(mine.data.rows.every((r: AuditEntry) => r.actorUid === ALICE)).toBe(true);
    }
  });
  it("按日期、类型筛选，按时间倒序分页", async () => {
    const s = new MemoryStore();
    const call = caller(s, ON);
    for (let i = 0; i < 7; i++) await call(OWNER, "sales.create", { requestId: "s" + i, sale: sale() });
    const p1 = await call(OWNER, "audit.list", { action: "sales.create", limit: 3 });
    expect(p1.data.rows).toHaveLength(3);
    expect(p1.data.next).toBeTruthy();
    const p2 = await call(OWNER, "audit.list", { action: "sales.create", limit: 3, cursor: p1.data.next });
    const p3 = await call(OWNER, "audit.list", { action: "sales.create", limit: 3, cursor: p2.data.next });
    const ids = [...p1.data.rows, ...p2.data.rows, ...p3.data.rows].map((r: AuditEntry) => r.id);
    expect(new Set(ids).size).toBe(7);
    expect(p3.data.next).toBeNull();
    expect((await call(OWNER, "audit.list", { from: "2026-11-13" })).data.rows).toEqual([]);
    expect((await call(OWNER, "audit.list", { from: "2026-11-12", to: "2026-11-12", action: "sales" })).data.rows).toHaveLength(7);
  });
  it("日志只追加：没有任何改/删日志的 action（管理员也没有），业务存储写不了 audit_logs", async () => {
    const s = new MemoryStore();
    const call = caller(s, ON);
    await call(OWNER, "sales.create", { requestId: "s1", sale: sale() });
    const before = structuredClone(s.data.audit_logs);
    const id = Object.keys(before)[0];
    for (const action of ["audit.update", "audit.delete", "audit.clear", "audit.purge", "audit_logs.delete"]) {
      const r = await call(OWNER, action, { id });
      expect(r.ok, action).toBe(false);
    }
    for (const [k, v] of Object.entries(before)) expect(s.data.audit_logs[k]).toEqual(v);
    const guarded = guardAudit(s);
    await expect(guarded.put(AUDIT_COLLECTION, id, {})).rejects.toThrow("只能追加");
    await expect(guarded.del(AUDIT_COLLECTION, id)).rejects.toThrow("只能追加");
    await expect(guarded.transaction((tx) => tx.del(AUDIT_COLLECTION, id))).rejects.toThrow("只能追加");
    expect(Object.keys(appendOnly(s, () => NOW))).toEqual(["append"]);
  });
  it("写日志失败不挡主操作：记账照常成功，告警并记失败次数", async () => {
    const s = new MemoryStore();
    const put = s.put.bind(s);
    s.put = (async (c: string, id: string, v: unknown) => {
      if (c === AUDIT_COLLECTION) throw new Error("audit down");
      return put(c as never, id, v);
    }) as Store["put"];
    const warns: string[] = [];
    const r = await caller(s, ON, (c) => warns.push(c))(OWNER, "sales.create", { requestId: "s1", sale: sale() });
    expect(r.ok).toBe(true);
    expect(s.data.sales.s1).toBeDefined();
    expect(warns).toContain("audit.write_failed");
    // 失败计数放在新集合 members 的系统文档里，不写进已有的 batches
    expect((s.data.members._audit_health as any).failed).toBeGreaterThan(0);
    expect(s.data.batches._audit_health).toBeUndefined();
    expect((await caller(s, ON)(OWNER, "members.list")).data.members).toEqual([]);
    expect((await caller(s, ON)(OWNER, "members.disable", { uid: "_audit_health" })).ok).toBe(false);
    const me = await caller(s, ON)(OWNER, "members.me");
    expect(me.data.auditHealth.failed).toBeGreaterThan(0);
  });
  it("敏感内容不入日志：邀请码明文、同步密钥、推送密钥、备份正文", async () => {
    const s = new MemoryStore();
    const call = caller(s, ON);
    const inv = await call(OWNER, "members.invite.create", { name: "小丁" });
    await call(STRANGER, "members.redeem", { code: inv.data.code });
    await call(OWNER, "sales.create", { requestId: "s1", sale: { ...sale(), note: "备注-秘密内容-XYZ" } });
    await call(OWNER, "backup");
    await call(OWNER, "push.subscribe", { subscription: { endpoint: "https://push.example/secret-endpoint", keys: { p256dh: "SECRETP256", auth: "SECRETAUTH" } } });
    const KEY = "k".repeat(32) + "-team-test-key";
    const sync = { action: "tasks.sync.list", payload: {}, key: "wrong-" + KEY };
    const res = await handleSync(() => s, { key: KEY, now: () => NOW, hash }, sync);
    await auditSync(appendOnly(s, () => NOW), sync, res as any, new DenyThrottle(), () => NOW);
    const text = JSON.stringify(s.data.audit_logs);
    for (const secret of [inv.data.code, KEY, "secret-endpoint", "SECRETP256", "SECRETAUTH", "codeHash", "Authorization"])
      expect(text).not.toContain(secret);
    expect(logs(s).find((l) => l.action === "backup")!.after).not.toHaveProperty("sales");
  });
  it("iPhone 同步写入照常，日志里操作人记为系统·同步；密钥错误记 denied", async () => {
    const s = new MemoryStore();
    await caller(s, OFF)(OWNER, "sales.create", { requestId: "o1", sale: sale() });
    await caller(s, OFF)(OWNER, "tasks.create", { requestId: "t1", task: await taskInput("示例客户·甲") });
    const KEY = "k".repeat(32) + "-team-test-key";
    const ok = { action: "tasks.sync.complete", payload: { id: "t1", revision: 1, completedAt: NOW, requestId: "r1" }, key: KEY };
    const r = await handleSync(() => s, { key: KEY, now: () => NOW, hash }, ok);
    expect(r.ok).toBe(true);
    await auditSync(appendOnly(s, () => NOW), ok, r as any);
    const bad = { ...ok, key: "nope" };
    const r2 = await handleSync(() => s, { key: KEY, now: () => NOW, hash }, bad);
    await auditSync(appendOnly(s, () => NOW), bad, r2 as any, new DenyThrottle(), () => NOW);
    expect(logs(s).map((l) => [l.actorUid, l.action, l.result, l.reason])).toEqual(
      expect.arrayContaining([
        ["system:sync", "tasks.sync.complete", "ok", undefined],
        ["system:sync", "tasks.sync.denied", "denied", "SYNC_UNAUTHORIZED"],
      ]),
    );
  });
});

describe("函数包", () => {
  it("reminders 和 sales-stats 两个包与基线逐字节一致（团队改动只进 sales 包）", () => {
    execFileSync(process.execPath, ["scripts/build-server.mjs"], { stdio: "pipe" });
    const fixture = JSON.parse(readFileSync("tests/fixtures/sales-bundles.sha256.json", "utf8"));
    for (const f of [
      "cloudfunctions/reminders/index.js",
      "cloudfunctions/reminders/package.json",
      "cloudfunctions/sales-stats/index.js",
      "cloudfunctions/sales-stats/package.json",
    ])
      expect(createHash("sha256").update(readFileSync(f)).digest("hex"), f).toBe(fixture[f]);
  }, 60000);
});

describe("复审修复（防刷、并发、已删日程）", () => {
  const KEY = "k".repeat(32) + "-team-test-key";
  it("① 同步接口错密钥/限流被刷：不逐条写日志，同小时只记首条，过小时追加一条汇总，日志从不被改", async () => {
    const s = new MemoryStore();
    const throttle = new DenyThrottle();
    let at = NOW;
    const warns: string[] = [];
    const log = appendOnly(s, () => at);
    for (let i = 0; i < 100; i++) {
      const bad = { action: "tasks.sync.complete", payload: { id: "t" + i }, key: "bad" + i };
      const r = await handleSync(() => s, { key: KEY, now: () => at, hash }, bad);
      expect(r).toMatchObject({ ok: false, code: "SYNC_UNAUTHORIZED" });
      await auditSync(log, bad, r as any, throttle, () => at, (c) => warns.push(c));
    }
    const limited = { ok: false, code: "SYNC_RATE_LIMITED" };
    for (let i = 0; i < 30; i++)
      await auditSync(log, { action: "tasks.sync.list", payload: {} }, limited, throttle, () => at);
    expect(logs(s)).toHaveLength(2);
    expect(warns).toHaveLength(100);
    const firstHour = structuredClone(s.data.audit_logs);
    at = "2026-11-12T05:00:01.000Z";
    await auditSync(log, { action: "tasks.sync.list", payload: {} }, { ok: true, data: {} }, throttle, () => at);
    const all = logs(s);
    expect(all).toHaveLength(4);
    const sums = all.filter((l) => (l.after as any)?.summary);
    expect(sums.map((l) => [l.reason, (l.after as any).count]).sort()).toEqual([
      ["SYNC_RATE_LIMITED", 30],
      ["SYNC_UNAUTHORIZED", 100],
    ]);
    for (const [k, v] of Object.entries(firstHour)) expect(s.data.audit_logs[k]).toEqual(v);
  });
  it("② 非成员被拒按 uid+小时合并；成员同类越权按 uid+action+小时去重", async () => {
    const s = new MemoryStore();
    activeMember(s, ALICE, "小甲");
    const call = caller(s, ON);
    for (let i = 0; i < 20; i++) await call(STRANGER, i % 2 ? "dashboard" : "sales.list");
    for (let i = 0; i < 10; i++) await call(ALICE, "products.save", { id: "p" + i });
    await call(ALICE, "backup");
    const rows = logs(s).filter((l) => l.result === "denied");
    expect(rows.map((l) => [l.actorUid, l.action, l.reason]).sort()).toEqual([
      [STRANGER, "sales.list", "NOT_MEMBER"],
      [ALICE, "backup", "ADMIN_ONLY"],
      [ALICE, "products.save", "ADMIN_ONLY"],
    ].sort());
  });
  it("② members.redeem 乱填码：24 小时内失败 5 次即锁定（正确码也拒），日志不逐条写", async () => {
    const s = new MemoryStore();
    let at = NOW;
    const call = caller(s, ON, undefined, () => at);
    const good = await call(OWNER, "members.invite.create", { name: "小戊" });
    for (let i = 0; i < 5; i++)
      expect(await call(STRANGER, "members.redeem", { code: String(i).repeat(32) })).toMatchObject({ code: "INVITE_INVALID" });
    expect(await call(STRANGER, "members.redeem", { code: "乱填" })).toMatchObject({ code: "REDEEM_LOCKED" });
    expect(await call(STRANGER, "members.redeem", { code: good.data.code })).toMatchObject({ code: "REDEEM_LOCKED" });
    expect(s.data.members).toEqual({});
    expect(Object.keys(s.data.batches).filter((k) => k.includes("redeem"))).toEqual([]);
    const attempts = Object.entries(s.data.redeem_attempts);
    expect(attempts).toHaveLength(1);
    expect((attempts[0][1] as any).count).toBe(5);
    const denied = logs(s).filter((l) => l.action === "members.redeem");
    expect(denied.map((l) => l.reason).sort()).toEqual(["INVITE_INVALID", "REDEEM_LOCKED"]);
    // 别人不受影响；24 小时后解锁
    expect((await call(BOB, "members.redeem", { code: good.data.code })).ok).toBe(true);
    const other = await call(OWNER, "members.invite.create", { name: "小己" });
    at = "2026-11-13T04:00:01.000Z";
    expect((await call(STRANGER, "members.redeem", { code: other.data.code })).ok).toBe(true);
  });
  it("③ 同一个邀请码并发兑换：事务内重读，只有一个人成功", async () => {
    const s = new MemoryStore();
    const call = caller(s, ON);
    const inv = await call(OWNER, "members.invite.create", { name: "小庚" });
    const results = await Promise.all([ALICE, BOB, STRANGER].map((uid) => call(uid, "members.redeem", { code: inv.data.code })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => r.code === "INVITE_USED")).toBe(true);
    expect(Object.keys(s.data.members)).toHaveLength(1);
  });
  it("④ 成员看不到已删日程/已删销售（列表回收站、单条读取都拒）；管理员不变", async () => {
    const s = new MemoryStore();
    activeMember(s, ALICE, "小甲");
    const call = caller(s, ON);
    await call(OWNER, "sales.create", { requestId: "o1", sale: sale() });
    await call(OWNER, "tasks.create", { requestId: "t1", task: await taskInput("示例客户·甲") });
    await call(OWNER, "tasks.delete", { id: "t1", requestId: "d1", revision: 1 });
    await call(OWNER, "sales.delete", { id: "o1", requestId: "d2", revision: 1 });
    expect(await call(ALICE, "tasks.list", { deleted: true })).toMatchObject({ ok: false, code: "ADMIN_ONLY" });
    expect(await call(ALICE, "tasks.get", { id: "t1" })).toEqual({ ok: false, error: "日程不存在" });
    expect(await call(ALICE, "sales.get", { id: "o1" })).toEqual({ ok: false, error: "记录不存在" });
    expect((await call(ALICE, "tasks.list", {})).data).toEqual([]);
    expect((await call(OWNER, "tasks.list", { deleted: true })).data.map((t: any) => t.id)).toEqual(["t1"]);
    expect((await call(OWNER, "tasks.get", { id: "t1" })).data.deletedAt).toBeTruthy();
    expect((await call(OWNER, "sales.get", { id: "o1" })).data.deletedAt).toBeTruthy();
  });
});

describe("第二次复审修复（回收站全路径、冻结集合）", () => {
  // 一条已删销售 + 一条已删日程 + 一个目录回收站里的客户；成员任何读路径都不应看到
  async function trashFixture() {
    const s = new MemoryStore();
    activeMember(s, ALICE, "小甲");
    const call = caller(s, ON);
    await call(OWNER, "sales.create", { requestId: "live1", sale: sale() });
    await call(OWNER, "sales.create", { requestId: "gone1", sale: { ...sale("示例客户·回收"), note: "回收站标记" } });
    await call(OWNER, "sales.delete", { id: "gone1", requestId: "d1", revision: 1 });
    await call(OWNER, "tasks.create", { requestId: "tgone", task: { ...(await taskInput("示例客户·甲")), title: "已删日程标记" } });
    await call(OWNER, "tasks.delete", { id: "tgone", requestId: "d2", revision: 1 });
    return { s, call };
  }
  it("④ export 带 deleted:true 被拒；不带时也不含已删；deleted 任何真值、任何 action 都拒", async () => {
    const { call } = await trashFixture();
    expect(await call(ALICE, "export", { deleted: true })).toMatchObject({ ok: false, code: "ADMIN_ONLY" });
    for (const v of [1, "true", "yes", {}, []])
      for (const action of ["export", "sales.list", "tasks.list", "dashboard", "customers.detail", "customers.ranking", "products.catalog"])
        expect(await call(ALICE, action, { deleted: v }), action + ":" + JSON.stringify(v)).toMatchObject({ ok: false, code: "ADMIN_ONLY" });
    const rows = (await call(ALICE, "export", {})).data;
    expect(rows.map((r: any) => r.id)).toEqual(["live1"]);
    // deleted:false 等同于不传
    expect((await call(ALICE, "export", { deleted: false })).data.map((r: any) => r.id)).toEqual(["live1"]);
    // 管理员不变
    expect((await call(OWNER, "export", { deleted: true })).data.map((r: any) => r.id)).toEqual(["gone1"]);
  });
  it("④ 排查：成员所有读 action 的返回里都没有已删销售/已删日程", async () => {
    const { s, call } = await trashFixture();
    const cust = await customerId("示例客户·回收", hash);
    const reads: [string, unknown][] = [
      ["dashboard", {}], ["sales.list", {}], ["sales.get", { id: "gone1" }], ["export", {}],
      ["customers", {}], ["customers.list", {}], ["customers.ranking", { period: "all" }],
      ["customers.suggestions", {}], ["customers.detail", { id: cust, month: "all" }],
      ["tasks.list", {}], ["tasks.get", { id: "tgone" }], ["products.list", {}], ["products.catalog", {}],
    ];
    const memberReads = [...MEMBER_ACTIONS].filter((a) => !a.startsWith("members.") && a !== "audit.list" && a !== "session" && !/\.(create|update|delete|complete|reopen|save)$/.test(a));
    expect(memberReads.sort()).toEqual(reads.map(([a]) => a).filter((a, i, all) => all.indexOf(a) === i).sort());
    for (const [action, payload] of reads) {
      const r = await call(ALICE, action, payload);
      const text = JSON.stringify(r);
      expect(text, action).not.toContain("gone1");
      expect(text, action).not.toContain("回收站标记");
      expect(text, action).not.toContain("tgone");
      expect(text, action).not.toContain("已删日程标记");
    }
    // 排行/看板的合计里也不算已删的那笔
    expect((await call(ALICE, "customers.ranking", { period: "all" })).data.totals.count).toBe(1);
    // 管理员读同样的数据照常带回收站内容（行为不变）
    expect(JSON.stringify((await call(OWNER, "sales.list", { deleted: true })).data)).toContain("gone1");
    expect((await call(OWNER, "tasks.get", { id: "tgone" })).ok).toBe(true);
    expect(s.data.sales.gone1).toBeDefined();
  });
  it("④ 目录回收站里（已归档）的客户：成员客户详情返回不存在、疑似重复里不出现；管理员不变", async () => {
    const s = new MemoryStore();
    activeMember(s, ALICE, "小甲");
    const call = caller(s, ON);
    await call(OWNER, "sales.create", { requestId: "c1", sale: sale("Demo客户") });
    await call(OWNER, "sales.create", { requestId: "c2", sale: sale("demo客户") });
    await call(OWNER, "sales.create", { requestId: "c3", sale: sale("DEMO客户") });
    await call(OWNER, "customers.list");
    const gone = (await customerId("DEMO客户", hash))!;
    s.data.customers[gone] = { ...(s.data.customers[gone] as any), archivedAt: NOW };
    expect(await call(ALICE, "customers.detail", { id: gone, month: "all" })).toEqual({ ok: false, error: "客户不存在" });
    expect((await call(OWNER, "customers.detail", { id: gone, month: "all" })).ok).toBe(true);
    const admin = (await call(OWNER, "customers.suggestions")).data;
    expect(JSON.stringify(admin)).toContain(gone);
    const mine = (await call(ALICE, "customers.suggestions")).data;
    expect(JSON.stringify(mine)).not.toContain(gone);
    expect(mine.length).toBe(1);
    expect(mine[0].members).toHaveLength(2);
    expect(mine[0].totals.count).toBe(mine[0].members.reduce((n: number, m: any) => n + m.totals.count, 0));
  });
  it("冻结：已有 11 个集合里不出现任何新类型文档（与开关全关时逐项相同，只多 createdBy 字段）", async () => {
    const FROZEN = ["sales", "products", "batches", "customers", "tasks", "subscriptions", "deliveries", "content_daily", "content_audit", "content_receipts", "taskSyncLog"];
    const strip = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(strip)
        : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== "createdBy").map(([k, x]) => [k, strip(x)]))
          : v;
    async function run(team: TeamConfig) {
      const s = new MemoryStore();
      const call = caller(s, team);
      await call(OWNER, "sales.create", { requestId: "s1", sale: sale() });
      await call(OWNER, "tasks.create", { requestId: "t1", task: await taskInput("示例客户·甲") });
      await call(OWNER, "sales.delete", { id: "s1", requestId: "d1", revision: 1 });
      await call(OWNER, "dashboard");
      if (team.membersEnabled) {
        // 团队专有动作：邀请、乱填码到锁定、越权被刷、日志写失败
        await call(OWNER, "members.invite.create", { name: "小庚" });
        for (let i = 0; i < 7; i++) await call(STRANGER, "members.redeem", { code: String(i % 10).repeat(32) });
        for (let i = 0; i < 5; i++) await call(STRANGER, "sales.list");
        const put = s.put.bind(s);
        s.put = (async (c: string, id: string, v: unknown) => {
          if (c === AUDIT_COLLECTION) throw new Error("audit down");
          return put(c as never, id, v);
        }) as Store["put"];
        await call(OWNER, "dashboard", { requestId: "x" });
        await call(OWNER, "products.save", { id: "nope" });
        s.put = put;
        await call(OWNER, "members.me");
        await call(OWNER, "members.list");
      }
      return s.data as Record<string, Record<string, unknown>>;
    }
    const off = await run(OFF);
    const on = await run(ON);
    for (const c of FROZEN) {
      expect(Object.keys(on[c] ?? {}).sort(), c).toEqual(Object.keys(off[c] ?? {}).sort());
      expect(strip(on[c] ?? {}), c).toEqual(off[c] ?? {});
    }
    expect(Object.keys(on.redeem_attempts)).toHaveLength(1);
    expect(on.members._audit_health).toBeDefined();
    // 源码层面：团队代码里没有写已有集合的 put/del
    for (const f of ["server/team.ts", "server/audit.ts", "server/handler.ts", "server/cloud.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/\.(put|del)\(\s*"(sales|products|batches|customers|tasks|subscriptions|deliveries|content_\w+|taskSyncLog)"/);
    }
  });
});
