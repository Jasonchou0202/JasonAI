/**
 * 团队账号与权限（一期）。
 * - OWNER_UID 永远是管理员：先判、不查库，members 集合空了/坏了也锁不住本人。
 * - MEMBERS_ENABLED 关：只认 OWNER_UID（与原来完全一致）；AUDIT_ENABLED 关：不写日志。
 * - 成员能做什么是白名单，没列出的 action 一律拒绝（新功能默认只有管理员能用）。
 */
import type { Context, Store } from "./service";
import { listAudit, type AuditLog, type AuditQuery } from "./audit";

export interface TeamConfig {
  membersEnabled: boolean;
  auditEnabled: boolean;
  /** 被拒日志节流（测试可传入独立实例；缺省每个云函数实例一份） */
  throttle?: import("./audit").DenyThrottle;
}
export function teamConfigFromEnv(env: Record<string, string | undefined>): TeamConfig {
  return {
    membersEnabled: env.MEMBERS_ENABLED === "1",
    auditEnabled: env.AUDIT_ENABLED === "1",
  };
}
export type Role = "admin" | "member";
export type MemberStatus = "pending" | "active" | "disabled";
export interface Member {
  uid: string;
  name: string;
  status: MemberStatus;
  inviteId: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}
export interface Invite {
  id: string;
  codeHash: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  usedBy: string | null;
  usedAt: string | null;
  revokedAt: string | null;
}
export interface Actor {
  uid: string;
  role: Role | "none";
  name: string;
  status?: MemberStatus;
}
export class DeniedError extends Error {
  constructor(public code: string, message: string, public actor?: Actor) {
    super(message);
  }
}
export const LEGACY_DENIED = "无权访问这个私人账本";
export const INVITE_TTL_MS = 72 * 3600_000;
/** 兑换邀请码：同一 uid 24 小时内最多失败 5 次（防暴力猜码；锁住后不再写库） */
export const REDEEM_MAX_FAILS = 5;
export const REDEEM_WINDOW_MS = 24 * 3600_000;

/** 成员可用的 action（其余全部只给管理员） */
export const MEMBER_ACTIONS = new Set([
  "session", "dashboard",
  "sales.list", "sales.get", "sales.create", "sales.update", "sales.delete",
  "customers", "customers.list", "customers.ranking", "customers.suggestions", "customers.detail",
  "customers.profile.save",
  "tasks.list", "tasks.get", "tasks.create", "tasks.update", "tasks.complete", "tasks.reopen", "tasks.delete",
  "products.list", "products.catalog",
  // 看板洞察（四象限等）用 export 读全部明细；成员本来就能看全部数据，这里只开放读取，界面上不给 CSV 下载按钮
  "export",
  "members.me", "members.redeem", "audit.list",
]);
/** 成员只能对自己录入的记录做的操作 → 对应集合 */
export const OWN_ONLY: Record<string, "sales" | "tasks"> = {
  "sales.update": "sales",
  "sales.delete": "sales",
  "tasks.delete": "tasks",
};
/** 未入队/待批准/已停用的人也能调用的 action（查自己状态、兑换邀请码） */
const GATE_ACTIONS = new Set(["members.me", "members.redeem"]);
const ID = /^[\w-]{1,128}$/;

/** 录入人：没有 createdBy 的旧数据一律视为管理员录入 */
export function recordOwner(row: { createdBy?: string | null } | null, ownerUid: string) {
  return row?.createdBy || ownerUid;
}

export async function authorize(
  store: Store,
  ctx: Context,
  team: TeamConfig,
  action: string,
  payload: Record<string, unknown>,
): Promise<Actor> {
  if (!ctx.ownerUid) throw new Error("后台尚未绑定所有者，暂不允许访问");
  if (!ctx.uid) throw new DeniedError("NOT_SIGNED_IN", LEGACY_DENIED);
  if (ctx.uid === ctx.ownerUid) return { uid: ctx.uid, role: "admin", name: "管理员" };
  if (!team.membersEnabled) throw new DeniedError("NOT_OWNER", LEGACY_DENIED);
  const member = await store.get<Member>("members", ctx.uid);
  if (GATE_ACTIONS.has(action))
    return {
      uid: ctx.uid,
      role: member?.status === "active" ? "member" : "none",
      name: member?.name ?? "",
      status: member?.status,
    };
  if (!member) throw new DeniedError("NOT_MEMBER", "还不是团队成员，请向管理员索取邀请");
  const who: Actor = { uid: ctx.uid, role: "none", name: member.name, status: member.status };
  if (member.status === "pending") throw new DeniedError("MEMBER_PENDING", "等待管理员批准后才能使用", who);
  if (member.status !== "active") throw new DeniedError("MEMBER_DISABLED", "账号已被管理员停用", who);
  const actor: Actor = { ...who, role: "member" };
  if (!MEMBER_ACTIONS.has(action))
    throw new DeniedError("ADMIN_ONLY", "这个操作只有管理员可以进行", actor);
  if ((action === "sales.list" || action === "tasks.list") && payload.deleted)
    throw new DeniedError("ADMIN_ONLY", "回收站只有管理员可以查看", actor);
  // 已删除（在回收站里）的记录成员看不到，与列表一致
  if ((action === "sales.get" || action === "tasks.get") && typeof payload.id === "string" && ID.test(payload.id)) {
    const row = await store.get<{ deletedAt?: string | null }>(action === "sales.get" ? "sales" : "tasks", payload.id);
    if (row?.deletedAt) throw new Error(action === "sales.get" ? "记录不存在" : "日程不存在");
  }
  const own = OWN_ONLY[action];
  if (own && typeof payload.id === "string" && ID.test(payload.id)) {
    const row = await store.get<{ createdBy?: string }>(own, payload.id);
    if (row && recordOwner(row, ctx.ownerUid) !== ctx.uid)
      throw new DeniedError("NOT_OWNER_OF_RECORD", "只能修改或删除自己录入的记录", actor);
  }
  return actor;
}

function text(v: unknown, max: number, label: string) {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max || /[\u0000-\u001f]/.test(v))
    throw new Error(label + "无效");
  return v.trim();
}
function randomCode() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** members.* / audit.list 的执行（权限已由 authorize 判过） */
export async function executeTeam(
  store: Store,
  ctx: Context,
  team: TeamConfig,
  actor: Actor,
  action: string,
  p: Record<string, any>,
  now: () => string,
): Promise<{ data: unknown; target?: { type: string; id: string; before?: unknown; after?: unknown } }> {
  const admin = actor.role === "admin";
  if (action === "members.me") {
    const out: Record<string, unknown> = {
      uid: actor.uid,
      role: actor.role,
      name: actor.name,
      status: admin ? "active" : actor.status ?? "none",
      membersEnabled: team.membersEnabled,
      auditEnabled: team.auditEnabled,
    };
    if (admin && team.auditEnabled)
      out.auditHealth = await store.get("batches", "_audit_health");
    return { data: out };
  }
  if (action === "audit.list") {
    if (!team.auditEnabled) throw new Error("操作日志尚未开启");
    // 成员：无论前端传什么 actor，都只查自己的
    return { data: await listAudit(store, p as AuditQuery, admin ? undefined : actor.uid) };
  }
  if (!team.membersEnabled) throw new Error("团队成员功能尚未开启");
  if (action === "members.redeem") {
    if (admin) throw new Error("管理员不需要兑换邀请");
    const time = now();
    const attemptsId = "_redeem_" + (await ctx.hash("redeem:" + actor.uid)).slice(0, 40);
    const attempts = await store.get<{ count: number; since: string }>("batches", attemptsId);
    const inWindow = !!attempts && Date.parse(time) - Date.parse(attempts.since) < REDEEM_WINDOW_MS;
    if (inWindow && attempts!.count >= REDEEM_MAX_FAILS)
      throw new DeniedError("REDEEM_LOCKED", "邀请码尝试次数过多，请 24 小时后再试或联系管理员");
    const fail = async (error: DeniedError): Promise<never> => {
      await store.put("batches", attemptsId, {
        count: inWindow ? attempts!.count + 1 : 1,
        since: inWindow ? attempts!.since : time,
      });
      throw error;
    };
    const code = typeof p.code === "string" ? p.code.trim().toLowerCase() : "";
    if (!/^[0-9a-f]{32}$/.test(code)) return fail(new DeniedError("INVITE_INVALID", "邀请码无效或已过期"));
    const hash = await ctx.hash("invite:" + code);
    const invites = await store.list<Invite>("invites");
    const invite = invites.find((i) => i.codeHash === hash);
    const usable = (i: Invite | null | undefined): i is Invite =>
      !!i && !i.revokedAt && Date.parse(i.expiresAt) >= Date.parse(time);
    if (!usable(invite)) return fail(new DeniedError("INVITE_INVALID", "邀请码无效或已过期"));
    if (invite.usedBy && invite.usedBy !== actor.uid)
      return fail(new DeniedError("INVITE_USED", "邀请码已被使用"));
    return store.transaction(async (tx) => {
      const old = await tx.get<Member>("members", actor.uid);
      if (old) return { data: { status: old.status }, target: { type: "members", id: actor.uid, after: old } };
      // 事务内重读邀请：并发兑换同一个码时只有一个人成功
      const fresh = await tx.get<Invite>("invites", invite.id);
      if (!usable(fresh)) throw new DeniedError("INVITE_INVALID", "邀请码无效或已过期");
      if (fresh.usedBy && fresh.usedBy !== actor.uid) throw new DeniedError("INVITE_USED", "邀请码已被使用");
      const member: Member = {
        uid: actor.uid,
        name: invite.name,
        status: "pending",
        inviteId: invite.id,
        createdAt: time,
        updatedAt: time,
        revision: 1,
      };
      await tx.put("members", actor.uid, member);
      await tx.put("invites", invite.id, { ...fresh, usedBy: actor.uid, usedAt: time });
      return { data: { status: member.status }, target: { type: "members", id: actor.uid, after: member } };
    });
  }
  if (!admin) throw new DeniedError("ADMIN_ONLY", "这个操作只有管理员可以进行");
  if (action === "members.list") {
    const [members, invites] = await Promise.all([
      store.list<Member>("members"),
      store.list<Invite>("invites"),
    ]);
    return {
      data: {
        members: members.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        invites: invites
          .filter((i) => !i.usedBy && !i.revokedAt)
          .map(({ codeHash: _hidden, ...rest }) => rest)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      },
    };
  }
  if (action === "members.invite.create") {
    const name = text(p.name, 20, "备注名");
    const code = randomCode();
    const time = now();
    const invite: Invite = {
      id: "inv_" + (await ctx.hash("invite-id:" + code)).slice(0, 24),
      codeHash: await ctx.hash("invite:" + code),
      name,
      createdAt: time,
      expiresAt: new Date(Date.parse(time) + INVITE_TTL_MS).toISOString(),
      usedBy: null,
      usedAt: null,
      revokedAt: null,
    };
    await store.put("invites", invite.id, invite);
    // 明文邀请码只在这次响应里出现一次，库里和日志里都只有哈希/不记
    return { data: { id: invite.id, code, name, expiresAt: invite.expiresAt }, target: { type: "invites", id: invite.id, after: invite } };
  }
  if (action === "members.invite.revoke") {
    const id = typeof p.id === "string" && ID.test(p.id) ? p.id : "";
    if (!id) throw new Error("邀请编号无效");
    return store.transaction(async (tx) => {
      const old = await tx.get<Invite>("invites", id);
      if (!old) throw new Error("邀请不存在");
      const row = { ...old, revokedAt: old.revokedAt ?? now() };
      await tx.put("invites", id, row);
      return { data: { revoked: true }, target: { type: "invites", id, before: old, after: row } };
    });
  }
  if (action === "members.approve" || action === "members.disable" || action === "members.enable") {
    const uid = typeof p.uid === "string" && ID.test(p.uid) ? p.uid : "";
    if (!uid) throw new Error("成员编号无效");
    if (uid === ctx.ownerUid) throw new Error("不能修改管理员本人");
    const status: MemberStatus = action === "members.disable" ? "disabled" : "active";
    return store.transaction(async (tx) => {
      const old = await tx.get<Member>("members", uid);
      if (!old) throw new Error("成员不存在");
      if (action === "members.approve" && old.status !== "pending") throw new Error("这位成员不在待批准状态");
      if (action === "members.enable" && old.status !== "disabled") throw new Error("这位成员没有被停用");
      const row: Member = { ...old, status, updatedAt: now(), revision: old.revision + 1 };
      await tx.put("members", uid, row);
      return { data: row, target: { type: "members", id: uid, before: old, after: row } };
    });
  }
  throw new Error("不支持的操作");
}

/** 方便日志：某个审计日志对象（来自 audit.ts） */
export type { AuditLog };
