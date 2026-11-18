/**
 * miniapp 云函数的门卫层（第 1 批）。
 * openid → 查绑定 → 设好 uid → 交给原来的 handle() / authorize()；权限和网页完全一致。
 * 另外负责：Jason 本人绑定码、成员申请/审批/拒绝/拉黑、绑定管理、开关核对。
 * MINIAPP_ENABLED 关：除 miniapp.ping 外一律返回 MINIAPP_OFF。
 */
import { colorKeyAt, isColorKey, type ColorKey } from "../../src/domain/members";
import type { Member, TeamConfig } from "../team";
import { resolveSource, SourceError, type PlatformIdentity } from "./source";
import {
  CODE_ALPHABET,
  LIMITS,
  type Application,
  type Attempts,
  type BindCode,
  type Binding,
  type MiniStore,
  type Source,
} from "./types";

export interface MiniappConfig {
  enabled: boolean;
  /** 可选：只认这个小程序的 AppID（不是密钥） */
  appId?: string;
}
export function miniappConfigFromEnv(env: Record<string, string | undefined>): MiniappConfig {
  return {
    enabled: env.MINIAPP_ENABLED === "1",
    ...(env.MINIAPP_APPID ? { appId: env.MINIAPP_APPID } : {}),
  };
}

export interface AuditNote {
  actorUid: string;
  actorName: string;
  role: string;
  action: string;
  targetType: string;
  targetId: string;
  result: "ok" | "denied" | "failed";
  after?: Record<string, unknown> | null;
  reason?: string;
}
export interface MiniappDeps {
  store: () => MiniStore;
  ownerUid: string;
  config: MiniappConfig;
  team: TeamConfig;
  now: () => string;
  /** sha256 hex */
  hash: (text: string) => Promise<string>;
  /** 密码学随机字节 */
  random: (n: number) => Uint8Array;
  /** 已认出身份后，把业务调用交给原来的 handle()（uid 是绑定的网页/wx_ uid） */
  business: (uid: string, event: { action: string; payload: unknown }) => Promise<unknown>;
  /** AUDIT_ENABLED 开时写操作日志（不含手机号） */
  audit?: (note: AuditNote) => Promise<void>;
  diagnose?: (code: string) => void;
}

export class MiniappError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}
const deny = (code: string, message: string) => new MiniappError(code, message);
const NO_ACCESS = () => deny("NO_ACCESS", "无权限");

/** 网页来源能调的（都只给 Jason 本人） */
export const WEB_ACTIONS = new Set([
  "miniapp.owner.code",
  "miniapp.apply.list",
  "miniapp.apply.approve",
  "miniapp.apply.reject",
  "miniapp.apply.block",
  "miniapp.apply.unblock",
  "miniapp.bind.list",
  "miniapp.bind.revoke",
  "miniapp.flags",
]);
/** 小程序里还没绑定的人能调的 */
export const UNBOUND_ACTIONS = new Set(["miniapp.me", "miniapp.apply", "miniapp.owner.redeem"]);
/** 小程序里绑定为 Jason 本人后，额外能调的管理调用（绑定码只能网页生成） */
export const OWNER_MINIAPP_ACTIONS = new Set([...WEB_ACTIONS].filter((a) => a !== "miniapp.owner.code"));
/** 小程序里不转给业务代码的：网页推送（小程序改用订阅消息，第 3 批） */
const BLOCKED_BUSINESS = (action: string) => action.startsWith("push.") || action.startsWith("miniapp.");

const ACTION = /^[a-z][\w.]{0,63}$/i;
const APP_ID = /^a_[0-9a-f]{40}$/;
const BIND_ID = /^b_[0-9a-f]{40}$/;
const MEMBER_UID = /^[\w-]{1,128}$/;
const NAME = /^[\p{L}\p{N}·・ _-]{1,20}$/u;
const PHONE = /^1\d{10}$/;

function failure(error: unknown, diagnose?: (code: string) => void) {
  const code =
    error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  const safeCode = /^[A-Za-z0-9_.-]{1,100}$/.test(code) ? code : undefined;
  if (safeCode) diagnose?.(safeCode);
  const text = error instanceof Error ? error.message : "";
  return {
    ok: false as const,
    ...(safeCode ? { code: safeCode } : {}),
    error: /[\u4e00-\u9fa5]/.test(text) && text.length <= 200 ? text : "云端操作未完成，请稍后重试",
  };
}

/** 138****1234 */
export function maskPhone(phone: string) {
  return PHONE.test(phone) ? phone.slice(0, 3) + "****" + phone.slice(7) : "";
}
/** 同一个微信（appid+openid）的稳定哈希；绑定、申请、wx_ uid 都由它派生 */
async function wxKey(hash: MiniappDeps["hash"], s: Extract<Source, { kind: "miniapp" }>) {
  const h = await hash("miniapp:" + s.appid + ":" + s.openid);
  return {
    bindId: "b_" + h.slice(0, 40),
    appId: "a_" + h.slice(0, 40),
    attemptsId: "r_" + h.slice(0, 40),
    wxUid: "wx_" + (await hash("wxuid:" + s.appid + ":" + s.openid)).slice(0, 32),
  };
}
const isMember = (m: Partial<Member> | null | undefined): m is Member =>
  !!m && typeof m.uid === "string" && !m.uid.startsWith("_");
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const hourKey = (iso: string) => iso.slice(0, 13).replace(/[-T:]/g, "");

function randomCode(random: MiniappDeps["random"]) {
  // 拒绝采样，避免取模偏差
  const out: string[] = [];
  const limit = 256 - (256 % CODE_ALPHABET.length);
  while (out.length < LIMITS.codeLength) {
    for (const b of random(16)) {
      if (b < limit && out.length < LIMITS.codeLength) out.push(CODE_ALPHABET[b % CODE_ALPHABET.length]);
    }
  }
  return out.join("");
}
export function normalizeCode(raw: unknown) {
  if (typeof raw !== "string") return "";
  const code = raw.replace(/[\s-]/g, "").toUpperCase();
  return code.length === LIMITS.codeLength && [...code].every((c) => CODE_ALPHABET.includes(c)) ? code : "";
}

interface Who {
  role: "owner" | "member" | "none";
  uid: string;
  name: string;
  source: Source;
  binding?: Binding;
  key?: Awaited<ReturnType<typeof wxKey>>;
}

export async function handleMiniapp(deps: MiniappDeps, platform: PlatformIdentity, event: unknown) {
  try {
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("请求格式无效");
    const e = event as { action?: unknown; payload?: unknown };
    let source: Source | null = null;
    let sourceError: unknown = null;
    try {
      source = resolveSource(event, platform, deps.config.appId);
    } catch (error) {
      sourceError = error;
    }
    // ping：不需要身份，只回开关和来源类型（不回任何编号），用来测通 + 实测来源识别
    if (e.action === "miniapp.ping")
      return {
        ok: true,
        data: {
          pong: true,
          enabled: deps.config.enabled,
          source: source?.kind ?? "none",
          ...(sourceError instanceof SourceError && sourceError.code === "HTTP_NOT_ALLOWED" ? { http: true } : {}),
        },
      };
    if (!source) throw sourceError;
    if (typeof e.action !== "string" || !ACTION.test(e.action)) throw new Error("请求格式无效");
    if (!deps.ownerUid) throw new Error("后台尚未绑定所有者，暂不允许访问");
    if (!deps.config.enabled) throw deny("MINIAPP_OFF", "小程序暂未开放");
    const action = e.action;
    const payload =
      e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
        ? (e.payload as Record<string, unknown>)
        : {};
    const store = deps.store();
    const who = await identify(deps, store, source);
    // 网页来源：只开放管理调用，而且只给 Jason 本人；不会成为网页的第二个业务入口
    if (source.kind === "web") {
      if (!WEB_ACTIONS.has(action)) throw deny("WEB_NOT_ALLOWED", "这个调用只给小程序用");
      if (who.role !== "owner") throw deny("ADMIN_ONLY", "这个操作只有管理员可以进行");
      return { ok: true, data: await adminAction(deps, store, who, action, payload) };
    }
    if (action === "miniapp.me") return { ok: true, data: await me(deps, store, who) };
    if (action === "miniapp.apply") return { ok: true, data: await apply(deps, store, who, payload) };
    if (action === "miniapp.owner.redeem") return { ok: true, data: await redeem(deps, store, who, payload) };
    if (who.role === "none") throw NO_ACCESS();
    if (action === "miniapp.bind.leave") return { ok: true, data: await leave(deps, store, who) };
    if (action.startsWith("miniapp.")) {
      if (who.role !== "owner" || !OWNER_MINIAPP_ACTIONS.has(action))
        throw deny(action === "miniapp.owner.code" ? "WEB_ONLY" : "ADMIN_ONLY", action === "miniapp.owner.code" ? "绑定码只能在网页上生成" : "这个操作只有管理员可以进行");
      return { ok: true, data: await adminAction(deps, store, who, action, payload) };
    }
    if (BLOCKED_BUSINESS(action)) throw deny("NOT_IN_MINIAPP", "小程序里暂不支持这个操作");
    await touch(deps, store, who);
    // 交给原来的 handle()：权限、数据归属、日志和网页完全一致（成员在网页被停用，这里同样被拒）
    return await deps.business(who.uid, { action, payload });
  } catch (error) {
    return failure(error, deps.diagnose);
  }
}

async function identify(deps: MiniappDeps, store: MiniStore, source: Source): Promise<Who> {
  if (source.kind === "web")
    return source.uid === deps.ownerUid
      ? { role: "owner", uid: source.uid, name: "管理员", source }
      : { role: "none", uid: source.uid, name: "", source };
  const key = await wxKey(deps.hash, source);
  const binding = await store.get<Binding>("miniapp_bindings", key.bindId);
  if (binding?.status === "active") {
    if (binding.kind === "owner" && binding.uid === deps.ownerUid)
      return { role: "owner", uid: binding.uid, name: "管理员", source, binding, key };
    if (binding.kind === "member" && binding.uid !== deps.ownerUid && !binding.uid.startsWith("_"))
      return { role: "member", uid: binding.uid, name: "", source, binding, key };
  }
  return { role: "none", uid: "", name: "", source, ...(binding ? { binding } : {}), key };
}

/** 最多一天写一次 lastSeenAt；顺手补上 openid（第 3 批订阅消息要用）。失败不影响请求 */
async function touch(deps: MiniappDeps, store: MiniStore, who: Who) {
  const b = who.binding;
  if (!b || who.source.kind !== "miniapp") return;
  const time = deps.now();
  const stale = !b.lastSeenAt || ms(time) - ms(b.lastSeenAt) >= LIMITS.lastSeenEveryMs;
  if (!stale && b.openid) return;
  await store
    .put<Binding>("miniapp_bindings", b.id, { ...b, lastSeenAt: time, openid: who.source.openid })
    .catch(() => deps.diagnose?.("miniapp.touch_failed"));
}

async function note(deps: MiniappDeps, who: Who, action: string, targetType: string, targetId: string, after?: Record<string, unknown>) {
  if (!deps.team.auditEnabled || !deps.audit) return;
  await deps
    .audit({
      actorUid: who.uid,
      actorName: who.name || (who.role === "owner" ? "管理员" : "小程序用户"),
      role: who.role === "owner" ? "admin" : who.role === "member" ? "member" : "none",
      action,
      targetType,
      targetId,
      result: "ok",
      after: { ...(after ?? {}), via: "miniapp" },
    })
    .catch(() => deps.diagnose?.("miniapp.audit_failed"));
}

async function me(deps: MiniappDeps, store: MiniStore, who: Who) {
  const base = { enabled: deps.config.enabled, membersEnabled: deps.team.membersEnabled };
  if (who.role === "owner") return { ...base, status: "owner", role: "admin", name: "管理员" };
  if (who.role === "member") {
    const m = await store.get<Member>("members", who.uid);
    const status = !m ? "none" : m.status === "active" ? "member" : m.status === "disabled" ? "disabled" : "pending";
    return { ...base, status, role: status === "member" ? "member" : "none", name: m?.name ?? "" };
  }
  const app = await store.get<Application>("miniapp_applications", who.key!.appId);
  if (!app || (app.status === "approved" && who.binding?.status !== "active")) return { ...base, status: "none" };
  const out: Record<string, unknown> = { ...base, status: app.status, name: app.name };
  if (app.status === "rejected" && app.decidedAt)
    out.retryAt = new Date(ms(app.decidedAt) + LIMITS.rejectCooldownMs).toISOString();
  if (app.status === "blocked") return { ...base, status: "blocked" };
  return out;
}

async function apply(deps: MiniappDeps, store: MiniStore, who: Who, p: Record<string, unknown>) {
  if (who.role !== "none") throw deny("ALREADY_BOUND", "这个微信已经可以使用，不需要再申请");
  const name = typeof p.name === "string" ? p.name.trim() : "";
  const phone = typeof p.phone === "string" ? p.phone.trim() : "";
  if (!NAME.test(name)) throw deny("APPLY_NAME_INVALID", "姓名请填 1～20 个字，不要带特殊符号");
  if (!PHONE.test(phone)) throw deny("APPLY_PHONE_INVALID", "手机号请填 11 位、1 开头");
  if (p.agree !== true) throw deny("APPLY_AGREE_REQUIRED", "请先勾选「我知道手机号只用于管理员识别」");
  const key = who.key!;
  const time = deps.now();
  const old = await store.get<Application>("miniapp_applications", key.appId);
  if (old?.status === "blocked") throw NO_ACCESS();
  if (old?.status === "pending") return { status: "pending" };
  if (old?.status === "rejected" && old.decidedAt && ms(time) - ms(old.decidedAt) < LIMITS.rejectCooldownMs)
    throw deny("APPLY_COOLDOWN", "申请未通过，24 小时后才能重新申请");
  const history = (old?.history ?? []).filter((t) => ms(time) - ms(t) < LIMITS.applyWindowMs);
  if (history.length >= LIMITS.applyMaxInWindow) throw deny("APPLY_LIMIT", "30 天内最多申请 3 次，请直接联系管理员");
  const all = await store.list<Application>("miniapp_applications");
  if (all.filter((a) => a.status === "pending").length >= LIMITS.maxPending)
    throw deny("APPLY_FULL", "申请已满，请联系管理员");
  const hourId = "g_apply_" + hourKey(time);
  return store.transaction(async (tx) => {
    const hour = await tx.get<Attempts>("miniapp_attempts", hourId);
    if ((hour?.count ?? 0) >= LIMITS.maxPerHour) throw deny("APPLY_BUSY", "申请的人有点多，请过一小时再试");
    const fresh = await tx.get<Application>("miniapp_applications", key.appId);
    if (fresh?.status === "pending") return { status: "pending" };
    if (fresh?.status === "blocked") throw NO_ACCESS();
    const row: Application = {
      id: key.appId,
      bindId: key.bindId,
      wxUid: key.wxUid,
      name,
      phone,
      status: "pending",
      history: [...history, time],
      createdAt: fresh?.createdAt ?? time,
      lastAppliedAt: time,
      decidedAt: null,
      decidedBy: null,
      linkUid: null,
      phonePurgedAt: null,
    };
    await tx.put("miniapp_attempts", hourId, { count: (hour?.count ?? 0) + 1, since: hour?.since ?? time });
    await tx.put("miniapp_applications", key.appId, row);
    return { status: "pending" };
  });
}

async function redeem(deps: MiniappDeps, store: MiniStore, who: Who, p: Record<string, unknown>) {
  if (who.role === "owner") return { status: "owner" };
  if (who.role === "member") throw deny("ALREADY_BOUND", "这个微信已经绑定为成员");
  const key = who.key!;
  const source = who.source as Extract<Source, { kind: "miniapp" }>;
  const time = deps.now();
  const attempts = await store.get<Attempts>("miniapp_attempts", key.attemptsId);
  const inWindow = !!attempts && ms(time) - ms(attempts.since) < LIMITS.redeemWindowMs;
  if (inWindow && attempts!.count >= LIMITS.redeemMaxFails)
    throw deny("REDEEM_LOCKED", "绑定码输错次数过多，请 24 小时后再试");
  const fail = async (): Promise<never> => {
    await store.put<Attempts>("miniapp_attempts", key.attemptsId, {
      count: inWindow ? attempts!.count + 1 : 1,
      since: inWindow ? attempts!.since : time,
    });
    throw deny("CODE_INVALID", "绑定码无效或已过期");
  };
  const code = normalizeCode(p.code);
  if (!code) return fail();
  const codeHash = await deps.hash("bindcode:" + code);
  const codeId = "c_" + codeHash.slice(0, 40);
  const usable = (c: BindCode | null): c is BindCode =>
    !!c && c.codeHash === codeHash && !c.usedAt && ms(c.expiresAt) >= ms(time);
  if (!usable(await store.get<BindCode>("miniapp_bind_codes", codeId))) return fail();
  const owners = (await store.list<Binding>("miniapp_bindings")).filter(
    (b) => b.kind === "owner" && b.status === "active" && b.uid === deps.ownerUid,
  );
  if (owners.length >= LIMITS.ownerMaxBindings)
    throw deny("OWNER_BIND_LIMIT", "管理员最多绑定 2 个微信，请先在网页上解除一个");
  const out = await store.transaction(async (tx) => {
    const fresh = await tx.get<BindCode>("miniapp_bind_codes", codeId);
    if (!usable(fresh)) throw deny("CODE_INVALID", "绑定码无效或已过期");
    await tx.put<BindCode>("miniapp_bind_codes", codeId, { ...fresh, usedAt: time, usedBy: key.bindId });
    const binding: Binding = {
      id: key.bindId,
      kind: "owner",
      uid: deps.ownerUid,
      status: "active",
      openid: source.openid,
      createdAt: time,
      approvedBy: deps.ownerUid,
      lastSeenAt: time,
      revokedAt: null,
      revokedBy: null,
    };
    await tx.put("miniapp_bindings", key.bindId, binding);
    return { status: "owner" };
  });
  await note(deps, { ...who, role: "owner", uid: deps.ownerUid, name: "管理员" }, "miniapp.owner.redeem", "miniapp_bindings", key.bindId, { kind: "owner" });
  return out;
}

async function leave(deps: MiniappDeps, store: MiniStore, who: Who) {
  const b = who.binding!;
  const row: Binding = { ...b, status: "revoked", revokedAt: deps.now(), revokedBy: who.uid };
  await store.put("miniapp_bindings", b.id, row);
  await note(deps, who, "miniapp.bind.leave", "miniapp_bindings", b.id, { status: "revoked" });
  return { status: "none" };
}

function publicApplication(a: Application, full: boolean) {
  return {
    id: a.id,
    name: a.name,
    phone: full ? a.phone : maskPhone(a.phone),
    status: a.status,
    lastAppliedAt: a.lastAppliedAt,
    decidedAt: a.decidedAt,
    linkUid: a.linkUid ?? null,
  };
}
function publicBinding(b: Binding, members: Map<string, Member>, ownerUid: string) {
  return {
    id: b.id,
    kind: b.kind,
    uid: b.uid,
    name: b.uid === ownerUid ? "管理员" : members.get(b.uid)?.name ?? "",
    status: b.status,
    createdAt: b.createdAt,
    lastSeenAt: b.lastSeenAt,
  };
}

async function adminAction(deps: MiniappDeps, store: MiniStore, who: Who, action: string, p: Record<string, unknown>) {
  const time = deps.now();
  switch (action) {
    case "miniapp.flags": {
      const t = deps.team;
      return {
        miniappEnabled: deps.config.enabled,
        membersEnabled: !!t.membersEnabled,
        auditEnabled: !!t.auditEnabled,
        scheduleOwnerEnabled: !!t.scheduleOwnerEnabled,
        avatarsEnabled: !!t.avatarsEnabled,
        salesActorFieldsEnabled: !!t.salesActorFieldsEnabled,
        expensesEnabled: !!t.expensesEnabled,
        salesPayerEnabled: !!t.salesPayerEnabled,
        expenseReceiptsEnabled: !!t.expenseReceiptsEnabled,
        expenseRenewEnabled: !!t.expenseRenewEnabled,
        invoiceEnabled: !!t.invoiceEnabled,
      };
    }
    case "miniapp.owner.code": {
      const code = randomCode(deps.random);
      const codeHash = await deps.hash("bindcode:" + code);
      const row: BindCode = {
        id: "c_" + codeHash.slice(0, 40),
        codeHash,
        createdAt: time,
        expiresAt: new Date(ms(time) + LIMITS.codeTtlMs).toISOString(),
        createdBy: who.uid,
        usedAt: null,
        usedBy: null,
      };
      await store.put("miniapp_bind_codes", row.id, row);
      await note(deps, who, action, "miniapp_bind_codes", row.id);
      // 明文绑定码只在这次响应里出现一次；库里和日志里都只有哈希
      return { code, expiresAt: row.expiresAt };
    }
    case "miniapp.apply.list": {
      const [apps, members] = await Promise.all([
        store.list<Application>("miniapp_applications"),
        store.list<Member>("members"),
      ]);
      // 被拒绝满 30 天的申请：清空手机号
      for (const a of apps)
        if (a.status === "rejected" && a.phone && a.decidedAt && ms(time) - ms(a.decidedAt) >= LIMITS.phonePurgeMs) {
          a.phone = "";
          a.phonePurgedAt = time;
          await store.put("miniapp_applications", a.id, a);
        }
      const people = members.filter(isMember);
      const byTime = (x: Application, y: Application) => y.lastAppliedAt.localeCompare(x.lastAppliedAt);
      return {
        pending: apps
          .filter((a) => a.status === "pending")
          .sort(byTime)
          .map((a) => ({
            ...publicApplication(a, true),
            // 审批时提示「可能是已有成员」：同名的已入队成员（只给 uid 和名字）
            maybe: people.filter((m) => m.name === a.name).map((m) => ({ uid: m.uid, name: m.name, status: m.status })),
          })),
        blocked: apps.filter((a) => a.status === "blocked").sort(byTime).map((a) => publicApplication(a, false)),
        rejected: apps.filter((a) => a.status === "rejected").sort(byTime).map((a) => publicApplication(a, false)),
      };
    }
    case "miniapp.apply.approve":
      return approve(deps, store, who, p);
    case "miniapp.apply.reject":
    case "miniapp.apply.block":
    case "miniapp.apply.unblock": {
      const id = typeof p.id === "string" && APP_ID.test(p.id) ? p.id : "";
      if (!id) throw new Error("申请编号无效");
      const out = await store.transaction(async (tx) => {
        const old = await tx.get<Application>("miniapp_applications", id);
        if (!old) throw new Error("申请不存在");
        if (action === "miniapp.apply.reject" && old.status !== "pending") throw new Error("这条申请不在待处理状态");
        if (action === "miniapp.apply.unblock" && old.status !== "blocked") throw new Error("这个微信没有被拉黑");
        const row: Application = {
          ...old,
          status: action === "miniapp.apply.block" ? "blocked" : "rejected",
          // 解除拉黑：记为「未通过」但不设冷却，可以马上重新申请
          decidedAt: action === "miniapp.apply.unblock" ? null : time,
          decidedBy: who.uid,
        };
        await tx.put("miniapp_applications", id, row);
        // 拉黑：同时撤销这个微信的绑定
        if (action === "miniapp.apply.block") {
          const b = await tx.get<Binding>("miniapp_bindings", old.bindId);
          if (b?.status === "active")
            await tx.put<Binding>("miniapp_bindings", b.id, { ...b, status: "revoked", revokedAt: time, revokedBy: who.uid });
        }
        return { status: row.status };
      });
      await note(deps, who, action, "miniapp_applications", id, out);
      return out;
    }
    case "miniapp.bind.list": {
      const [bindings, members] = await Promise.all([
        store.list<Binding>("miniapp_bindings"),
        store.list<Member>("members"),
      ]);
      const map = new Map(members.filter(isMember).map((m) => [m.uid, m]));
      return bindings
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((b) => publicBinding(b, map, deps.ownerUid));
    }
    case "miniapp.bind.revoke": {
      const id = typeof p.id === "string" && BIND_ID.test(p.id) ? p.id : "";
      if (!id) throw new Error("绑定编号无效");
      const out = await store.transaction(async (tx) => {
        const old = await tx.get<Binding>("miniapp_bindings", id);
        if (!old) throw new Error("绑定不存在");
        if (old.status === "revoked") return { status: "revoked" };
        await tx.put<Binding>("miniapp_bindings", id, { ...old, status: "revoked", revokedAt: time, revokedBy: who.uid });
        return { status: "revoked" };
      });
      await note(deps, who, action, "miniapp_bindings", id, out);
      return out;
    }
  }
  throw deny("UNSUPPORTED", "不支持这个操作");
}

async function approve(deps: MiniappDeps, store: MiniStore, who: Who, p: Record<string, unknown>) {
  const id = typeof p.id === "string" && APP_ID.test(p.id) ? p.id : "";
  if (!id) throw new Error("申请编号无效");
  if (!deps.team.membersEnabled) throw deny("MEMBERS_OFF", "请先打开成员功能，再批准小程序成员");
  const linkUid = p.linkUid === undefined || p.linkUid === null || p.linkUid === "" ? "" : p.linkUid;
  if (linkUid !== "" && (typeof linkUid !== "string" || !MEMBER_UID.test(linkUid) || linkUid.startsWith("_")))
    throw new Error("要关联的成员编号无效");
  if (linkUid === deps.ownerUid) throw new Error("管理员本人请用绑定码绑定，不走申请");
  const time = deps.now();
  // 分色：和 members.approve 同一套规则（计数器 members/_color_counter，事务里读写）
  const colorOn = !!(deps.team.membersEnabled && deps.team.scheduleOwnerEnabled);
  const seed = colorOn
    ? (await store.list<Member>("members")).filter((m) => isMember(m) && isColorKey(m.color)).length
    : 0;
  const out = await store.transaction(async (tx) => {
    const app = await tx.get<Application>("miniapp_applications", id);
    if (!app) throw new Error("申请不存在");
    if (app.status !== "pending") throw new Error("这条申请不在待处理状态");
    const bound = await tx.get<Binding>("miniapp_bindings", app.bindId);
    if (bound?.status === "active") throw new Error("这个微信已经绑定过了");
    let uid: string;
    let created = false;
    if (linkUid) {
      const m = await tx.get<Member>("members", linkUid as string);
      if (!isMember(m)) throw new Error("要关联的成员不存在");
      uid = m.uid;
    } else {
      uid = app.wxUid;
      const old = await tx.get<Member>("members", uid);
      if (!old) {
        let color: ColorKey | undefined;
        if (colorOn) {
          const counter = await tx.get<{ next?: number }>("members", "_color_counter");
          const n = Math.max(counter?.next ?? 0, seed);
          color = colorKeyAt(n);
          await tx.put("members", "_color_counter", { uid: "_color_counter", next: n + 1, updatedAt: time });
        }
        const member: Member = {
          uid,
          name: app.name,
          status: "active",
          inviteId: "miniapp",
          createdAt: time,
          updatedAt: time,
          revision: 1,
          ...(color ? { color } : {}),
        };
        await tx.put("members", uid, member);
        created = true;
      }
    }
    const binding: Binding = {
      id: app.bindId,
      kind: "member",
      uid,
      status: "active",
      ...(bound?.openid ? { openid: bound.openid } : {}),
      createdAt: time,
      approvedBy: who.uid,
      lastSeenAt: null,
      revokedAt: null,
      revokedBy: null,
    };
    await tx.put("miniapp_bindings", app.bindId, binding);
    await tx.put<Application>("miniapp_applications", id, {
      ...app,
      status: "approved",
      decidedAt: time,
      decidedBy: who.uid,
      linkUid: linkUid ? (linkUid as string) : null,
    });
    return { status: "approved", uid, created, linked: !!linkUid };
  });
  await note(deps, who, "miniapp.apply.approve", "miniapp_applications", id, { status: "approved", created: out.created, linked: out.linked });
  return out;
}
