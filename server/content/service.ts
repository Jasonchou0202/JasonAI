import {
  CONTENT_SOURCES,
  RANGE_MAX_DAYS,
  beijingMinute,
  contentAddDays,
  contentToday,
  contentValidDate,
  daysBetween,
  toPublishable,
  validateDailyInput,
  type ContentDaily,
  type ContentDailyInput,
} from "../../src/domain/content";
import type { ContentContext, ContentStore, ContentTx } from "./types";

export const CONTENT_ACTIONS = [
  "session",
  "content.daily.list",
  "content.daily.get",
  "content.daily.save",
  "content.daily.delete",
  "content.daily.restore",
  "content.export.publishable",
  "content.backup",
] as const;
export interface ContentAudit {
  id: string;
  date: string;
  action: "save" | "delete" | "restore";
  requestId: string;
  before: Snapshot | null;
  after: Snapshot;
  revision: number;
  at: string;
}
type Snapshot = Pick<
  ContentDaily,
  "wechat_adds" | "leads" | "note" | "deletedAt"
>;
interface Receipt<T> {
  fingerprint: string;
  result: T;
}

export function contentIdentity(ctx: ContentContext) {
  if (!ctx.ownerUid) throw new Error("后台尚未绑定所有者，暂不允许访问");
  if (!ctx.uid || ctx.uid !== ctx.ownerUid) throw new Error("无权访问内容数据");
}
function requestId(value: unknown): string {
  if (typeof value !== "string" || !/^[\w-]{8,128}$/.test(value))
    throw new Error("请求编号无效，请刷新后重试");
  return value;
}
function date(value: unknown): string {
  if (!contentValidDate(value)) throw new Error("日期无效");
  return value;
}
function revision(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
    throw new Error("版本号无效，请刷新后重试");
  return value;
}
function range(p: Record<string, unknown>) {
  const to = p.to === undefined ? contentToday() : date(p.to);
  const from = p.from === undefined ? contentAddDays(to, -29) : date(p.from);
  if (from > to) throw new Error("开始日期不能晚于结束日期");
  if (daysBetween(from, to) > RANGE_MAX_DAYS)
    throw new Error(`一次最多查 ${RANGE_MAX_DAYS} 天`);
  return { from, to };
}
function snapshot(r: ContentDaily): Snapshot {
  return {
    wechat_adds: r.wechat_adds,
    leads: { ...r.leads },
    note: r.note,
    deletedAt: r.deletedAt,
  };
}
/** 同一个请求编号重试只生效一次；换了内容再用同一个编号会被拒绝 */
async function once<T>(
  tx: ContentTx,
  ctx: ContentContext,
  id: string,
  action: string,
  input: unknown,
  apply: () => Promise<T>,
): Promise<T> {
  const key = "mutation_" + (await ctx.hash(id));
  const fingerprint = await ctx.hash(JSON.stringify([action, input]));
  const prior = await tx.get<Receipt<T>>("content_receipts", key);
  if (prior) {
    if (prior.fingerprint !== fingerprint)
      throw new Error("请求编号已用于其他修改，请刷新后重试");
    return prior.result;
  }
  const result = await apply();
  await tx.put("content_receipts", key, { fingerprint, result });
  return result;
}
async function audit(
  tx: ContentTx,
  ctx: ContentContext,
  entry: Omit<ContentAudit, "id">,
) {
  const id = "audit_" + (await ctx.hash(entry.requestId));
  await tx.put<ContentAudit>("content_audit", id, { id, ...entry });
}

export async function executeContent(
  store: ContentStore,
  ctx: ContentContext,
  action: string,
  payload: unknown = {},
): Promise<unknown> {
  contentIdentity(ctx);
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("请求格式无效");
  const p = payload as Record<string, unknown>;
  const now = () => ctx.now?.() || new Date().toISOString();
  switch (action) {
    case "session":
      return { uid: ctx.uid };
    case "content.daily.list": {
      const { from, to } = range(p);
      const rows = await store.list<ContentDaily>("content_daily", {
        fromId: from,
        toId: to,
        max: RANGE_MAX_DAYS,
      });
      const deleted = p.deleted === true;
      return rows.filter((r) => Boolean(r.deletedAt) === deleted);
    }
    case "content.daily.get":
      return store.get<ContentDaily>("content_daily", date(p.date));
    case "content.daily.save": {
      const rid = requestId(p.requestId);
      const rev = revision(p.revision);
      const input: ContentDailyInput = validateDailyInput({
        date: p.date,
        wechat_adds: p.wechat_adds,
        leads: p.leads,
        note: p.note,
      });
      return store.transaction((tx) =>
        once(tx, ctx, rid, action, { input, rev }, async () => {
          const old = await tx.get<ContentDaily>("content_daily", input.date);
          const time = now();
          if (old) {
            if (rev === undefined)
              throw new Error("这一天已经录过，请刷新后在原记录上修改");
            if (old.revision !== rev)
              throw new Error("这一天的记录已在另一处修改，请刷新后重试");
            if (old.deletedAt) throw new Error("这一天的记录已删除，请先恢复");
          } else if (rev !== undefined)
            throw new Error("这一天的记录已不存在，请刷新后重试");
          const row: ContentDaily = {
            ...input,
            revision: (old?.revision ?? 0) + 1,
            createdAt: old?.createdAt ?? time,
            updatedAt: time,
            deletedAt: null,
            lastMutation: rid,
          };
          await tx.put("content_daily", row.date, row);
          await audit(tx, ctx, {
            date: row.date,
            action: "save",
            requestId: rid,
            before: old ? snapshot(old) : null,
            after: snapshot(row),
            revision: row.revision,
            at: time,
          });
          return row;
        }),
      );
    }
    case "content.daily.delete":
    case "content.daily.restore": {
      const rid = requestId(p.requestId);
      const d = date(p.date);
      const rev = revision(p.revision);
      if (rev === undefined) throw new Error("版本号无效，请刷新后重试");
      const removing = action === "content.daily.delete";
      return store.transaction((tx) =>
        once(tx, ctx, rid, action, { d, rev }, async () => {
          const old = await tx.get<ContentDaily>("content_daily", d);
          if (!old) throw new Error("这一天还没有记录");
          if (old.revision !== rev)
            throw new Error("这一天的记录已在另一处修改，请刷新后重试");
          if (removing && old.deletedAt) throw new Error("这一天的记录已删除");
          if (!removing && !old.deletedAt)
            throw new Error("这一天的记录没有删除，不用恢复");
          const time = now();
          const row: ContentDaily = {
            ...old,
            deletedAt: removing ? time : null,
            updatedAt: time,
            revision: old.revision + 1,
            lastMutation: rid,
          };
          await tx.put("content_daily", d, row);
          await audit(tx, ctx, {
            date: d,
            action: removing ? "delete" : "restore",
            requestId: rid,
            before: snapshot(old),
            after: snapshot(row),
            revision: row.revision,
            at: time,
          });
          return row;
        }),
      );
    }
    case "content.export.publishable": {
      const { from, to } = range(p);
      const rows = await store.list<ContentDaily>("content_daily", {
        fromId: from,
        toId: to,
        max: RANGE_MAX_DAYS,
      });
      return toPublishable(rows, from, to, beijingMinute(new Date(now())));
    }
    case "content.backup": {
      const [daily, auditRows] = await Promise.all([
        store.list<ContentDaily>("content_daily", { max: 5000 }),
        store.list<ContentAudit>("content_audit", { max: 5000 }),
      ]);
      return {
        kind: "content-backup",
        version: 1,
        sources: [...CONTENT_SOURCES],
        exportedAt: now(),
        daily,
        audit: auditRows,
      };
    }
    default:
      throw new Error("不支持这个操作");
  }
}
