/**
 * 操作日志（audit_logs）：只追加。
 * - 业务代码只能拿到 append()，没有修改、删除日志的路径（管理员也没有）。
 * - 摘要只取白名单字段，长文本截断；密钥、邀请码、推送密钥、备份正文、原始 payload 一律不入日志。
 */
import type { Store } from "./service";

export type AuditResult = "ok" | "denied" | "failed";
export interface AuditEntry {
  id: string;
  at: string;
  atBj: string;
  day: string;
  actorUid: string;
  actorName: string;
  role: string;
  action: string;
  targetType?: string;
  targetId?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  result: AuditResult;
  reason?: string;
  requestHash?: string;
  truncated?: boolean;
}
export type AuditInput = Omit<AuditEntry, "id" | "at" | "atBj" | "day">;

export const AUDIT_COLLECTION = "audit_logs" as const;
/** 日志写失败计数：放在新集合 members 里的固定文档（不写入任何已有集合）；members.list 会过滤掉 _ 开头的文档 */
export const AUDIT_HEALTH_COLLECTION = "members" as const;
export const AUDIT_HEALTH_ID = "_audit_health";
export const AUDIT_MAX_BYTES = 4000;
const TEXT_MAX = 40;

/** 会写数据（或整库导出）的 action：成功、失败都记 */
export const AUDITED_ACTIONS = new Set([
  "sales.create", "sales.update", "sales.delete", "sales.restore", "sales.purge",
  "tasks.create", "tasks.update", "tasks.complete", "tasks.reopen", "tasks.delete", "tasks.restore", "tasks.purge",
  "customers.merge", "customers.unmerge", "customers.mergeMany", "customers.profile.save",
  "catalog.cleanup", "catalog.restore",
  "products.create", "products.save",
  "import.commit", "backup.restore", "backup",
  "push.subscribe", "push.unsubscribe", "push.test",
  "members.invite.create", "members.invite.revoke", "members.redeem",
  "members.approve", "members.disable", "members.enable",
  "tasks.sync.complete", "tasks.sync.uncomplete", "tasks.sync.create",
]);

/** 日程归属开关开后才记日志的新 action（开关关时它们不存在，也就不记） */
export const OWNER_AUDITED_ACTIONS = new Set([
  "tasks.claim", "tasks.assign", "members.color.fill", "members.avatar.set", "members.avatar.clear",
]);
/** 日志「按类型」筛选里的组合（单个 action 前缀之外的） */
export const AUDIT_ACTION_GROUPS: Record<string, (action: string) => boolean> = {
  "group:owner": (a) => a === "tasks.claim" || a === "tasks.assign",
  "group:delete": (a) => /\.(delete|purge)$/.test(a),
};

/** 北京时间（UTC+8，无夏令时） */
export function beijing(iso: string) {
  const t = new Date(Date.parse(iso) + 8 * 3600_000).toISOString();
  return { day: t.slice(0, 10), atBj: t.slice(0, 10) + " " + t.slice(11, 19) };
}
function cut(v: unknown) {
  if (typeof v !== "string") return v;
  return v.length > TEXT_MAX ? v.slice(0, TEXT_MAX) + "…" : v;
}
function pick(row: Record<string, unknown>, keys: string[], long: string[] = []) {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (row[k] !== undefined) out[k] = row[k];
  for (const k of long) if (row[k] !== undefined) out[k] = cut(row[k]);
  return out;
}
/** 按集合取白名单摘要；未知集合只记数字/布尔类结果 */
export function summarize(kind: string | undefined, value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) return { count: value.length };
  const row = value as Record<string, unknown>;
  switch (kind) {
    case "sales":
      return pick(row, ["date", "customer", "productName", "revenue", "cost", "revision", "deletedAt", "createdBy", "updatedBy", "deletedBy"], ["note"]);
    case "tasks":
      return pick(row, ["at", "customerId", "completedAt", "deletedAt", "reminder", "revision", "createdBy", "ownerUid", "updatedBy"], ["title", "feedback", "nextAction"]);
    case "customers": {
      const out = pick(row, ["name", "mergedInto", "archivedAt", "revision"]);
      const profile = row.profile as Record<string, unknown> | undefined;
      if (profile && typeof profile === "object") {
        out.profileKeys = Object.keys(profile);
        if (profile.needNote !== undefined) out.needNote = cut(profile.needNote);
      }
      return out;
    }
    case "products":
      return pick(row, ["name", "price", "cost", "hasDefaultPrice", "hasDefaultCost", "active", "archivedAt"]);
    case "members": {
      const out = pick(row, ["uid", "name", "status", "color", "count", "colors", "oldFileKept"]);
      // 头像本身不进日志：只记文件编号（内容哈希）的前 8 位
      const avatar = row.avatar as { hash?: unknown } | undefined;
      if (avatar && typeof avatar === "object" && typeof avatar.hash === "string") out.avatar = avatar.hash.slice(0, 8);
      else if ("avatar" in row && !row.avatar) out.avatar = null;
      return out;
    }
    case "invites":
      return pick(row, ["id", "name", "expiresAt", "usedBy", "revokedAt"]);
    case "expenses":
      return pick(row, ["date", "amount", "categoryName", "paidBy", "hasInvoice", "status", "revision", "deletedAt", "createdBy", "confirmedBy"], ["note"]);
    default: {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row).slice(0, 12))
        if (typeof v === "number" || typeof v === "boolean") out[k] = v;
        else if (Array.isArray(v)) out[k + "Count"] = v.length;
      return Object.keys(out).length ? out : null;
    }
  }
}

/** 每条日志新 id（时间 + 随机），只新增，绝不覆盖 */
function newId(at: string) {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  const rand = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return "a_" + at.replace(/\D/g, "").slice(0, 17) + "_" + rand;
}
export function buildEntry(input: AuditInput, at: string): AuditEntry {
  const { day, atBj } = beijing(at);
  let entry: AuditEntry = { id: newId(at), at, atBj, day, ...input };
  if (JSON.stringify(entry).length > AUDIT_MAX_BYTES) {
    entry = { ...entry, before: null, after: null, truncated: true };
  }
  return entry;
}

export interface AuditLog {
  append(input: AuditInput): Promise<void>;
}
/**
 * 只追加的写入口。日志自己写失败时（方案 a）：不影响主操作，
 * 记云函数告警日志，并尽力把失败次数记到 members/_audit_health，管理员打开系统时提示。
 */
export function appendOnly(store: Store, now: () => string, warn?: (code: string) => void): AuditLog {
  return Object.freeze({
    async append(input: AuditInput) {
      const at = now();
      try {
        const entry = buildEntry(input, at);
        await store.put(AUDIT_COLLECTION, entry.id, entry);
      } catch {
        warn?.("audit.write_failed");
        try {
          const old = await store.get<{ failed?: number }>(AUDIT_HEALTH_COLLECTION, AUDIT_HEALTH_ID);
          await store.put(AUDIT_HEALTH_COLLECTION, AUDIT_HEALTH_ID, {
            failed: (old?.failed ?? 0) + 1,
            lastFailedAt: at,
          });
        } catch {
          warn?.("audit.health_failed");
        }
      }
    },
  });
}

/** 业务代码拿到的存储：对 audit_logs 只能读不能写删（日志只能经 appendOnly 新增） */
export function guardAudit(store: Store): Store {
  const block = (c: string) => {
    if (c === AUDIT_COLLECTION) throw new Error("操作日志只能追加，不能修改或删除");
  };
  return {
    get: (c, id) => store.get(c, id),
    list: (c) => store.list(c),
    put: async (c, id, v) => (block(c), store.put(c, id, v)),
    del: async (c, id) => (block(c), store.del(c, id)),
    transaction: (fn) =>
      store.transaction((tx) =>
        fn({
          get: (c, id) => tx.get(c, id),
          put: async (c, id, v) => (block(c), tx.put(c, id, v)),
          del: async (c, id) => (block(c), tx.del(c, id)),
        }),
      ),
  };
}

export interface AuditQuery {
  from?: string;
  to?: string;
  action?: string;
  actor?: string;
  result?: string;
  cursor?: string;
  limit?: number;
}
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** 查询：按北京日期区间、操作类型、操作人、结果筛选，按时间倒序，用 id 游标分页 */
/** groups：只有 SCHEDULE_OWNER_ENABLED 开时才认 group:owner / group:delete / group:system；关时按原来的精确/前缀匹配（等于什么都不匹配），与线上一致 */
export async function listAudit(store: Store, q: AuditQuery, forceActor?: string, opts: { groups?: boolean } = {}) {
  for (const k of ["from", "to", "action", "actor", "result", "cursor"] as const)
    if (q[k] !== undefined && typeof q[k] !== "string") throw new Error("筛选条件无效");
  if ((q.from && !DAY.test(q.from)) || (q.to && !DAY.test(q.to))) throw new Error("筛选日期无效");
  const limit = Math.min(100, Math.max(1, Number.isInteger(q.limit) ? (q.limit as number) : 50));
  const actor = forceActor ?? q.actor;
  const rows = (await store.list<AuditEntry>(AUDIT_COLLECTION))
    .filter((r) =>
      (!actor || r.actorUid === actor || (opts.groups && actor === "group:system" && !forceActor && r.actorUid.startsWith("system:"))) &&
      (!q.from || r.day >= q.from) &&
      (!q.to || r.day <= q.to) &&
      (!q.action ||
        (opts.groups && Object.hasOwn(AUDIT_ACTION_GROUPS, q.action)
          ? AUDIT_ACTION_GROUPS[q.action](r.action)
          : r.action === q.action || r.action.startsWith(q.action + "."))) &&
      (!q.result || r.result === q.result) &&
      (!q.cursor || r.id < q.cursor),
    )
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const page = rows.slice(0, limit);
  return {
    rows: page,
    next: rows.length > limit ? page[page.length - 1].id : null,
  };
}

/**
 * 被拒请求的日志节流（只在内存里，按北京时间小时）：
 * - 同一个 key 本小时第一次被拒 → 追加一条完整日志；
 * - 之后同 key 只在内存里计数，不写库；
 * - 过了这个小时、下一次有请求进来时，对计数 > 1 的 key 追加一条汇总（count = 本小时总次数）。
 * 这样公开接口被刷时，每个 key 每小时最多写 2 条，不会把只追加的日志刷爆，也不需要任何改/删日志的路径。
 * key 数有上限，超出后只打云函数日志不写库。实例回收时未汇总的计数会丢（首条仍在库里）。
 */
export class DenyThrottle {
  private buckets = new Map<string, { hour: string; count: number; sample: AuditInput }>();
  constructor(private maxKeys = 2000) {}
  /** 取出已过小时的汇总（计数 > 1 的才需要写） */
  flush(at: string): AuditInput[] {
    const hour = hourOf(at);
    const out: AuditInput[] = [];
    for (const [key, b] of this.buckets)
      if (b.hour !== hour) {
        if (b.count > 1)
          out.push({ ...b.sample, after: { hour: b.hour, count: b.count, summary: true } });
        this.buckets.delete(key);
      }
    return out;
  }
  /** 记一次被拒；返回需要追加的日志（本小时首次才有一条） */
  note(key: string, input: AuditInput, at: string): AuditInput[] {
    const out = this.flush(at);
    const hour = hourOf(at);
    const b = this.buckets.get(key);
    if (b) {
      b.count++;
      return out;
    }
    if (this.buckets.size >= this.maxKeys) return out;
    this.buckets.set(key, { hour, count: 1, sample: input });
    out.push({ ...input, after: { hour, count: 1, note: "本小时首次；同类重复只计数，过小时汇总" } });
    return out;
  }
}
function hourOf(at: string) {
  return beijing(at).atBj.slice(0, 13);
}
/** 每个云函数实例一份 */
export const defaultThrottle = new DenyThrottle();

const SYNC_DENIED = new Set(["SYNC_UNAUTHORIZED", "SYNC_FORBIDDEN", "SYNC_RATE_LIMITED", "SYNC_DISABLED"]);
/**
 * iPhone 同步接口（TASK_SYNC_KEY）的日志：只记写操作和被拒的调用，操作人记为「系统·iPhone 同步」。
 * 不接触密钥：只看 action、payload 里的任务字段和返回结果。
 */
export async function auditSync(
  log: AuditLog,
  parsed: { action: unknown; payload: Record<string, unknown> },
  result: { ok: boolean; code?: string; data?: unknown },
  throttle: DenyThrottle = defaultThrottle,
  now: () => string = () => new Date().toISOString(),
  warn?: (code: string) => void,
) {
  const action = typeof parsed.action === "string" && /^[\w.]{1,60}$/.test(parsed.action) ? parsed.action : "tasks.sync.unknown";
  const denied = !result.ok && SYNC_DENIED.has(result.code ?? "");
  const at = now();
  for (const summary of throttle.flush(at)) await log.append(summary);
  if (denied) {
    // 密钥错误/限流等：公开 HTTP 接口可被刷，不逐条写库；同一小时同一代码只记首条 + 过小时汇总
    warn?.("sync.denied." + result.code);
    const code = (result.code ?? "SYNC_DENIED").slice(0, 40);
    for (const entry of throttle.note("sync:" + code, {
      actorUid: "system:sync",
      actorName: "系统·iPhone 同步",
      role: "system",
      action: "tasks.sync.denied",
      targetType: "tasks",
      result: "denied",
      reason: code,
    }, at))
      await log.append(entry);
    return;
  }
  if (!AUDITED_ACTIONS.has(action)) return;
  const p = parsed.payload;
  const id = typeof p.id === "string" && /^[\w-]{1,128}$/.test(p.id) ? p.id : undefined;
  const data = result.data as Record<string, unknown> | undefined;
  const task = data && typeof data === "object" && "task" in data ? data.task : data;
  await log.append({
    actorUid: "system:sync",
    actorName: "系统·iPhone 同步",
    role: "system",
    action,
    targetType: "tasks",
    ...(id ? { targetId: id } : {}),
    after: result.ok ? summarize("tasks", task) : null,
    result: result.ok ? "ok" : "failed",
    ...(result.ok ? {} : { reason: (result.code ?? "SYNC_FAILED").slice(0, 40) }),
  });
}
