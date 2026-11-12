import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../server/memory-store";
import { handle } from "../server/handler";
import type { Context } from "../server/service";
import { customerId } from "../src/domain/customers";
import { DenyThrottle, type AuditEntry } from "../server/audit";
import { teamConfigFromEnv, type TeamConfig } from "../server/team";
import { handleSync } from "../server/task-sync";
import { MemoryAvatarStorage, decodeAvatar, imageInfo, AVATAR_MAX_BYTES } from "../server/avatar";
import { PALETTE, OWNER_COLOR, colorKeyAt, memberColor, taskOwner, UNASSIGNED_COLOR, SYSTEM_COLOR } from "../src/domain/members";

// 全部虚构：人名、客户、图片都是合成的
const OWNER = "uid-owner";
const ALICE = "uid-alice";
const BOB = "uid-bob";
const STRANGER = "uid-stranger";
const NOW = "2026-11-12T04:00:00.000Z";
const KEY = "k".repeat(32) + "-test-sync-key";
const hash = async (s: string) => createHash("sha256").update(s).digest("hex");
const BASE: TeamConfig = { membersEnabled: true, auditEnabled: true };
const OWNER_ON: TeamConfig = { ...BASE, scheduleOwnerEnabled: true };
const ctx = (uid: string | null): Context => ({ uid, ownerUid: OWNER, now: () => NOW, hash });
function caller(store: MemoryStore, team: TeamConfig) {
  const t = { ...team, throttle: new DenyThrottle() };
  return (uid: string | null, action: string, payload: unknown = {}) =>
    handle(() => store, ctx(uid), { action, payload }, undefined, undefined, t) as Promise<any>;
}
const logs = (s: MemoryStore) => Object.values(s.data.audit_logs) as AuditEntry[];
function member(s: MemoryStore, uid: string, name: string, status = "active", createdAt = NOW, extra = {}) {
  s.data.members[uid] = { uid, name, status, inviteId: "inv_x", createdAt, updatedAt: createdAt, revision: 1, ...extra };
}
async function task(at = "2026-11-20T04:00:00Z") {
  return { customerId: await customerId("示例客户·甲", hash), at, title: "回访", feedback: "", nextAction: "", reminder: "off" };
}
async function team() {
  const s = new MemoryStore();
  const cid = (await customerId("示例客户·甲", hash))!;
  s.data.customers[cid] = { id: cid, name: "示例客户·甲", mergedInto: null, revision: 1, createdAt: NOW, updatedAt: NOW };
  member(s, ALICE, "林小雅", "active", "2026-11-01T00:00:00.000Z", { color: "c1" });
  member(s, BOB, "宋阿木", "active", "2026-11-02T00:00:00.000Z", { color: "c2" });
  return s;
}

/** 合成图片：只有文件头（服务端只看头和大小） */
function webp(w: number, h: number, pad = 0) {
  const b = new Uint8Array(30 + pad);
  b.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
  b.set([..."WEBP"].map((c) => c.charCodeAt(0)), 8);
  b.set([..."VP8X"].map((c) => c.charCodeAt(0)), 12);
  const w1 = w - 1, h1 = h - 1;
  b.set([w1 & 255, (w1 >> 8) & 255, (w1 >> 16) & 255, h1 & 255, (h1 >> 8) & 255, (h1 >> 16) & 255], 24);
  return b;
}
function jpeg(w: number, h: number) {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0, 0, 0]);
}
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const png = b64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(40).fill(0)]));

describe("共用取色和归属函数", () => {
  it("7 色顺序与方案一致，第 8 位起循环；Jason 固定珊瑚橙；系统空心圆环；没颜色 = 未分配灰", () => {
    expect(PALETTE.map((c) => c.name)).toEqual(["墨蓝", "赭金", "梅紫", "橄榄绿", "栗棕", "岩灰蓝", "玫红"]);
    expect(PALETTE.map((c) => c.dot)).toEqual(["#3D5A80", "#A8781E", "#8A4F7D", "#6E7B32", "#7B5B45", "#66708F", "#A8436A"]);
    expect(PALETTE[1].avatarBg).toBe("#976C1B");
    expect(OWNER_COLOR).toMatchObject({ dot: "#D97757", stroke: "#B4532F", bar: "#C9603F", tint: "#FAECE7", avatarBg: "#B4532F" });
    expect([0, 6, 7, 8, 14].map(colorKeyAt)).toEqual(["c1", "c7", "c1", "c2", "c1"]);
    const of = (u: string) => (u === ALICE ? "c3" : undefined);
    expect(memberColor(OWNER, OWNER, of)).toBe(OWNER_COLOR);
    expect(memberColor(ALICE, OWNER, of).name).toBe("梅紫");
    expect(memberColor(BOB, OWNER, of)).toBe(UNASSIGNED_COLOR);
    expect(memberColor("system:sync", OWNER, of)).toBe(SYSTEM_COLOR);
  });
  it("归属：ownerUid → createdBy → Jason", () => {
    expect(taskOwner({ ownerUid: BOB, createdBy: ALICE }, OWNER)).toBe(BOB);
    expect(taskOwner({ createdBy: ALICE }, OWNER)).toBe(ALICE);
    expect(taskOwner({}, OWNER)).toBe(OWNER);
  });
});

describe("开关关：与现在完全一致", () => {
  async function script(t: TeamConfig) {
    const s = await team();
    const call = caller(s, t);
    const out: unknown[] = [];
    out.push(await call(ALICE, "tasks.create", { requestId: "t1", task: await task() }));
    out.push(await call(OWNER, "tasks.create", { requestId: "t2", task: await task() }));
    out.push(await call(ALICE, "tasks.update", { id: "t2", requestId: "u1", revision: 1, task: { title: "改错字" } }));
    out.push(await call(ALICE, "tasks.delete", { id: "t2", requestId: "d1", revision: 2 }));
    out.push(await call(ALICE, "tasks.claim", { id: "t2", requestId: "c1", revision: 2 }));
    out.push(await call(OWNER, "tasks.claim", { id: "t2", requestId: "c2", revision: 2 }));
    out.push(await call(OWNER, "tasks.assign", { id: "t2", requestId: "c3", revision: 2, to: ALICE }));
    out.push(await call(ALICE, "members.directory"));
    out.push(await call(OWNER, "members.directory"));
    out.push(await call(OWNER, "members.color.fill"));
    out.push(await call(OWNER, "members.avatar.set", { image: b64(webp(128, 128)) }));
    out.push(await call(ALICE, "sales.create", { requestId: "s1", sale: { productId: "", productName: "示例", customer: "示例客户·甲", date: "2026-11-12", revenue: 100, cost: 1, note: "" } }));
    out.push(await call(ALICE, "sales.delete", { id: "s1", requestId: "sd1", revision: 1 }));
    out.push(await call(OWNER, "members.me"));
    out.push(await call(ALICE, "audit.list", { actor: OWNER }));
    out.push(await handleSync(() => s, { key: KEY, now: () => NOW, hash }, { action: "tasks.sync.list", payload: {}, key: KEY }));
    // 日志 id 带随机数、同一时刻的顺序也随机：去掉 id 后按内容排序再比
    const norm = (rows: AuditEntry[]) => rows.map(({ id: _i, ...r }) => JSON.stringify(r)).sort();
    const out2 = out.map((o: any) => (o?.data?.rows ? { ...o, data: { ...o.data, rows: norm(o.data.rows) } } : o));
    return { out: out2, data: { ...s.data, audit_logs: norm(logs(s)) } };
  }
  it("新开关不设 = 设成关：返回值、库内数据（含日志）逐项相同", async () => {
    const base = await script(BASE);
    const off = await script({ ...BASE, scheduleOwnerEnabled: false, avatarsEnabled: false, salesActorFieldsEnabled: false, avatarStorage: new MemoryAvatarStorage() });
    expect(off).toEqual(base);
    // 关着时：没有任何新字段，新 action 一律不存在 / 成员被白名单拒
    const json = JSON.stringify(base.data);
    for (const k of ["ownerUid", "updatedBy", "deletedBy", '"color":"c3"', '"avatar"'])
      expect(json).not.toContain(k);
    expect(base.out[3]).toMatchObject({ ok: false, code: "NOT_OWNER_OF_RECORD" }); // 成员仍只能删自己建的
    expect(base.out[4]).toMatchObject({ ok: false, code: "ADMIN_ONLY" });
    expect(base.out[5]).toMatchObject({ ok: false, code: "UNSUPPORTED_ACTION" });
    expect(base.out[6]).toMatchObject({ ok: false, code: "UNSUPPORTED_ACTION" });
    expect(base.out[7]).toMatchObject({ ok: false, code: "ADMIN_ONLY" });
    expect(base.out[8]).toMatchObject({ ok: false, code: "UNSUPPORTED_ACTION" });
    expect(base.out[13]).toMatchObject({ ok: true });
    expect(Object.keys((base.out[13] as any).data).sort()).toEqual(["auditEnabled", "auditHealth", "membersEnabled", "name", "role", "status", "uid"]);
    expect(base.out[14]).toMatchObject({ ok: true }); // 关着时成员点名看别人：照旧只返回自己的
    expect((base.out[15] as any).data.withdrawn).toBeUndefined();
  });
  it("环境变量：只有 =1 才开", () => {
    expect(teamConfigFromEnv({ MEMBERS_ENABLED: "1", AUDIT_ENABLED: "1" })).toEqual({ membersEnabled: true, auditEnabled: true });
    expect(teamConfigFromEnv({ SCHEDULE_OWNER_ENABLED: "true", AVATARS_ENABLED: "yes", SALES_ACTOR_FIELDS_ENABLED: "0" })).toEqual({ membersEnabled: false, auditEnabled: false });
    expect(teamConfigFromEnv({ SCHEDULE_OWNER_ENABLED: "1", AVATARS_ENABLED: "1", SALES_ACTOR_FIELDS_ENABLED: "1" })).toMatchObject({ scheduleOwnerEnabled: true, avatarsEnabled: true, salesActorFieldsEnabled: true });
  });
  it("开了日程归属但没开成员：不生效", async () => {
    const s = await team();
    const call = caller(s, { membersEnabled: false, auditEnabled: true, scheduleOwnerEnabled: true });
    await call(OWNER, "tasks.create", { requestId: "t1", task: await task() });
    expect(JSON.stringify(s.data.tasks)).not.toContain("ownerUid");
    expect(await call(OWNER, "tasks.claim", { id: "t1", requestId: "c", revision: 1 })).toMatchObject({ code: "UNSUPPORTED_ACTION" });
  });
});

describe("开关开：归属规则（方案 C）", () => {
  it("新建归创建人；改错字、完成、重开、删除、恢复都不转归属，只记最后修改人", async () => {
    const s = await team();
    const call = caller(s, OWNER_ON);
    expect((await call(ALICE, "tasks.create", { requestId: "t1", task: await task() })).data).toMatchObject({ createdBy: ALICE, ownerUid: ALICE });
    expect((await call(OWNER, "tasks.update", { id: "t1", requestId: "u1", revision: 1, task: { title: "改错字" } })).data).toMatchObject({ ownerUid: ALICE, updatedBy: OWNER });
    expect((await call(BOB, "tasks.complete", { id: "t1", requestId: "u2", revision: 2 })).data).toMatchObject({ ownerUid: ALICE, updatedBy: BOB });
    expect((await call(ALICE, "tasks.reopen", { id: "t1", requestId: "u3", revision: 3 })).data).toMatchObject({ ownerUid: ALICE, updatedBy: ALICE });
    // 修改里夹带 ownerUid 也不生效
    expect((await call(BOB, "tasks.update", { id: "t1", requestId: "u4", revision: 4, task: { ownerUid: BOB } })).data.ownerUid).toBe(ALICE);
    const del = await call(BOB, "tasks.delete", { id: "t1", requestId: "d1", revision: 5 });
    expect(del).toMatchObject({ ok: true, data: { ownerUid: ALICE, updatedBy: BOB } });
    expect((await call(OWNER, "tasks.restore", { id: "t1", requestId: "r1", revision: 6 })).data).toMatchObject({ ownerUid: ALICE, updatedBy: OWNER });
    // 删除留痕：归属人 + 「删的是别人的」
    const d = logs(s).find((l) => l.action === "tasks.delete")!;
    expect(d.after).toMatchObject({ owner: ALICE, othersRecord: true, updatedBy: BOB });
    expect(d.before).toMatchObject({ ownerUid: ALICE });
  });
  it("成员可以删别人的日程（进回收站），回收站仍只有管理员", async () => {
    const s = await team();
    const call = caller(s, OWNER_ON);
    await call(OWNER, "tasks.create", { requestId: "t1", task: await task() });
    s.data.tasks["legacy"] = { ...(s.data.tasks["t1"] as object), id: "legacy", createdBy: undefined, ownerUid: undefined };
    expect((await call(ALICE, "tasks.delete", { id: "t1", requestId: "d1", revision: 1 })).ok).toBe(true);
    expect((await call(ALICE, "tasks.delete", { id: "legacy", requestId: "d2", revision: 1 })).ok).toBe(true);
    expect(await call(ALICE, "tasks.restore", { id: "t1", requestId: "r1", revision: 2 })).toMatchObject({ code: "ADMIN_ONLY" });
    expect(await call(ALICE, "tasks.list", { deleted: true })).toMatchObject({ code: "ADMIN_ONLY" });
    // 销售仍只能删自己录的
    await call(OWNER, "sales.create", { requestId: "s1", sale: { productId: "", productName: "示例", customer: "示例客户·甲", date: "2026-11-12", revenue: 100, cost: 1, note: "" } });
    expect(await call(ALICE, "sales.delete", { id: "s1", requestId: "sd", revision: 1 })).toMatchObject({ code: "NOT_OWNER_OF_RECORD" });
  });
  it("认领：转到自己名下；指派：只有 Jason；成员调指派被拒并记 denied", async () => {
    const s = await team();
    const call = caller(s, OWNER_ON);
    await call(OWNER, "tasks.create", { requestId: "t1", task: await task() });
    const c = await call(ALICE, "tasks.claim", { id: "t1", requestId: "c1", revision: 1 });
    expect(c).toMatchObject({ ok: true, data: { from: OWNER, to: ALICE, task: { ownerUid: ALICE, updatedBy: ALICE, revision: 2 } } });
    // 重放同一请求：结果相同，不重复写
    expect((await call(ALICE, "tasks.claim", { id: "t1", requestId: "c1", revision: 1 })).data).toEqual(c.data);
    expect((s.data.tasks.t1 as any).revision).toBe(2);
    expect(await call(BOB, "tasks.assign", { id: "t1", requestId: "a0", revision: 2, to: BOB })).toMatchObject({ ok: false, code: "ADMIN_ONLY" });
    expect(logs(s).some((l) => l.action === "tasks.assign" && l.result === "denied" && l.actorUid === BOB)).toBe(true);
    const a = await call(OWNER, "tasks.assign", { id: "t1", requestId: "a1", revision: 2, to: BOB });
    expect(a.data).toMatchObject({ from: ALICE, to: BOB, task: { ownerUid: BOB, updatedBy: OWNER } });
    expect(await call(OWNER, "tasks.assign", { id: "t1", requestId: "a2", revision: 3, to: STRANGER })).toMatchObject({ ok: false, error: "只能指派给使用中的成员" });
    expect(await call(OWNER, "tasks.assign", { id: "t1", requestId: "a3", revision: 2, to: OWNER })).toMatchObject({ ok: false, error: "日程已在另一处修改，请刷新后重试" });
    expect((await call(OWNER, "tasks.assign", { id: "t1", requestId: "a4", revision: 3, to: OWNER })).data.task.ownerUid).toBe(OWNER);
    const transfers = logs(s).filter((l) => (l.action === "tasks.claim" || l.action === "tasks.assign") && l.result === "ok");
    expect(transfers.map((l) => [l.action, l.before?.ownerUid, l.after?.ownerUid])).toEqual(
      expect.arrayContaining([["tasks.claim", OWNER, ALICE], ["tasks.assign", ALICE, BOB], ["tasks.assign", BOB, OWNER]]),
    );
    expect(await call(STRANGER, "tasks.claim", { id: "t1", requestId: "x", revision: 4 })).toMatchObject({ ok: false, code: "NOT_MEMBER" });
  });
  it("已删除的日程不能认领；冻结集合里只多 tasks 的两个字段，sales、customers 一个字段都不变", async () => {
    const s = await team();
    const call = caller(s, OWNER_ON);
    await call(ALICE, "tasks.create", { requestId: "t1", task: await task() });
    await call(ALICE, "tasks.delete", { id: "t1", requestId: "d1", revision: 1 });
    expect(await call(BOB, "tasks.claim", { id: "t1", requestId: "c", revision: 2 })).toMatchObject({ ok: false, error: "请先恢复日程" });
    await call(ALICE, "sales.create", { requestId: "s1", sale: { productId: "", productName: "示例", customer: "示例客户·甲", date: "2026-11-12", revenue: 100, cost: 1, note: "" } });
    await call(ALICE, "sales.update", { id: "s1", requestId: "su", revision: 1, sale: { productId: "", productName: "示例", customer: "示例客户·甲", date: "2026-11-12", revenue: 200, cost: 1, note: "" } });
    await call(ALICE, "sales.delete", { id: "s1", requestId: "sd", revision: 2 });
    expect(Object.keys(s.data.sales.s1 as object)).not.toContain("updatedBy");
    expect(Object.keys(s.data.sales.s1 as object)).not.toContain("deletedBy");
    for (const c of Object.values(s.data.customers)) expect(Object.keys(c as object).sort()).not.toContain("updatedBy");
  });
});

describe("sales 删除人、修改人（单独开关 SALES_ACTOR_FIELDS_ENABLED）", () => {
  it("开：修改写 updatedBy，删除写 deletedBy，恢复去掉 deletedBy；只开它不影响日程", async () => {
    const s = await team();
    const call = caller(s, { ...BASE, salesActorFieldsEnabled: true });
    const sale = (revenue: number) => ({ productId: "", productName: "示例", customer: "示例客户·甲", date: "2026-11-12", revenue, cost: 1, note: "" });
    await call(ALICE, "sales.create", { requestId: "s1", sale: sale(100) });
    expect((await call(ALICE, "sales.update", { id: "s1", requestId: "u", revision: 1, sale: sale(200) })).data).toMatchObject({ createdBy: ALICE, updatedBy: ALICE });
    expect((await call(OWNER, "sales.delete", { id: "s1", requestId: "d", revision: 2 })).data).toMatchObject({ updatedBy: OWNER, deletedBy: OWNER });
    const r = await call(OWNER, "sales.restore", { id: "s1", requestId: "r", revision: 3 });
    expect(r.data.updatedBy).toBe(OWNER);
    expect("deletedBy" in r.data).toBe(false);
    expect(logs(s).find((l) => l.action === "sales.delete")!.after).toMatchObject({ deletedBy: OWNER });
    await call(ALICE, "tasks.create", { requestId: "t1", task: await task() });
    expect(JSON.stringify(s.data.tasks)).not.toContain("ownerUid");
  });
});

describe("成员颜色", () => {
  it("批准入队时自动分色，写入后不再改；第 8 人起循环；停用保留原色", async () => {
    const s = new MemoryStore();
    const call = caller(s, OWNER_ON);
    for (let i = 0; i < 9; i++) member(s, "uid-m" + i, "成员" + i, "pending", `2026-11-0${i + 1}T00:00:00.000Z`);
    for (let i = 0; i < 9; i++) expect((await call(OWNER, "members.approve", { uid: "uid-m" + i })).ok).toBe(true);
    const colors = Array.from({ length: 9 }, (_, i) => (s.data.members["uid-m" + i] as any).color);
    expect(colors).toEqual(["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c1", "c2"]);
    await call(OWNER, "members.disable", { uid: "uid-m0" });
    await call(OWNER, "members.enable", { uid: "uid-m0" });
    expect((s.data.members["uid-m0"] as any).color).toBe("c1");
  });
  it("一次性补色：按入队先后；重复运行不再改；成员调用被拒", async () => {
    const s = new MemoryStore();
    member(s, "uid-b", "后来", "active", "2026-11-05T00:00:00.000Z");
    member(s, "uid-a", "先来", "disabled", "2026-11-01T00:00:00.000Z");
    member(s, "uid-c", "已有色", "active", "2026-11-03T00:00:00.000Z", { color: "c1" });
    member(s, "uid-p", "待批准", "pending", "2026-11-04T00:00:00.000Z");
    const call = caller(s, OWNER_ON);
    expect((await call(OWNER, "members.color.fill")).data.filled).toEqual([{ uid: "uid-a", color: "c2" }, { uid: "uid-b", color: "c3" }]);
    const snap = structuredClone(s.data.members);
    expect((await call(OWNER, "members.color.fill")).data.filled).toEqual([]);
    expect(s.data.members).toEqual(snap);
    expect((s.data.members["uid-p"] as any).color).toBeUndefined();
    expect(await call("uid-b", "members.color.fill")).toMatchObject({ ok: false, code: "ADMIN_ONLY" });
    expect(logs(s).some((l) => l.action === "members.color.fill" && l.result === "denied")).toBe(true);
    expect(logs(s).find((l) => l.action === "members.color.fill" && l.result === "ok")!.after).toMatchObject({ count: 2 });
  });
  it("成员目录：所有已入队的人都能读，只给 uid / 名字 / 颜色；外人和待批准拒绝", async () => {
    const s = await team();
    member(s, "uid-p", "待批准", "pending");
    member(s, "uid-off", "已停用", "disabled", "2026-11-03T00:00:00.000Z", { color: "c3" });
    const call = caller(s, OWNER_ON);
    const d = await call(ALICE, "members.directory");
    expect(d.data.people).toEqual([
      { uid: OWNER, name: "Jason", role: "admin", status: "active", color: "owner" },
      { uid: ALICE, name: "林小雅", role: "member", status: "active", color: "c1" },
      { uid: BOB, name: "宋阿木", role: "member", status: "active", color: "c2" },
      { uid: "uid-off", name: "已停用", role: "member", status: "disabled", color: "c3" },
    ]);
    expect(JSON.stringify(d)).not.toContain("inviteId");
    expect(await call(STRANGER, "members.directory")).toMatchObject({ ok: false, code: "NOT_MEMBER" });
    expect(await call("uid-p", "members.directory")).toMatchObject({ ok: false, code: "MEMBER_PENDING" });
    expect(await call("uid-off", "members.directory")).toMatchObject({ ok: false, code: "MEMBER_DISABLED" });
    expect((await call(ALICE, "members.me")).data).toMatchObject({ scheduleOwnerEnabled: true, ownerUid: OWNER });
    expect((await call(ALICE, "members.me")).data.avatarsEnabled).toBeUndefined();
  });
});

describe("操作日志按人筛选", () => {
  it("管理员看所有人，可按人、按组合类型筛；成员只能看自己（点名看别人被拒并记 denied）", async () => {
    const s = await team();
    const call = caller(s, OWNER_ON);
    await call(OWNER, "tasks.create", { requestId: "t1", task: await task() });
    await call(ALICE, "tasks.claim", { id: "t1", requestId: "c1", revision: 1 });
    await call(BOB, "tasks.delete", { id: "t1", requestId: "d1", revision: 2 });
    const all = (await call(OWNER, "audit.list")).data.rows as AuditEntry[];
    expect(new Set(all.map((r) => r.actorUid))).toEqual(new Set([OWNER, ALICE, BOB]));
    expect(((await call(OWNER, "audit.list", { actor: ALICE })).data.rows as AuditEntry[]).every((r) => r.actorUid === ALICE)).toBe(true);
    expect(((await call(OWNER, "audit.list", { action: "group:owner" })).data.rows as AuditEntry[]).map((r) => r.action)).toEqual(["tasks.claim"]);
    expect(((await call(OWNER, "audit.list", { action: "group:delete" })).data.rows as AuditEntry[]).map((r) => r.action)).toEqual(["tasks.delete"]);
    const mine = (await call(ALICE, "audit.list")).data.rows as AuditEntry[];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.actorUid === ALICE)).toBe(true);
    expect((await call(ALICE, "audit.list", { actor: ALICE })).ok).toBe(true);
    expect(await call(ALICE, "audit.list", { actor: OWNER })).toMatchObject({ ok: false, code: "SELF_ONLY" });
    expect(logs(s).some((l) => l.action === "audit.list" && l.result === "denied" && l.actorUid === ALICE)).toBe(true);
  });
});

describe("iPhone 同步：只同步归 Jason 的 + 撤下清单", () => {
  async function setup() {
    const s = await team();
    const call = caller(s, OWNER_ON);
    await call(OWNER, "tasks.create", { requestId: "mine", task: await task("2026-11-20T04:00:00Z") });
    await call(ALICE, "tasks.create", { requestId: "alice", task: await task("2026-11-21T04:00:00Z") });
    await call(OWNER, "tasks.create", { requestId: "moved", task: await task("2026-11-22T04:00:00Z") });
    await call(OWNER, "tasks.assign", { id: "moved", requestId: "a1", revision: 1, to: BOB });
    await call(OWNER, "tasks.create", { requestId: "deletedMine", task: await task("2026-11-23T04:00:00Z") });
    await call(ALICE, "tasks.delete", { id: "deletedMine", requestId: "d1", revision: 1 });
    // 老日程（没有 createdBy / ownerUid）= Jason 的；周诗懿式的老成员日程只有 createdBy
    s.data.tasks.legacy = { ...(s.data.tasks.mine as object), id: "legacy", createdBy: undefined, ownerUid: undefined };
    s.data.tasks.oldMember = { ...(s.data.tasks.mine as object), id: "oldMember", createdBy: ALICE, ownerUid: undefined, at: "2026-10-20T04:00:00.000Z" };
    s.data.tasks.tooOld = { ...(s.data.tasks.mine as object), id: "tooOld", createdBy: ALICE, ownerUid: undefined, at: "2026-10-01T04:00:00.000Z" };
    s.data.tasks.tooFar = { ...(s.data.tasks.mine as object), id: "tooFar", createdBy: ALICE, ownerUid: undefined, at: "2027-03-01T04:00:00.000Z" };
    const sync = (action: string, payload: Record<string, unknown> = {}, owner: string | undefined = OWNER) =>
      handleSync(() => s, { key: KEY, now: () => NOW, hash, ...(owner ? { owner } : {}) }, { action, payload, key: KEY }) as Promise<any>;
    return { s, sync };
  }
  it("列表只给归 Jason 的；withdrawn 是过去 30 天到未来 90 天里不归 Jason 的，不含被删但仍归 Jason 的", async () => {
    const { sync } = await setup();
    const r = await sync("tasks.sync.list");
    expect(r.data.tasks.map((t: { id: string }) => t.id).sort()).toEqual(["legacy", "mine"]);
    expect(r.data.withdrawn).toEqual(["oldMember", "alice", "moved"]);
    expect(r.data.withdrawn).not.toContain("deletedMine");
    expect(r.data.withdrawnFrom).toBe("2026-10-13T04:00:00.000Z");
    expect(r.data.withdrawnTo).toBe("2027-02-10T04:00:00.000Z");
    // 不传 owner（开关关）：全部同步、没有撤下清单，与现在一致
    const off = await sync("tasks.sync.list", {}, "");
    expect(off.data.withdrawn).toBeUndefined();
    expect(off.data.tasks.map((t: { id: string }) => t.id).sort()).toEqual(["alice", "legacy", "mine", "moved"]);
  });
  it("手机上完成/重开已转出的日程 → SYNC_NOT_OWNED；Jason 的照常", async () => {
    const { sync, s } = await setup();
    expect(await sync("tasks.sync.complete", { id: "alice", requestId: "q1" })).toMatchObject({ ok: false, code: "SYNC_NOT_OWNED" });
    expect(await sync("tasks.sync.uncomplete", { id: "moved", requestId: "q2" })).toMatchObject({ ok: false, code: "SYNC_NOT_OWNED" });
    expect((s.data.tasks.alice as any).completedAt).toBeNull();
    expect(await sync("tasks.sync.complete", { id: "mine", requestId: "q3" })).toMatchObject({ ok: true });
    expect((s.data.tasks.mine as any).updatedBy).toBeUndefined(); // 同步写入不记最后修改人
    expect(await sync("tasks.sync.complete", { id: "legacy", requestId: "q4" })).toMatchObject({ ok: true });
    // 手机新建的归 Jason（没有 createdBy）
    const c = await sync("tasks.sync.create", { title: "手机建", at: "2026-11-25 10:00", requestId: "q5" });
    expect((await sync("tasks.sync.list")).data.tasks.map((t: { id: string }) => t.id)).toContain(c.data.id);
  });
});

describe("头像", () => {
  const ON: TeamConfig = { ...OWNER_ON, avatarsEnabled: true };
  async function setup(storage = new MemoryAvatarStorage()) {
    const s = await team();
    const call = (uid: string, action: string, payload: unknown = {}) =>
      handle(() => s, ctx(uid), { action, payload }, undefined, undefined, { ...ON, avatarStorage: storage, throttle: new DenyThrottle() }) as Promise<any>;
    return { s, call, storage };
  }
  it("格式和大小：WebP / JPEG 通过；PNG、坏头、超 40KB、超 256px 拒绝", () => {
    expect(imageInfo(webp(128, 128))).toEqual({ type: "webp", width: 128, height: 128 });
    expect(imageInfo(jpeg(128, 96))).toEqual({ type: "jpeg", width: 128, height: 96 });
    expect(decodeAvatar(b64(webp(128, 128))).type).toBe("webp");
    expect(decodeAvatar("data:image/jpeg;base64," + b64(jpeg(64, 64))).type).toBe("jpeg");
    expect(() => decodeAvatar(png)).toThrow("只接受 WebP 或 JPEG");
    expect(() => decodeAvatar(b64(webp(300, 128)))).toThrow("256×256");
    expect(() => decodeAvatar(b64(webp(128, 128, AVATAR_MAX_BYTES)))).toThrow("40KB");
    expect(() => decodeAvatar("不是 base64")).toThrow();
    expect(() => decodeAvatar(123)).toThrow();
  });
  it("开关：头像开关不开时 avatar 接口不存在；日程归属不开时头像开关也不生效", async () => {
    const s = await team();
    const st = new MemoryAvatarStorage();
    const r1 = await handle(() => s, ctx(ALICE), { action: "members.avatar.set", payload: { image: b64(webp(8, 8)) } }, undefined, undefined, { ...OWNER_ON, avatarStorage: st, throttle: new DenyThrottle() });
    expect(r1).toMatchObject({ ok: false, code: "ADMIN_ONLY" });
    const r2 = await handle(() => s, ctx(OWNER), { action: "members.avatar.set", payload: { image: b64(webp(8, 8)) } }, undefined, undefined, { ...BASE, avatarsEnabled: true, avatarStorage: st, throttle: new DenyThrottle() });
    expect(r2).toMatchObject({ ok: false, code: "UNSUPPORTED_ACTION" });
    expect(st.files.size).toBe(0);
  });
  it("本人上传、替换（旧文件删掉）、清除（恢复默认）；目录里给临时链接；日志只记哈希前 8 位", async () => {
    const { s, call, storage } = await setup();
    const first = await call(ALICE, "members.avatar.set", { image: b64(webp(128, 128)) });
    expect(first.ok).toBe(true);
    const a1 = (s.data.members[ALICE] as any).avatar;
    expect(a1).toMatchObject({ type: "webp", bytes: 30, updatedBy: ALICE });
    expect(a1.fileID).toMatch(/^cloud:\/\/demo\/avatars\/uid-alice\/[0-9a-f]{16}\.webp$/);
    expect((s.data.members[ALICE] as any).color).toBe("c1");
    const dir = await call(BOB, "members.directory");
    const alice = dir.data.people.find((p: { uid: string }) => p.uid === ALICE);
    expect(alice.avatar.url).toMatch(/^data:image\/webp;base64,/);
    expect(JSON.stringify(dir)).not.toContain("cloud://");
    await call(ALICE, "members.avatar.set", { image: b64(jpeg(128, 128)) });
    const a2 = (s.data.members[ALICE] as any).avatar;
    expect(a2.fileID).toMatch(/\.jpg$/);
    expect(storage.removed).toEqual([a1.fileID]);
    expect(storage.files.has(a1.fileID)).toBe(false);
    await call(ALICE, "members.avatar.clear");
    expect((s.data.members[ALICE] as any).avatar).toBeUndefined();
    expect(storage.files.size).toBe(0);
    const entries = logs(s).filter((l) => l.action.startsWith("members.avatar") && l.result === "ok");
    expect(entries.length).toBe(3);
    expect(entries.map((l) => l.after?.avatar).sort()).toEqual([null, a1.hash.slice(0, 8), a2.hash.slice(0, 8)].sort());
    expect(JSON.stringify(entries)).not.toContain("base64");
    expect(JSON.stringify(entries)).not.toContain("cloud://");
  });
  it("成员不能改别人的头像（拒绝并记 denied）；Jason 能替任何成员换或清除；Jason 自己的头像存 _owner_profile", async () => {
    const { s, call, storage } = await setup();
    expect(await call(ALICE, "members.avatar.set", { uid: BOB, image: b64(webp(8, 8)) })).toMatchObject({ ok: false, code: "NOT_OWNER_OF_RECORD" });
    expect(await call(ALICE, "members.avatar.clear", { uid: BOB })).toMatchObject({ ok: false, code: "NOT_OWNER_OF_RECORD" });
    expect(logs(s).some((l) => l.action === "members.avatar.set" && l.result === "denied")).toBe(true);
    expect(storage.files.size).toBe(0);
    expect((await call(OWNER, "members.avatar.set", { uid: BOB, image: b64(webp(8, 8)) })).ok).toBe(true);
    expect((s.data.members[BOB] as any).avatar.updatedBy).toBe(OWNER);
    expect((await call(OWNER, "members.avatar.clear", { uid: BOB })).ok).toBe(true);
    expect((await call(OWNER, "members.avatar.set", { image: b64(webp(8, 8)) })).ok).toBe(true);
    expect((s.data.members._owner_profile as any).avatar.fileID).toContain("avatars/_owner/");
    expect((await call(OWNER, "members.list")).data.members.map((m: { uid: string }) => m.uid)).not.toContain("_owner_profile");
    const dir = await call(ALICE, "members.directory");
    expect(dir.data.people[0]).toMatchObject({ uid: OWNER, name: "Jason", color: "owner" });
    expect(dir.data.people[0].avatar.url).toMatch(/^data:image\/webp/);
    expect(dir.data.people.length).toBe(3);
  });
  it("坏图不上传；旧文件删失败只告警，新头像照样生效；临时链接拿不到时退回默认头像", async () => {
    const storage = new MemoryAvatarStorage();
    const { s, call } = await setup(storage);
    expect(await call(ALICE, "members.avatar.set", { image: png })).toMatchObject({ ok: false, code: "AVATAR_INVALID" });
    expect(storage.files.size).toBe(0);
    await call(ALICE, "members.avatar.set", { image: b64(webp(8, 8)) });
    storage.failRemove = true;
    expect((await call(ALICE, "members.avatar.set", { image: b64(jpeg(8, 8)) })).ok).toBe(true);
    expect((s.data.members[ALICE] as any).avatar.type).toBe("jpeg");
    expect(logs(s).filter((l) => l.action === "members.avatar.set").pop()!.after).toMatchObject({ oldFileKept: true });
    storage.tempUrls = async () => {
      throw new Error("down");
    };
    const dir = await call(BOB, "members.directory");
    expect(dir.ok).toBe(true);
    expect(dir.data.people.every((p: { avatar?: unknown }) => !p.avatar)).toBe(true);
  });
  it("停用成员的头像和颜色保留；停用的人自己改不了，Jason 能清除", async () => {
    const { s, call } = await setup();
    await call(ALICE, "members.avatar.set", { image: b64(webp(8, 8)) });
    await call(OWNER, "members.disable", { uid: ALICE });
    expect((s.data.members[ALICE] as any)).toMatchObject({ color: "c1", avatar: { type: "webp" } });
    expect(await call(ALICE, "members.avatar.clear")).toMatchObject({ ok: false, code: "MEMBER_DISABLED" });
    expect((await call(OWNER, "members.avatar.clear", { uid: ALICE })).ok).toBe(true);
  });
});

describe("只读预演脚本", () => {
  it("算出同步前后条数、撤下清单、第一轮要从手机删的、补色计划；不改输入", async () => {
    const { previewScheduleOwner } = await import("../server/schedule-owner-preview");
    const t = (id: string, at: string, extra = {}) => ({
      id, at, customerId: "c1", title: "回访" + id, feedback: "", nextAction: "", reminder: "off" as const,
      completedAt: null, deletedAt: null, createdAt: NOW, updatedAt: NOW, revision: 1, reminderGeneration: "g", reminderStartAt: NOW, ...extra,
    });
    const tasks = [
      t("jason", "2026-11-20T04:00:00.000Z"),
      t("old", "2026-11-21T04:00:00.000Z", { createdBy: ALICE }),
      t("past", "2026-11-01T04:00:00.000Z", { createdBy: ALICE }),
    ];
    const frozen = JSON.stringify(tasks);
    const out = await previewScheduleOwner({
      tasks, customers: [{ id: "c1", name: "示例客户·甲", mergedInto: null, revision: 1, createdAt: NOW, updatedAt: NOW }],
      members: [{ uid: ALICE, name: "林小雅", status: "active", createdAt: "2026-11-01" }, { uid: BOB, name: "宋阿木", status: "active", createdAt: "2026-11-02", color: "c1" }],
      ownerUid: OWNER, now: NOW,
    });
    expect(out.syncBefore).toBe(2);
    expect(out.syncAfter).toBe(1);
    expect(out.removeFromPhone.map((r) => [r.id, r.owner])).toEqual([["old", "林小雅"]]);
    expect(out.withdrawn.map((r) => r.id)).toEqual(["past", "old"]);
    expect(out.colorPlan).toEqual([{ uid: ALICE, name: "林小雅", color: "c2" }]);
    expect(JSON.stringify(tasks)).toBe(frozen);
  });
});
