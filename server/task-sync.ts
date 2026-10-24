import { timingSafeEqual, createHash } from "node:crypto";
import type { Customer, CustomerTask } from "../src/domain/model";
import { customerRoots, displayCustomerName } from "../src/domain/customers";
import type { Store, Transaction } from "./service";

/**
 * iPhone 提醒事项双向同步接口。只接受专用同步密钥（环境变量 TASK_SYNC_KEY），
 * 不能调用其他任何 action；只读日程，只写 completedAt。
 */
export const SYNC_ACTIONS = ["tasks.sync.list", "tasks.sync.complete"] as const;
export const SYNC_LOG = "taskSyncLog" as const;
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

/** 常量时间比较；未配置密钥时一律拒绝。 */
export function checkSyncKey(expected: string | undefined, given: unknown) {
  if (!expected) throw new SyncError("SYNC_DISABLED", "同步接口未启用");
  if (typeof given !== "string" || !given)
    throw new SyncError("SYNC_UNAUTHORIZED", "同步密钥无效");
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(given).digest();
  if (!timingSafeEqual(a, b))
    throw new SyncError("SYNC_UNAUTHORIZED", "同步密钥无效");
}

function isoOrNull(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value) ||
    Number.isNaN(Date.parse(value))
  )
    throw new SyncError("SYNC_BAD_REQUEST", "完成时间格式无效");
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
        customer: root ? displayCustomerName(root.name) : "",
        title: t.title,
        feedback: t.feedback,
        nextAction: t.nextAction,
        reminder: t.reminder,
        completedAt: t.completedAt,
        revision: t.revision,
      };
    });
  return { now: nowIso, from: new Date(from).toISOString(), to: new Date(to).toISOString(), tasks: rows };
}

export async function syncComplete(
  store: Store,
  nowIso: string,
  payload: Record<string, unknown>,
  newId: () => string,
) {
  const id = payload.id;
  if (typeof id !== "string" || !/^[\w-]{1,128}$/.test(id))
    throw new SyncError("SYNC_BAD_REQUEST", "记录编号无效");
  if (!Number.isInteger(payload.revision) || (payload.revision as number) < 1)
    throw new SyncError("SYNC_BAD_REQUEST", "日程版本无效");
  if (!Object.hasOwn(payload, "completedAt"))
    throw new SyncError("SYNC_BAD_REQUEST", "缺少完成时间");
  const completedAt = isoOrNull(payload.completedAt);
  return store.transaction(async (tx: Transaction) => {
    const ledger = await tx.get<{ restoreId?: string | null }>("batches", "_ledger");
    if (ledger?.restoreId) throw new SyncError("SYNC_BUSY", "正在恢复备份，请稍后再同步");
    const old = await tx.get<CustomerTask>("tasks", id);
    if (!old) throw new SyncError("SYNC_NOT_FOUND", "日程不存在");
    if (old.deletedAt) throw new SyncError("SYNC_DELETED", "日程已删除");
    if (old.revision !== payload.revision)
      throw new SyncError("SYNC_CONFLICT", "日程已在另一处修改，请刷新后重试");
    const mutationId = "sync_" + newId();
    const row: CustomerTask = {
      ...old,
      completedAt,
      updatedAt: nowIso,
      revision: old.revision + 1,
      lastMutation: mutationId,
    };
    await tx.put("tasks", id, row);
    const log: SyncLogEntry = {
      id: mutationId,
      at: nowIso,
      taskId: id,
      before: old.completedAt,
      after: completedAt,
      revision: row.revision,
    };
    await tx.put(SYNC_LOG, mutationId, log);
    return { id, completedAt, revision: row.revision };
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
      payload: body?.payload && typeof body.payload === "object" ? body.payload : {},
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

export async function handleSync(
  store: () => Store,
  env: { key: string | undefined; now: () => string; newId: () => string },
  parsed: { action: unknown; payload: Record<string, unknown>; key: unknown },
) {
  try {
    checkSyncKey(env.key, parsed.key);
    if (parsed.action === "tasks.sync.list")
      return { ok: true, data: await syncList(store(), env.now()) };
    if (parsed.action === "tasks.sync.complete")
      return { ok: true, data: await syncComplete(store(), env.now(), parsed.payload, env.newId) };
    throw new SyncError("SYNC_FORBIDDEN", "同步密钥只能调用同步接口");
  } catch (error) {
    if (error instanceof SyncError) return { ok: false, code: error.code, error: error.message };
    return { ok: false, error: "云端操作未完成，请稍后重试" };
  }
}
