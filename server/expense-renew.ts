/**
 * 报销「续费提醒」（EXPENSE_RENEW_ENABLED=1，要 EXPENSES_ENABLED 也开着）：缺省关。
 * 点一下：按记账日期建一条日程（复用 tasks.create：谁点归谁、只有归 Jason 的才同步 iPhone/Notion），
 * 并在报销记录上记下 renew，同一条记录只建一次。
 */
import type { Customer, CustomerTask } from "../src/domain/model";
import { isExpenseRecord, type Expense } from "../src/domain/expenses";
import {
  RENEW_CUSTOMER_ID,
  RENEW_CUSTOMER_NAME,
  renewName,
  renewRemindAt,
  renewRemindDate,
  renewTitle,
  type ExpenseRenew,
} from "../src/domain/renew";
import { writable, type Context, type Store } from "./service";
import { DeniedError, recordOwner, type Actor } from "./team";

export const RENEW_ACTION = "expenses.renew";
const EXPENSES = "expenses" as const;
const ID = /^[\w-]{1,128}$/;

/** 同一条报销对应的日程编号是固定的：重复点、并发点、半路失败重试都落到同一条日程 */
export async function renewTaskId(ctx: Context, expenseId: string): Promise<string> {
  return "renew_" + (await ctx.hash("expense-renew:" + expenseId)).slice(0, 40);
}

export async function renewExpense(
  store: Store,
  ctx: Context,
  actor: Actor,
  p: Record<string, any>,
  now: () => string,
  /** 用原有 tasks.create 建日程（归属、提醒代次、同步规则都和手动新建一样） */
  createTask: (requestId: string, task: Record<string, unknown>) => Promise<CustomerTask>,
): Promise<{ data: { expense: Expense; renew: ExpenseRenew; created: boolean }; target: { type: string; id: string; before?: unknown; after?: unknown } }> {
  const id = typeof p.id === "string" && ID.test(p.id) ? p.id : "";
  if (!id) throw new Error("记录编号无效");
  const old = await store.get<Expense>(EXPENSES, id);
  if (!old || !isExpenseRecord(old) || old.deletedAt) throw new Error("记录不存在");
  if (actor.role !== "admin" && recordOwner(old, ctx.ownerUid) !== actor.uid)
    throw new DeniedError("NOT_OWNER_OF_RECORD", "只能给自己录入的记录设提醒", actor);
  if (old.renew) return { data: { expense: old, renew: old.renew, created: false }, target: { type: "expenses", id, before: old, after: old } };
  if (old.status === "rejected") throw new Error("已驳回的记录不能设提醒");

  // 固定客户「🧾报销续费」：第一次需要时建（做法同手机临时日程），不碰销售数据
  await store.transaction(async (tx) => {
    await writable(tx);
    if (!(await tx.get<Customer>("customers", RENEW_CUSTOMER_ID))) {
      const t = now();
      await tx.put<Customer>("customers", RENEW_CUSTOMER_ID, {
        id: RENEW_CUSTOMER_ID, name: RENEW_CUSTOMER_NAME, mergedInto: null, revision: 1, createdAt: t, updatedAt: t,
      });
    }
  });

  const taskId = await renewTaskId(ctx, id);
  const title = renewTitle(renewName(p.name, old.categoryName));
  const at = renewRemindAt(old.date);
  const existing = await store.get<CustomerTask>("tasks", taskId);
  const task =
    existing ??
    (await createTask(taskId, {
      customerId: RENEW_CUSTOMER_ID,
      at,
      title,
      feedback: "",
      nextAction: "",
      reminder: "both",
    }));

  return store.transaction(async (tx) => {
    const cur = await tx.get<Expense>(EXPENSES, id);
    if (!cur || !isExpenseRecord(cur)) throw new Error("记录不存在");
    if (cur.renew) return { data: { expense: cur, renew: cur.renew, created: false }, target: { type: "expenses", id, before: cur, after: cur } };
    const renew: ExpenseRenew = {
      taskId: task.id,
      at: task.at,
      date: renewRemindDate(old.date),
      title: task.title,
      by: actor.uid,
      createdAt: now(),
    };
    // 只加 renew，不动 revision：正在打开的编辑表单照常能保存（保存时 ...old 会带上 renew）
    const row: Expense = { ...cur, renew };
    await tx.put(EXPENSES, id, row);
    return { data: { expense: row, renew, created: !existing }, target: { type: "expenses", id, before: cur, after: row } };
  });
}
