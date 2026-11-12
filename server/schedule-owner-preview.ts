/**
 * 上线第 3 步「只读预演」：用导出的数据（不连云端、不写任何东西）算出
 * 开关打开后 iPhone 同步列表里还剩哪些、撤下清单里有哪些（重点看早期成员以前建的）。
 */
import type { Customer, CustomerTask } from "../src/domain/model";
import { colorKeyAt, isColorKey, taskOwner } from "../src/domain/members";
import { MemoryStore } from "./memory-store";
import { syncList, toShanghaiLocal } from "./task-sync";

export interface PreviewMember {
  uid: string;
  name?: string;
  status?: string;
  createdAt?: string;
  color?: string;
}
export async function previewScheduleOwner(input: {
  tasks: CustomerTask[];
  customers: Customer[];
  members?: PreviewMember[];
  ownerUid: string;
  now: string;
}) {
  const store = new MemoryStore();
  for (const t of input.tasks) store.data.tasks[t.id] = t;
  for (const c of input.customers) store.data.customers[c.id] = c;
  const [before, after] = await Promise.all([syncList(store, input.now), syncList(store, input.now, input.ownerUid)]);
  const byId = new Map(input.tasks.map((t) => [t.id, t]));
  const names = new Map((input.members ?? []).map((m) => [m.uid, m.name ?? m.uid]));
  const nameOf = (uid: string) => (uid === input.ownerUid ? "Jason" : names.get(uid) ?? uid);
  const withdrawn = (after as { withdrawn?: string[] }).withdrawn ?? [];
  const nowMs = Date.parse(input.now);
  const nowIds = new Set(before.tasks.map((t) => t.id));
  const withdrawnRows = withdrawn.map((id) => {
    const t = byId.get(id)!;
    return {
      id,
      at: t.at,
      atLocal: toShanghaiLocal(t.at),
      title: t.title,
      owner: nameOf(taskOwner(t, input.ownerUid)),
      window: (Date.parse(t.at) <= nowMs ? "past" : "future") as "past" | "future",
      deleted: !!t.deletedAt,
    };
  });
  // 补色预演（只算不写）：按入队先后，给没有颜色的已入队成员分色
  const people = (input.members ?? [])
    .filter((m) => !m.uid.startsWith("_") && m.status !== "pending")
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.uid.localeCompare(b.uid));
  let n = people.filter((m) => isColorKey(m.color)).length;
  const colorPlan = people.filter((m) => !isColorKey(m.color)).map((m) => ({ uid: m.uid, name: m.name, color: colorKeyAt(n++) }));
  return {
    now: input.now,
    syncBefore: before.tasks.length,
    syncAfter: after.tasks.length,
    /**
     * 开关打开后第一轮对账要从 Jason 手机删掉的：撤下窗口（过去 30 天 ~ 未来 90 天）里所有不归 Jason、没删的日程。
     * 过去 30 天的也算——它们已经不在同步列表里了，但可能还留在手机提醒事项里，同样会被撤下。
     * window = past（已过时间）/ future（还没到）；inSyncNow = 现在的同步列表里有没有它。
     */
    removeFromPhone: withdrawnRows
      .filter((r) => !r.deleted)
      .map(({ deleted: _d, ...r }) => ({ ...r, inSyncNow: nowIds.has(r.id) })),
    withdrawnFrom: (after as { withdrawnFrom?: string }).withdrawnFrom,
    withdrawnTo: (after as { withdrawnTo?: string }).withdrawnTo,
    counts: {
      withdrawn: withdrawnRows.length,
      past: withdrawnRows.filter((r) => r.window === "past").length,
      future: withdrawnRows.filter((r) => r.window === "future").length,
      deleted: withdrawnRows.filter((r) => r.deleted).length,
    },
    /** 完整撤下清单（含已删的、含过去 30 天的） */
    withdrawn: withdrawnRows,
    colorPlan,
  };
}
