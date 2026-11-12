/**
 * 上线第 3 步「只读预演」：用导出的数据（不连云端、不写任何东西）算出
 * 开关打开后 iPhone 同步列表里还剩哪些、撤下清单里有哪些（重点看周诗懿以前建的）。
 */
import type { Customer, CustomerTask } from "../src/domain/model";
import { colorKeyAt, isColorKey, taskOwner } from "../src/domain/members";
import { MemoryStore } from "./memory-store";
import { syncList } from "./task-sync";

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
    /** 开关打开后第一轮对账要从 Jason 手机删掉的（撤下清单里、且现在在手机同步范围里的） */
    removeFromPhone: before.tasks.filter((t) => withdrawn.includes(t.id)).map((t) => ({ id: t.id, atLocal: t.atLocal, title: t.title, owner: nameOf(taskOwner(byId.get(t.id), input.ownerUid)) })),
    withdrawn: withdrawn.map((id) => {
      const t = byId.get(id)!;
      return { id, at: t.at, title: t.title, owner: nameOf(taskOwner(t, input.ownerUid)), deleted: !!t.deletedAt };
    }),
    colorPlan,
  };
}
