/**
 * 团队账号与权限（一期）。
 * - OWNER_UID 永远是管理员：先判、不查库，members 集合空了/坏了也锁不住本人。
 * - MEMBERS_ENABLED 关：只认 OWNER_UID（与原来完全一致）；AUDIT_ENABLED 关：不写日志。
 * - 成员能做什么是白名单，没列出的 action 一律拒绝（新功能默认只有管理员能用）。
 */
import { UnsupportedActionError, type Context, type Store } from "./service";
import { AUDIT_HEALTH_COLLECTION, AUDIT_HEALTH_ID, listAudit, type AuditLog, type AuditQuery } from "./audit";
import { colorKeyAt, isColorKey, type ColorKey } from "../src/domain/members";
import { decodeAvatar, type AvatarRef, type AvatarStorage } from "./avatar";

export interface TeamConfig {
  membersEnabled: boolean;
  auditEnabled: boolean;
  /** 被拒日志节流（测试可传入独立实例；缺省每个云函数实例一份） */
  throttle?: import("./audit").DenyThrottle;
  /** 日程归属 + 成员固定颜色（SCHEDULE_OWNER_ENABLED=1；要 MEMBERS_ENABLED=1 才生效）；缺省关，行为与现在完全一致 */
  scheduleOwnerEnabled?: boolean;
  /** 成员头像（AVATARS_ENABLED=1；要日程归属也开着、并且有云存储）；可以晚一步上 */
  avatarsEnabled?: boolean;
  /** sales 加删除人、修改人（SALES_ACTOR_FIELDS_ENABLED=1；改冻结集合 sales，单独解冻） */
  salesActorFieldsEnabled?: boolean;
  /** 报销记账（EXPENSES_ENABLED=1）；缺省关：侧栏、看板三段、写入都不出现 */
  expensesEnabled?: boolean;
  /** 销售记录「谁付的」（SALES_PAYER_ENABLED=1；改冻结集合 sales，单独解冻，不回填历史） */
  salesPayerEnabled?: boolean;
  /** 头像用的云存储（云函数入口传 CloudBase 云存储，测试/演示传内存版） */
  avatarStorage?: AvatarStorage;
  /** 云函数告警日志（不写库） */
  warn?: (code: string) => void;
}
export function teamConfigFromEnv(env: Record<string, string | undefined>): TeamConfig {
  return {
    membersEnabled: env.MEMBERS_ENABLED === "1",
    auditEnabled: env.AUDIT_ENABLED === "1",
    ...(env.SCHEDULE_OWNER_ENABLED === "1" ? { scheduleOwnerEnabled: true } : {}),
    ...(env.AVATARS_ENABLED === "1" ? { avatarsEnabled: true } : {}),
    ...(env.SALES_ACTOR_FIELDS_ENABLED === "1" ? { salesActorFieldsEnabled: true } : {}),
    ...(env.EXPENSES_ENABLED === "1" ? { expensesEnabled: true } : {}),
    ...(env.SALES_PAYER_ENABLED === "1" ? { salesPayerEnabled: true } : {}),
  };
}
/** 日程归属真正生效：两个开关都开 */
export const ownerOn = (t: TeamConfig) => !!(t.membersEnabled && t.scheduleOwnerEnabled);
/** 头像真正生效：日程归属开 + 头像开 + 有云存储 */
export const avatarsOn = (t: TeamConfig) => ownerOn(t) && !!t.avatarsEnabled && !!t.avatarStorage;
/** sales 新字段真正生效 */
export const salesActorOn = (t: TeamConfig) => !!(t.membersEnabled && t.salesActorFieldsEnabled);
/** 报销记账开关 */
export const expensesOn = (t: TeamConfig) => !!t.expensesEnabled;
/** 进货「谁付的」开关（不依赖团队开关，与报销一并在合账里用） */
export const salesPayerOn = (t: TeamConfig) => !!t.salesPayerEnabled;
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
  /** 固定颜色 c1～c7：批准入队时写入，之后不再改（日程归属开关开后才有） */
  color?: ColorKey;
  /** 上传的头像（头像开关开后才有） */
  avatar?: AvatarRef;
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
/** 日程归属开关开后，成员额外可用的 action */
export const OWNER_MEMBER_ACTIONS = new Set(["tasks.claim", "members.directory"]);
/** 头像开关开后，成员额外可用的 action（云端强制只能改自己的） */
export const AVATAR_MEMBER_ACTIONS = new Set(["members.avatar.set", "members.avatar.clear"]);
/** 报销开关开后，成员额外可用的 action（只能动自己的记录） */
export const EXPENSE_MEMBER_ACTIONS = new Set([
  "expenses.meta",
  "expenses.list",
  "expenses.get",
  "expenses.create",
  "expenses.update",
  "expenses.delete",
  "expenses.categories.create",
  "expenses.settlement",
  "expenses.shares",
]);
/** Jason 的头像等资料：members 里的系统文档（_ 开头，不算成员） */
export const OWNER_PROFILE_ID = "_owner_profile";
/** 分色计数器（系统文档，_ 开头不算成员）：下一个入队的人用第 next 个颜色 */
export const COLOR_COUNTER_ID = "_color_counter";
interface ColorCounter {
  uid: string;
  next: number;
  updatedAt: string;
}
/** 成员只能对自己录入的记录做的操作 → 对应集合 */
export const OWN_ONLY: Record<string, "sales" | "tasks" | "expenses"> = {
  "sales.update": "sales",
  "sales.delete": "sales",
  "tasks.delete": "tasks",
  "expenses.update": "expenses",
  "expenses.delete": "expenses",
};
/** 未入队/待批准/已停用的人也能调用的 action（查自己状态、兑换邀请码） */
const GATE_ACTIONS = new Set(["members.me", "members.redeem"]);
export const REDEEM_COLLECTION = "redeem_attempts" as const;
/** members 集合里 _ 开头的是系统文档（如 _audit_health），不是成员 */
const isMember = (m: Partial<Member> | null | undefined): m is Member =>
  !!m && typeof m.uid === "string" && !m.uid.startsWith("_");
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
  const member = ctx.uid.startsWith("_") ? null : await store.get<Member>("members", ctx.uid);
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
  const allowed =
    MEMBER_ACTIONS.has(action) ||
    (ownerOn(team) && OWNER_MEMBER_ACTIONS.has(action)) ||
    (avatarsOn(team) && AVATAR_MEMBER_ACTIONS.has(action)) ||
    (expensesOn(team) && EXPENSE_MEMBER_ACTIONS.has(action));
  if (!allowed)
    throw new DeniedError("ADMIN_ONLY", "这个操作只有管理员可以进行", actor);
  // 回收站只给管理员：成员任何 action 只要带了 deleted（sales.list / tasks.list / export 等）一律拒绝
  if (payload.deleted !== undefined && payload.deleted !== false && payload.deleted !== null)
    throw new DeniedError("ADMIN_ONLY", "回收站只有管理员可以查看", actor);
  // 已删除（在回收站里）的记录成员看不到，与列表一致
  if ((action === "sales.get" || action === "tasks.get") && typeof payload.id === "string" && ID.test(payload.id)) {
    const row = await store.get<{ deletedAt?: string | null }>(action === "sales.get" ? "sales" : "tasks", payload.id);
    if (row?.deletedAt) throw new Error(action === "sales.get" ? "记录不存在" : "日程不存在");
  }
  // 日程归属开后：成员可以删别人的日程（进回收站，只有管理员能恢复）；销售那两项仍只能动自己的
  const own = ownerOn(team) && action === "tasks.delete" ? undefined : OWN_ONLY[action];
  if (own && typeof payload.id === "string" && ID.test(payload.id)) {
    const row = await store.get<{ createdBy?: string }>(own, payload.id);
    if (row && recordOwner(row, ctx.ownerUid) !== ctx.uid)
      throw new DeniedError("NOT_OWNER_OF_RECORD", "只能修改或删除自己录入的记录", actor);
  }
  return actor;
}

/**
 * 成员读数据时用的存储视图：sales / tasks 里已删除（回收站）的记录读不到，
 * 列表里没有、按 id 取返回空——dashboard / 客户详情 / 排行 / 导出等所有读路径一律看不到已删数据。
 * 只用于成员的读操作；写操作和管理员仍用原存储。
 */
export function hideDeleted(store: Store): Store {
  const trash = (c: string) => c === "sales" || c === "tasks" || c === "expenses";
  const alive = <T>(c: string, row: T | null): T | null =>
    trash(c) && row && (row as { deletedAt?: unknown }).deletedAt ? null : row;
  return {
    get: async <T>(c: Parameters<Store["get"]>[0], id: string) => alive<T>(c, await store.get<T>(c, id)),
    list: async <T>(c: Parameters<Store["list"]>[0]) =>
      (await store.list<T>(c)).filter((r) => alive(c, r) !== null),
    put: (c, id, v) => store.put(c, id, v),
    del: (c, id) => store.del(c, id),
    transaction: (fn) =>
      store.transaction((tx) =>
        fn({
          get: async <T>(c: Parameters<Store["get"]>[0], id: string) => alive<T>(c, await tx.get<T>(c, id)),
          put: (c, id, v) => tx.put(c, id, v),
          del: (c, id) => tx.del(c, id),
        }),
      ),
  } as Store;
}
/** 成员读结果再过滤：目录回收站里（已归档）的客户成员也看不到 */
export function memberResult(action: string, data: unknown): unknown {
  const archived = (c: unknown) => !!(c && typeof c === "object" && (c as { archivedAt?: unknown }).archivedAt);
  if (action === "customers.detail" && data && typeof data === "object" && archived((data as { customer?: unknown }).customer))
    throw new Error("客户不存在");
  if (action === "customers.suggestions" && Array.isArray(data))
    return data
      .map((g) => {
        const members = (g.members as { customer: unknown; totals: { revenue: number; cost: number; profit: number; count: number }; taskCount: number }[])
          .filter((m) => !archived(m.customer));
        if (members.length === g.members.length) return g;
        if (members.length < 2 || !members.some((m) => (m.customer as { id: string }).id === g.targetId)) return null;
        return {
          ...g,
          members,
          totals: members.reduce(
            (t, m) => ({ revenue: t.revenue + m.totals.revenue, cost: t.cost + m.totals.cost, profit: t.profit + m.totals.profit, count: t.count + m.totals.count }),
            { revenue: 0, cost: 0, profit: 0, count: 0 },
          ),
          taskCount: members.reduce((n, m) => n + m.taskCount, 0),
        };
      })
      .filter(Boolean);
  return data;
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
      out.auditHealth = await store.get(AUDIT_HEALTH_COLLECTION, AUDIT_HEALTH_ID);
    // 新开关只在打开时才出现在返回里（关着时返回与现在逐字一致）
    if (ownerOn(team)) {
      out.scheduleOwnerEnabled = true;
      out.ownerUid = ctx.ownerUid;
      if (avatarsOn(team)) out.avatarsEnabled = true;
    }
    if (expensesOn(team)) out.expensesEnabled = true;
    if (salesPayerOn(team)) out.salesPayerEnabled = true;
    return { data: out };
  }
  if (action === "audit.list") {
    if (!team.auditEnabled) throw new Error("操作日志尚未开启");
    // 成员：无论前端传什么 actor，都只查自己的
    // 日程归属开后更严：成员点名要看别人的，直接拒绝并记一条「被拒」
    if (!admin && ownerOn(team) && typeof p.actor === "string" && p.actor && p.actor !== actor.uid)
      throw new DeniedError("SELF_ONLY", "只能查看自己的操作记录", actor);
    return { data: await listAudit(store, p as AuditQuery, admin ? undefined : actor.uid, ownerOn(team) ? { groups: true } : {}) };
  }
  if (!team.membersEnabled) throw new Error("团队成员功能尚未开启");
  if (action === "members.redeem") {
    if (admin) throw new Error("管理员不需要兑换邀请");
    const time = now();
    // 尝试次数放在新集合 redeem_attempts（规则全不可读写），不写入任何已有集合
    const attemptsId = "r_" + (await ctx.hash("redeem:" + actor.uid)).slice(0, 40);
    const attempts = await store.get<{ count: number; since: string }>(REDEEM_COLLECTION, attemptsId);
    const inWindow = !!attempts && Date.parse(time) - Date.parse(attempts.since) < REDEEM_WINDOW_MS;
    if (inWindow && attempts!.count >= REDEEM_MAX_FAILS)
      throw new DeniedError("REDEEM_LOCKED", "邀请码尝试次数过多，请 24 小时后再试或联系管理员");
    const fail = async (error: DeniedError): Promise<never> => {
      await store.put(REDEEM_COLLECTION, attemptsId, {
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
  if (action === "members.directory" && ownerOn(team)) return { data: await directory(store, ctx, team) };
  if ((action === "members.avatar.set" || action === "members.avatar.clear") && avatarsOn(team))
    return setAvatar(store, ctx, team, actor, action, p, now);
  if (!admin) throw new DeniedError("ADMIN_ONLY", "这个操作只有管理员可以进行");
  if (action === "members.color.fill" && ownerOn(team)) return fillColors(store, now);
  if (action === "members.list") {
    const [members, invites] = await Promise.all([
      store.list<Member>("members"),
      store.list<Invite>("invites"),
    ]);
    return {
      data: {
        members: members.filter(isMember).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
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
    if (!uid || uid.startsWith("_")) throw new Error("成员编号无效");
    if (uid === ctx.ownerUid) throw new Error("不能修改管理员本人");
    const status: MemberStatus = action === "members.disable" ? "disabled" : "active";
    // 入队时自动分色：按分色计数器往下排，7 色用完从头循环；写入后不再改。
    // 计数器文档 members/_color_counter 在同一个事务里读、写，两个人同时被批准也不会撞色；
    // 计数器还不存在时（上线第一次）用已有颜色的人数做起点（只是起点，真正的序号以事务里的计数器为准）
    const colorOn = action === "members.approve" && ownerOn(team);
    const seed = colorOn
      ? (await store.list<Member>("members")).filter((m) => isMember(m) && isColorKey(m.color)).length
      : 0;
    return store.transaction(async (tx) => {
      const old = await tx.get<Member>("members", uid);
      if (!old) throw new Error("成员不存在");
      if (action === "members.approve" && old.status !== "pending") throw new Error("这位成员不在待批准状态");
      if (action === "members.enable" && old.status !== "disabled") throw new Error("这位成员没有被停用");
      let color: ColorKey | undefined;
      if (colorOn && !isColorKey(old.color)) {
        const counter = await tx.get<ColorCounter>("members", COLOR_COUNTER_ID);
        const n = Math.max(counter?.next ?? 0, seed);
        color = colorKeyAt(n);
        await tx.put("members", COLOR_COUNTER_ID, { uid: COLOR_COUNTER_ID, next: n + 1, updatedAt: now() });
      }
      const row: Member = {
        ...old,
        status,
        updatedAt: now(),
        revision: old.revision + 1,
        ...(color ? { color } : {}),
      };
      await tx.put("members", uid, row);
      return { data: row, target: { type: "members", id: uid, before: old, after: row } };
    });
  }
  throw new UnsupportedActionError();
}

/** 所有已入队的人（含停用，保留原色）：只给 uid、名字、颜色、头像临时链接 */
async function directory(store: Store, ctx: Context, team: TeamConfig) {
  const [rows, profile] = await Promise.all([
    store.list<Member>("members"),
    store.get<{ name?: string; avatar?: AvatarRef }>("members", OWNER_PROFILE_ID),
  ]);
  const people = rows
    .filter((m) => isMember(m) && m.status !== "pending")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.uid.localeCompare(b.uid));
  let urls = new Map<string, string>();
  if (avatarsOn(team)) {
    const ids = [profile?.avatar?.fileID, ...people.map((m) => m.avatar?.fileID)].filter((x): x is string => !!x);
    if (ids.length)
      try {
        urls = await team.avatarStorage!.tempUrls(ids);
      } catch {
        team.warn?.("avatar.url_failed"); // 拿不到链接就退回默认头像
      }
  }
  const pic = (a?: AvatarRef) => {
    const url = a && urls.get(a.fileID);
    return url ? { avatar: { url, hash: a.hash } } : {};
  };
  return {
    ownerUid: ctx.ownerUid,
    avatarsEnabled: avatarsOn(team),
    people: [
      { uid: ctx.ownerUid, name: profile?.name || "Jason", role: "admin", status: "active", color: "owner", ...pic(profile?.avatar) },
      ...people.map((m) => ({ uid: m.uid, name: m.name, role: "member", status: m.status, color: m.color ?? null, ...pic(m.avatar) })),
    ],
  };
}

/** 一次性补色：给还没有颜色的成员按入队先后分色；重复运行不会再改 */
async function fillColors(store: Store, now: () => string) {
  const rows = (await store.list<Member>("members"))
    .filter((m) => isMember(m) && m.status !== "pending")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.uid.localeCompare(b.uid));
  const seed = rows.filter((m) => isColorKey(m.color)).length;
  const todo = rows.filter((m) => !isColorKey(m.color));
  const filled: { uid: string; color: ColorKey }[] = [];
  await store.transaction(async (tx) => {
    // 和入队分色共用同一个计数器，在同一个事务里读写
    const counter = await tx.get<ColorCounter>("members", COLOR_COUNTER_ID);
    let n = Math.max(counter?.next ?? 0, seed);
    for (const m of todo) {
      const fresh = await tx.get<Member>("members", m.uid);
      if (!fresh || isColorKey(fresh.color)) continue;
      const color = colorKeyAt(n++);
      await tx.put("members", m.uid, { ...fresh, color, updatedAt: now(), revision: fresh.revision + 1 });
      filled.push({ uid: m.uid, color });
    }
    if (filled.length) await tx.put("members", COLOR_COUNTER_ID, { uid: COLOR_COUNTER_ID, next: n, updatedAt: now() });
  });
  return {
    data: { filled },
    target: { type: "members", id: "_color_fill", after: { count: filled.length, colors: filled } },
  };
}

/** 换头像 / 清除头像：本人或管理员；管理员的头像存 members/_owner_profile */
async function setAvatar(
  store: Store,
  ctx: Context,
  team: TeamConfig,
  actor: Actor,
  action: string,
  p: Record<string, any>,
  now: () => string,
): Promise<{ data: unknown; target: { type: string; id: string; before?: unknown; after?: unknown } }> {
  const admin = actor.role === "admin";
  const uid = p.uid === undefined || p.uid === null || p.uid === "" ? actor.uid : p.uid;
  if (typeof uid !== "string" || !ID.test(uid) || uid.startsWith("_")) throw new Error("成员编号无效");
  if (!admin && uid !== actor.uid) throw new DeniedError("NOT_OWNER_OF_RECORD", "只能修改自己的头像", actor);
  const isOwner = uid === ctx.ownerUid;
  const docId = isOwner ? OWNER_PROFILE_ID : uid;
  if (!isOwner) {
    const m = await store.get<Member>("members", uid);
    if (!m || m.status === "pending") throw new Error("成员不存在");
  }
  const storage = team.avatarStorage!;
  const time = now();
  let ref: AvatarRef | undefined;
  if (action === "members.avatar.set") {
    const { bytes, type } = decodeAvatar(p.image);
    const hash = (await ctx.hash("avatar:" + String(p.image))).slice(0, 16);
    const fileID = await storage.upload(`avatars/${isOwner ? "_owner" : uid}/${hash}.${type === "webp" ? "webp" : "jpg"}`, bytes);
    ref = { fileID, hash, bytes: bytes.length, type, updatedAt: time, updatedBy: actor.uid };
  }
  let old: (Partial<Member> & { avatar?: AvatarRef }) | null = null;
  let row: Record<string, unknown>;
  try {
    ({ old, row } = await store.transaction(async (tx) => {
      const prev = await tx.get<Partial<Member> & { avatar?: AvatarRef }>("members", docId);
      if (!isOwner && !prev) throw new Error("成员不存在");
      const { avatar: _old, ...rest } = prev ?? { uid: OWNER_PROFILE_ID };
      const next: Record<string, unknown> = {
        ...rest,
        ...(ref ? { avatar: ref } : {}),
        ...(isOwner ? { updatedAt: time } : { updatedAt: time, revision: (prev!.revision ?? 0) + 1 }),
      };
      await tx.put("members", docId, next);
      return { old: prev, row: next };
    }));
  } catch (error) {
    if (ref) await storage.remove(ref.fileID).catch(() => team.warn?.("avatar.orphan_delete_failed"));
    throw error;
  }
  // 先写新头像，再删旧文件；旧文件删失败只告警，不影响新头像
  let oldFileKept = false;
  const oldId = old?.avatar?.fileID;
  if (oldId && oldId !== ref?.fileID)
    try {
      await storage.remove(oldId);
    } catch {
      oldFileKept = true;
      team.warn?.("avatar.old_delete_failed");
    }
  return {
    data: { uid, avatar: ref ? { hash: ref.hash } : null },
    target: {
      type: "members",
      id: docId,
      before: old ? { uid, name: old.name, avatar: old.avatar } : { uid },
      after: { uid, name: old?.name, avatar: ref, ...(oldFileKept ? { oldFileKept: true } : {}) },
    },
  };
}

/** 方便日志：某个审计日志对象（来自 audit.ts） */
export type { AuditLog };
