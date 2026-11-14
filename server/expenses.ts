/**
 * 报销记账：独立集合 expenses。只在 EXPENSES_ENABLED=1 时可用。
 * 关着时由入口直接抛 UNSUPPORTED_ACTION，不读不写集合。
 */
import {
  UnsupportedActionError,
  type Context,
  type Store,
  type Transaction,
} from "./service";
import {
  DeniedError,
  recordOwner,
  expensesOn,
  salesPayerOn,
  EXPENSE_MEMBER_ACTIONS,
  type Actor,
  type TeamConfig,
} from "./team";
import {
  countsAsExpense,
  defaultSettings,
  displayPayer,
  isExpenseRecord,
  settleMonth,
  compareMonths,
  upcomingDecades,
  validateCategoryName,
  validateExpense,
  type Expense,
  type ExpenseCategory,
  type ExpenseInput,
  type ExpenseMeta,
  type ExpenseSettings,
  type People,
  OWNER_LABEL,
  PARTNER_LABEL,
} from "../src/domain/expenses";
import type { Sale } from "../src/domain/model";
import { today as todayOf } from "../src/domain/dates";

export const EXPENSES_COLLECTION = "expenses" as const;
export const EXPENSE_SETTINGS_ID = "_settings";

export const EXPENSE_ACTIONS = new Set([
  "expenses.meta",
  "expenses.list",
  "expenses.get",
  "expenses.create",
  "expenses.update",
  "expenses.delete",
  "expenses.restore",
  "expenses.purge",
  "expenses.confirm",
  "expenses.reject",
  "expenses.categories.create",
  "expenses.categories.archive",
  "expenses.settlement",
  "expenses.shares",
]);

export const EXPENSE_AUDITED_ACTIONS = new Set([
  "expenses.create",
  "expenses.update",
  "expenses.delete",
  "expenses.restore",
  "expenses.purge",
  "expenses.confirm",
  "expenses.reject",
  "expenses.categories.create",
  "expenses.categories.archive",
]);

const ID = /^[\w-]{1,128}$/;
function recordId(id: unknown): string {
  if (typeof id !== "string" || !id || id.length > 128 || !ID.test(id))
    throw new Error("记录编号无效");
  return id;
}

async function loadSettings(store: Store | Transaction, now: string): Promise<ExpenseSettings> {
  const saved = await store.get<ExpenseSettings>(EXPENSES_COLLECTION, EXPENSE_SETTINGS_ID);
  if (saved && Array.isArray(saved.categories)) {
    return {
      partnerUid: typeof saved.partnerUid === "string" ? saved.partnerUid : "",
      partnerName: saved.partnerName || PARTNER_LABEL,
      categories: saved.categories,
    };
  }
  return defaultSettings(now);
}

async function saveSettings(tx: Transaction, settings: ExpenseSettings) {
  await tx.put(EXPENSES_COLLECTION, EXPENSE_SETTINGS_ID, settings);
}

async function listExpenses(store: Store): Promise<Expense[]> {
  const rows = await store.list<Expense | ExpenseSettings>(EXPENSES_COLLECTION);
  return rows.filter((r) => isExpenseRecord(r as { id?: string })) as Expense[];
}

function peopleOf(ctx: Context, settings: ExpenseSettings): People {
  return {
    ownerUid: ctx.ownerUid,
    ownerName: OWNER_LABEL,
    partnerUid: settings.partnerUid || "partner-zhou",
    partnerName: settings.partnerName || PARTNER_LABEL,
  };
}

function visibleTo(actor: Actor, rows: Expense[], ownerUid: string): Expense[] {
  if (actor.role === "admin") return rows;
  return rows.filter((r) => recordOwner(r, ownerUid) === actor.uid);
}

function ensureOwn(actor: Actor, row: Expense, ownerUid: string) {
  if (actor.role !== "admin" && recordOwner(row, ownerUid) !== actor.uid)
    throw new DeniedError("NOT_OWNER_OF_RECORD", "只能查看或修改自己录入的记录", actor);
}

function monthOf(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === "") return fallback.slice(0, 7);
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) throw new Error("月份无效");
  return value;
}

export async function executeExpenses(
  store: Store,
  ctx: Context,
  team: TeamConfig,
  actor: Actor,
  action: string,
  p: Record<string, any>,
  now: () => string,
): Promise<{ data: unknown; target?: { type: string; id: string; before?: unknown; after?: unknown } }> {
  if (!expensesOn(team)) throw new UnsupportedActionError();
  const admin = actor.role === "admin";
  if (!admin && !EXPENSE_MEMBER_ACTIONS.has(action))
    throw new DeniedError("ADMIN_ONLY", "这个操作只有管理员可以进行", actor);
  const time = now();
  const today = todayOf(new Date(time));
  const payerEnabled = salesPayerOn(team);

  if (action === "expenses.meta") {
    const settings = await loadSettings(store, time);
    const people = peopleOf(ctx, settings);
    const data: ExpenseMeta = {
      owner: { uid: people.ownerUid, name: people.ownerName || OWNER_LABEL },
      partner: { uid: people.partnerUid, name: people.partnerName || PARTNER_LABEL },
      categories: settings.categories.filter((c) => !c.archivedAt),
      salesPayerEnabled: payerEnabled,
    };
    return { data };
  }

  if (action === "expenses.categories.create") {
    const name = validateCategoryName(p.name);
    return store.transaction(async (tx) => {
      const settings = await loadSettings(tx, time);
      const exists = settings.categories.find(
        (c) => !c.archivedAt && c.name === name,
      );
      if (exists) return { data: exists, target: { type: "expenses", id: exists.id, after: exists } };
      const hint = typeof p.hint === "string" && p.hint.trim() && p.hint.length <= 80 ? p.hint.trim() : undefined;
      const cat: ExpenseCategory = {
        id: recordId(typeof p.requestId === "string" && ID.test(p.requestId) ? p.requestId : `cat-${Date.now()}`),
        name,
        ...(hint ? { hint } : {}),
        createdAt: time,
      };
      if (settings.categories.some((c) => c.id === cat.id)) throw new Error("分类编号已存在，请重试");
      settings.categories = [...settings.categories, cat];
      await saveSettings(tx, settings);
      return { data: cat, target: { type: "expenses", id: cat.id, after: cat } };
    });
  }

  if (action === "expenses.categories.archive") {
    if (!admin) throw new DeniedError("ADMIN_ONLY", "只有管理员可以删除分类", actor);
    const id = recordId(p.id);
    return store.transaction(async (tx) => {
      const settings = await loadSettings(tx, time);
      const cat = settings.categories.find((c) => c.id === id);
      if (!cat) throw new Error("分类不存在");
      if (cat.archivedAt) return { data: cat, target: { type: "expenses", id, before: cat, after: cat } };
      const next = { ...cat, archivedAt: time };
      settings.categories = settings.categories.map((c) => (c.id === id ? next : c));
      await saveSettings(tx, settings);
      return { data: next, target: { type: "expenses", id, before: cat, after: next } };
    });
  }

  if (action === "expenses.list") {
    if (p.deleted && !admin) throw new DeniedError("ADMIN_ONLY", "回收站只有管理员可以查看", actor);
    const settings = await loadSettings(store, time);
    let rows = (await listExpenses(store)).filter((r) => Boolean(r.deletedAt) === Boolean(p.deleted));
    if (typeof p.from === "string" && p.from) rows = rows.filter((r) => r.date >= p.from);
    if (typeof p.to === "string" && p.to) rows = rows.filter((r) => r.date <= p.to);
    if (typeof p.status === "string" && p.status) rows = rows.filter((r) => r.status === p.status);
    rows = visibleTo(actor, rows, ctx.ownerUid);
    rows.sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.createdAt.localeCompare(a.createdAt) ||
        b.id.localeCompare(a.id),
    );
    const people = peopleOf(ctx, settings);
    return {
      data: {
        items: rows,
        total: rows.length,
        pendingCount: admin
          ? (await listExpenses(store)).filter((r) => !r.deletedAt && r.status === "pending_confirm").length
          : 0,
        people: { owner: { uid: people.ownerUid, name: people.ownerName }, partner: { uid: people.partnerUid, name: people.partnerName } },
      },
    };
  }

  if (action === "expenses.get") {
    const id = recordId(p.id);
    const row = await store.get<Expense>(EXPENSES_COLLECTION, id);
    if (!row || !isExpenseRecord(row) || (row.deletedAt && !admin)) throw new Error("记录不存在");
    ensureOwn(actor, row, ctx.ownerUid);
    return { data: row, target: { type: "expenses", id } };
  }

  if (action === "expenses.create") {
    const id = recordId(p.requestId);
    const settings = await loadSettings(store, time);
    const people = peopleOf(ctx, settings);
    const allowedPayers = new Set([people.ownerUid, people.partnerUid]);
    const raw = p.expense as ExpenseInput;
    let status: Expense["status"] = admin
      ? raw?.status === "reimbursed"
        ? "reimbursed"
        : "pending_reimburse"
      : "pending_confirm";
    const paidBy =
      typeof raw?.paidBy === "string" && allowedPayers.has(raw.paidBy)
        ? raw.paidBy
        : actor.uid === people.partnerUid
          ? people.partnerUid
          : people.ownerUid;
    const input = validateExpense(
      { ...raw, paidBy, status },
      settings.categories.filter((c) => !c.archivedAt),
    );
    return store.transaction(async (tx) => {
      const existing = await tx.get<Expense>(EXPENSES_COLLECTION, id);
      if (existing) {
        if (
          existing.date !== input.date ||
          existing.amount !== input.amount ||
          existing.categoryId !== input.categoryId
        )
          throw new Error("这次保存已完成，请刷新后再编辑");
        return { data: existing, target: { type: "expenses", id, after: existing } };
      }
      const row: Expense = {
        ...input,
        id,
        createdAt: time,
        updatedAt: time,
        deletedAt: null,
        revision: 1,
        ...(ctx.actorUid || actor.uid ? { createdBy: ctx.actorUid || actor.uid } : {}),
      };
      await tx.put(EXPENSES_COLLECTION, id, row);
      return { data: row, target: { type: "expenses", id, after: row } };
    });
  }

  if (action === "expenses.update") {
    const id = recordId(p.id);
    const requestId = recordId(p.requestId);
    const settings = await loadSettings(store, time);
    const people = peopleOf(ctx, settings);
    const allowedPayers = new Set([people.ownerUid, people.partnerUid]);
    return store.transaction(async (tx) => {
      const old = await tx.get<Expense>(EXPENSES_COLLECTION, id);
      if (!old || !isExpenseRecord(old)) throw new Error("记录不存在");
      if (old.lastMutation === requestId) return { data: old, target: { type: "expenses", id, after: old } };
      if (old.revision !== p.revision) throw new Error("记录已在另一处修改，请刷新后重试");
      if (old.deletedAt) throw new Error("请先恢复记录");
      ensureOwn(actor, old, ctx.ownerUid);
      if (!admin && old.status !== "pending_confirm")
        throw new DeniedError("ADMIN_ONLY", "已入账的记录不能再改", actor);
      const raw = (p.expense || {}) as ExpenseInput;
      let status = old.status;
      if (admin) {
        if (raw.status === "pending_reimburse" || raw.status === "reimbursed") status = raw.status;
        // 管理员改自己待确认以外的记录，不允许改回 pending_confirm / rejected（走 confirm/reject）
      } else {
        status = "pending_confirm";
      }
      const paidBy =
        typeof raw.paidBy === "string" && allowedPayers.has(raw.paidBy) ? raw.paidBy : old.paidBy;
      const input = validateExpense(
        {
          date: raw.date ?? old.date,
          amount: raw.amount ?? old.amount,
          categoryId: raw.categoryId ?? old.categoryId,
          categoryName: raw.categoryName ?? old.categoryName,
          paidBy,
          hasInvoice: typeof raw.hasInvoice === "boolean" ? raw.hasInvoice : old.hasInvoice,
          note: typeof raw.note === "string" ? raw.note : old.note,
          status,
        },
        settings.categories.filter((c) => !c.archivedAt || c.id === (raw.categoryId ?? old.categoryId)),
      );
      const row: Expense = {
        ...old,
        ...input,
        updatedAt: time,
        revision: old.revision + 1,
        lastMutation: requestId,
        ...(actor.uid ? { updatedBy: actor.uid } : {}),
      };
      await tx.put(EXPENSES_COLLECTION, id, row);
      return { data: row, target: { type: "expenses", id, before: old, after: row } };
    });
  }

  if (action === "expenses.delete" || action === "expenses.restore") {
    const id = recordId(p.id);
    const requestId = recordId(p.requestId);
    if (action === "expenses.restore" && !admin)
      throw new DeniedError("ADMIN_ONLY", "只有管理员可以恢复记录", actor);
    return store.transaction(async (tx) => {
      const old = await tx.get<Expense>(EXPENSES_COLLECTION, id);
      if (!old || !isExpenseRecord(old)) throw new Error("记录不存在");
      if (old.lastMutation === requestId) return { data: old, target: { type: "expenses", id, after: old } };
      if (old.revision !== p.revision) throw new Error("记录已在另一处修改，请刷新后重试");
      if (action === "expenses.delete") ensureOwn(actor, old, ctx.ownerUid);
      if (action === "expenses.restore" && !old.deletedAt) throw new Error("记录不在回收站中");
      const row: Expense = {
        ...old,
        deletedAt: action === "expenses.delete" ? time : null,
        updatedAt: time,
        revision: old.revision + 1,
        lastMutation: requestId,
        ...(actor.uid ? { updatedBy: actor.uid } : {}),
      };
      if (action === "expenses.delete" && actor.uid) row.deletedBy = actor.uid;
      if (action === "expenses.restore") delete row.deletedBy;
      await tx.put(EXPENSES_COLLECTION, id, row);
      return { data: row, target: { type: "expenses", id, before: old, after: row } };
    });
  }

  if (action === "expenses.purge") {
    if (!admin) throw new DeniedError("ADMIN_ONLY", "只有管理员可以彻底删除", actor);
    const id = recordId(p.id);
    return store.transaction(async (tx) => {
      const old = await tx.get<Expense>(EXPENSES_COLLECTION, id);
      if (!old || !isExpenseRecord(old)) throw new Error("记录不存在");
      if (old.revision !== p.revision) throw new Error("记录已在另一处修改，请刷新后重试");
      if (!old.deletedAt) throw new Error("只能彻底删除回收站中的记录");
      await tx.del(EXPENSES_COLLECTION, id);
      return { data: { purged: true }, target: { type: "expenses", id, before: old } };
    });
  }

  if (action === "expenses.confirm" || action === "expenses.reject") {
    if (!admin) throw new DeniedError("ADMIN_ONLY", "只有管理员可以确认或驳回", actor);
    const id = recordId(p.id);
    const requestId = recordId(p.requestId);
    return store.transaction(async (tx) => {
      const old = await tx.get<Expense>(EXPENSES_COLLECTION, id);
      if (!old || !isExpenseRecord(old)) throw new Error("记录不存在");
      if (old.lastMutation === requestId) return { data: old, target: { type: "expenses", id, after: old } };
      if (old.revision !== p.revision) throw new Error("记录已在另一处修改，请刷新后重试");
      if (old.deletedAt) throw new Error("记录已在回收站中");
      if (old.status !== "pending_confirm") throw new Error("只能确认或驳回待确认的记录");
      const row: Expense = {
        ...old,
        status: action === "expenses.confirm" ? "pending_reimburse" : "rejected",
        updatedAt: time,
        revision: old.revision + 1,
        lastMutation: requestId,
        confirmedBy: actor.uid,
        confirmedAt: time,
        updatedBy: actor.uid,
      };
      await tx.put(EXPENSES_COLLECTION, id, row);
      return { data: row, target: { type: "expenses", id, before: old, after: row } };
    });
  }

  if (action === "expenses.settlement" || action === "expenses.shares") {
    const settings = await loadSettings(store, time);
    const people = peopleOf(ctx, settings);
    const [sales, expenses] = await Promise.all([
      store.list<Sale>("sales"),
      listExpenses(store),
    ]);
    const activeSales = sales.filter((s) => !s.deletedAt);
    // 成员看合账时，报销只计入自己已入账的（不泄露别人的报销明细与金额）
    const visibleExpenses = admin ? expenses : visibleTo(actor, expenses, ctx.ownerUid);
    if (action === "expenses.shares") {
      const decades = upcomingDecades(today).map((d) =>
        settleMonth(d.month, today, activeSales, visibleExpenses, people, payerEnabled).decades[d.index],
      );
      return {
        data: {
          today,
          items: decades,
          sample: false,
        },
      };
    }
    const month = monthOf(p.month, today);
    const settled = settleMonth(month, today, activeSales, visibleExpenses, people, payerEnabled);
    const compare = compareMonths(today, activeSales, visibleExpenses, people, payerEnabled, 5);
    // 明细：成员只看自己的；管理员看全部（含待确认）
    const details = visibleTo(actor, expenses, ctx.ownerUid)
      .filter((e) => !e.deletedAt && e.date.startsWith(month) && countsAsExpense(e.date))
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          b.createdAt.localeCompare(a.createdAt) ||
          b.id.localeCompare(a.id),
      )
      .map((e) => ({
        ...e,
        payerName: displayPayer(e.paidBy, people),
      }));
    return {
      data: {
        ...settled,
        compare,
        details,
        people: {
          owner: { uid: people.ownerUid, name: people.ownerName },
          partner: { uid: people.partnerUid, name: people.partnerName },
        },
        salesPayerEnabled: payerEnabled,
        today,
      },
    };
  }

  throw new UnsupportedActionError();
}
