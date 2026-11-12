/**
 * 日程归属（方案 C）：认领、指派。只在 SCHEDULE_OWNER_ENABLED=1（且 MEMBERS_ENABLED=1）时可用。
 * - 认领：任何已入队的人把日程转到自己名下；
 * - 指派：只有管理员，可以指给自己或任何使用中的成员；
 * - 只改 ownerUid / updatedBy（+ revision、updatedAt、lastMutation），不碰提醒代次。
 */
import type { CustomerTask } from "../src/domain/model";
import { taskOwner } from "../src/domain/members";
import { utcInstant } from "../src/domain/tasks";
import { mutation, writable, type Context, type Store } from "./service";
import { DeniedError, type Actor, type Member } from "./team";

const ID = /^[\w-]{1,128}$/;
export const OWNER_ACTIONS = new Set(["tasks.claim", "tasks.assign"]);

export async function transferOwner(
  store: Store,
  ctx: Context,
  actor: Actor,
  action: string,
  p: Record<string, any>,
  now: () => string,
): Promise<{ data: unknown; target: { type: "tasks"; id: string; before: unknown; after: unknown } }> {
  const id = typeof p.id === "string" && ID.test(p.id) ? p.id : "";
  if (!id) throw new Error("记录编号无效");
  const requestId = typeof p.requestId === "string" && ID.test(p.requestId) ? p.requestId : "";
  if (!requestId) throw new Error("请求编号无效");
  let to = actor.uid;
  if (action === "tasks.assign") {
    if (actor.role !== "admin") throw new DeniedError("ADMIN_ONLY", "只有管理员可以指派日程", actor);
    to = typeof p.to === "string" && ID.test(p.to) ? p.to : "";
    if (!to) throw new Error("指派对象无效");
    if (to !== ctx.ownerUid) {
      const m = to.startsWith("_") ? null : await store.get<Member>("members", to);
      if (!m || m.status !== "active") throw new Error("只能指派给使用中的成员");
    }
  }
  return store.transaction(async (tx) => {
    await writable(tx);
    let before: CustomerTask | null = null;
    let after: CustomerTask | null = null;
    const data = await mutation(tx, ctx, requestId, action, { id, revision: p.revision, to }, async () => {
      const old = await tx.get<CustomerTask>("tasks", id);
      if (!old) throw new Error("日程不存在");
      if (old.deletedAt) throw new Error("请先恢复日程");
      if (old.revision !== p.revision) throw new Error("日程已在另一处修改，请刷新后重试");
      const from = taskOwner(old, ctx.ownerUid);
      before = { ...old, ownerUid: from };
      if (from === to) {
        after = before;
        return { task: old, from, to, unchanged: true };
      }
      const row: CustomerTask = {
        ...old,
        ownerUid: to,
        updatedBy: actor.uid,
        updatedAt: utcInstant(now()),
        revision: old.revision + 1,
        lastMutation: requestId,
      };
      await tx.put("tasks", id, row);
      after = row;
      return { task: row, from, to };
    });
    return { data, target: { type: "tasks" as const, id, before, after: after ?? (data as { task?: unknown }).task } };
  });
}
