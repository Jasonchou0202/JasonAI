import { timingSafeEqual, createHash } from "node:crypto";
import type { Customer, CustomerTask } from "../src/domain/model";
import { customerRoots, displayCustomerName } from "../src/domain/customers";
import { validateTaskInput } from "../src/domain/tasks";
import { stripMoney } from "../src/domain/taskSyncTitle.mjs";
import { mutation, nextTaskRow, type Context, type Store, type Transaction } from "./service";

/**
 * iPhone 提醒事项双向同步接口。只接受专用同步密钥（环境变量 TASK_SYNC_KEY，至少 32 字节），
 * 不能调用其他任何 action；只读日程，只写 completedAt（连同提醒代次）。
 */
export const SYNC_ACTIONS = ["tasks.sync.list", "tasks.sync.complete"] as const;
export const SYNC_LOG = "taskSyncLog" as const;
export const MIN_SYNC_KEY_BYTES = 32;
export const MAX_FUTURE_MS = 5 * 60_000;
export const RATE_LIMIT = { windowMs: 60_000, max: 60 };
const DAY = 86400000;

export interface SyncTask {
  id: string;
  at: string;
  customer: string;
  title: string;
  feedback: string;
  nextAction: string;
  reminder: CustomerTask["reminder"];
  completedAt: string | null;
  revision: number;
}
export interface SyncLogEntry {
  id: string;
  at: string;
  taskId: string;
  requestId: string;
  before: string | null;
  after: string | null;
  revision: number;
}
export class SyncError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export function isSyncAction(action: unknown): boolean {
  return typeof action === "string" && action.startsWith("tasks.sync.");
}

/** 常量时间比较；未配置或少于 32 字节的密钥一律拒绝。 */
export function checkSyncKey(expected: string | undefined, given: unknown) {
  if (!expected || Buffer.byteLength(expected, "utf8") < MIN_SYNC_KEY_BYTES)
    throw new SyncError("SYNC_DISABLED", "同步接口未启用");
  if (typeof given !== "string" || !given)
    throw new SyncError("SYNC_UNAUTHORIZED", "同步密钥无效");
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(given).digest();
  if (!timingSafeEqual(a, b))
    throw new SyncError("SYNC_UNAUTHORIZED", "同步密钥无效");
}

/**
 * 单实例内存限流（固定窗口），只统计密钥校验失败的请求。
 * 失败次数超过上限后锁住本窗口：这一分钟内所有请求（包括正确密钥）直接拒绝，同步任务下一轮重试。
 * 真正的防线是 32 字节随机密钥和控制台限流，这里只是兜底。
 */
export function rateLimiter(limit = RATE_LIMIT) {
  let windowStart = 0,
    failures = 0;
  const roll = (nowMs: number) => {
    if (nowMs - windowStart >= limit.windowMs) {
      windowStart = nowMs;
      failures = 0;
    }
  };
  return {
    /** 验密钥之前调用：已锁住则直接拒绝 */
    check(nowMs: number) {
      roll(nowMs);
      if (failures >= limit.max)
        throw new SyncError("SYNC_RATE_LIMITED", "请求太频繁，请稍后再试");
    },
    /** 密钥校验失败时调用 */
    fail(nowMs: number) {
      roll(nowMs);
      failures++;
    },
  };
}
export type SyncLimiter = ReturnType<typeof rateLimiter>;

function completedValue(value: unknown, nowIso: string): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value) ||
    Number.isNaN(Date.parse(value))
  )
    throw new SyncError("SYNC_BAD_REQUEST", "完成时间格式无效");
  if (Date.parse(value) > Date.parse(nowIso) + MAX_FUTURE_MS)
    throw new SyncError("SYNC_BAD_REQUEST", "完成时间不能晚于现在");
  return new Date(value).toISOString();
}

export async function syncList(store: Store, nowIso: string) {
  const [tasks, customers] = await Promise.all([
    store.list<CustomerTask>("tasks"),
    store.list<Customer>("customers"),
  ]);
  const roots = customerRoots(customers);
  const byId = new Map(customers.map((c) => [c.id, c]));
  const now = Date.parse(nowIso);
  const from = now - 7 * DAY,
    to = now + 90 * DAY;
  const rows: SyncTask[] = tasks
    .filter((t) => {
      if (t.deletedAt) return false;
      const at = Date.parse(t.at);
      return !Number.isNaN(at) && at >= from && at <= to;
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id))
    .map((t) => {
      const root = byId.get(roots.get(t.customerId) ?? t.customerId);
      return {
        id: t.id,
        at: t.at,
        customer: root ? stripMoney(displayCustomerName(root.name)) : "",
        title: stripMoney(t.title),
        feedback: stripMoney(t.feedback),
        nextAction: stripMoney(t.nextAction),
        reminder: t.reminder,
        completedAt: t.completedAt,
        revision: t.revision,
      };
    });
  return { now: nowIso, from: new Date(from).toISOString(), to: new Date(to).toISOString(), tasks: rows };
}

export async function syncComplete(
  store: Store,
  ctx: Context,
  nowIso: string,
  payload: Record<string, unknown>,
) {
  const id = payload.id,
    requestId = payload.requestId;
  if (typeof id !== "string" || !/^[\w-]{1,128}$/.test(id))
    throw new SyncError("SYNC_BAD_REQUEST", "记录编号无效");
  if (typeof requestId !== "string" || !/^[\w-]{1,128}$/.test(requestId))
    throw new SyncError("SYNC_BAD_REQUEST", "请求编号无效");
  if (!Number.isInteger(payload.revision) || (payload.revision as number) < 1)
    throw new SyncError("SYNC_BAD_REQUEST", "日程版本无效");
  if (!Object.hasOwn(payload, "completedAt"))
    throw new SyncError("SYNC_BAD_REQUEST", "缺少完成时间");
  const completedAt = completedValue(payload.completedAt, nowIso);
  const action = "tasks.sync.complete";
  return store.transaction(async (tx: Transaction) => {
    const ledger = await tx.get<{ restoreId?: string | null }>("batches", "_ledger");
    if (ledger?.restoreId) throw new SyncError("SYNC_BUSY", "正在恢复备份，请稍后再同步");
    // 同一 requestId 重放：返回第一次的结果，不重复写库和日志。
    return mutation(tx, ctx, requestId, action, { id, revision: payload.revision, completedAt }, async () => {
      const old = await tx.get<CustomerTask>("tasks", id);
      if (!old) throw new SyncError("SYNC_NOT_FOUND", "日程不存在");
      if (old.deletedAt) throw new SyncError("SYNC_DELETED", "日程已删除");
      if (old.revision !== payload.revision)
        throw new SyncError("SYNC_CONFLICT", "日程已在另一处修改，请刷新后重试");
      // 与 tasks.complete / tasks.reopen 同一套写法（含 reminderGeneration、reminderStartAt）。
      const row = await nextTaskRow(
        ctx, old, validateTaskInput(old), completedAt, old.deletedAt, nowIso, requestId,
        completedAt ? "tasks.complete" : "tasks.reopen",
      );
      await tx.put("tasks", id, row);
      const logId = "sync_" + (await ctx.hash(requestId)).slice(0, 40);
      const log: SyncLogEntry = {
        id: logId, at: nowIso, taskId: id, requestId,
        before: old.completedAt, after: completedAt, revision: row.revision,
      };
      await tx.put(SYNC_LOG, logId, log);
      return { id, completedAt, revision: row.revision };
    });
  });
}

/** 解析 SDK 调用（{action,payload,syncKey}）或 HTTP 访问服务事件。 */
export function parseSyncEvent(event: unknown): { action: string; payload: Record<string, unknown>; key: unknown } | null {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const e = event as Record<string, any>;
  if (typeof e.httpMethod === "string") {
    if (e.httpMethod !== "POST") throw new SyncError("SYNC_BAD_REQUEST", "只接受 POST");
    const headers = Object.fromEntries(
      Object.entries(e.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    let body: any;
    try {
      const raw = e.isBase64Encoded ? Buffer.from(String(e.body ?? ""), "base64").toString("utf8") : String(e.body ?? "");
      body = JSON.parse(raw || "{}");
    } catch {
      throw new SyncError("SYNC_BAD_REQUEST", "请求格式无效");
    }
    const auth = String(headers["authorization"] ?? "");
    return {
      action: body?.action,
      payload: body?.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload : {},
      key: auth.startsWith("Bearer ") ? auth.slice(7) : headers["x-task-sync-key"],
    };
  }
  if (!isSyncAction(e.action) && e.syncKey === undefined) return null;
  return {
    action: e.action,
    payload: e.payload && typeof e.payload === "object" && !Array.isArray(e.payload) ? e.payload : {},
    key: e.syncKey,
  };
}

/** 统一的错误出口：只透出 SyncError 的代码和中文提示，其他错误一律通用提示。 */
export function syncFailure(error: unknown) {
  if (error instanceof SyncError) return { ok: false, code: error.code, error: error.message };
  return { ok: false, code: "SYNC_FAILED", error: "云端操作未完成，请稍后重试" };
}

export async function handleSync(
  store: () => Store,
  env: { key: string | undefined; now: () => string; hash: Context["hash"]; /** 密钥校验失败时调用；超限时抛出 SYNC_RATE_LIMITED */
    limit?: SyncLimiter },
  parsed: { action: unknown; payload: Record<string, unknown>; key: unknown },
) {
  try {
    const nowIso = env.now();
    const nowMs = Date.parse(nowIso);
    // 先看是否已锁住（包括正确密钥也拒绝），再验密钥；只有验密钥失败才计数
    env.limit?.check(nowMs);
    try {
      checkSyncKey(env.key, parsed.key);
    } catch (error) {
      env.limit?.fail(nowMs);
      throw error;
    }
    const ctx: Context = { uid: null, ownerUid: "", now: () => nowIso, hash: env.hash };
    if (parsed.action === "tasks.sync.list")
      return { ok: true, data: await syncList(store(), nowIso) };
    if (parsed.action === "tasks.sync.complete")
      return { ok: true, data: await syncComplete(store(), ctx, nowIso, parsed.payload) };
    throw new SyncError("SYNC_FORBIDDEN", "同步密钥只能调用同步接口");
  } catch (error) {
    return syncFailure(error);
  }
}
