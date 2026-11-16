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
  receiptsOn,
  renewOn,
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
  selectableCategories,
  receiptMime,
  receiptUploader,
  RECEIPT_MAX_BYTES,
  RECEIPT_MAX_FILES,
  type ExpenseReceipt,
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
import { ReceiptError, decodeReceipt, receiptPath, sniffReceipt } from "./receipts";

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
  "expenses.receipts.prepare",
  "expenses.receipts.upload",
  "expenses.receipts.discard",
  "expenses.receipts.urls",
  "expenses.settlement",
  "expenses.shares",
]);

const RECEIPT_ACTIONS = new Set([
  "expenses.receipts.prepare",
  "expenses.receipts.upload",
  "expenses.receipts.discard",
  "expenses.receipts.urls",
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

function randomName(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "");
}

/**
 * 保存时核对凭证：本次新加的文件必须是操作人自己上传的（路径 expenses/<自己 uid>/）；
 * 原来就挂在这条记录上的照旧保留。凭证没开时不接受新凭证。
 */
function checkReceipts(
  team: TeamConfig,
  actor: Actor,
  next: ExpenseReceipt[] | undefined,
  prev: ExpenseReceipt[] | undefined,
) {
  const before = new Set((prev || []).map((r) => r.fileID));
  for (const r of next || []) {
    if (before.has(r.fileID)) continue;
    if (!receiptsOn(team)) throw new Error("凭证上传尚未开放");
    if (receiptUploader(r.fileID) !== actor.uid) throw new Error("只能附上自己上传的凭证");
  }
}

async function removeFiles(team: TeamConfig, fileIDs: string[]) {
  if (!fileIDs.length || !team.receiptStorage) return;
  await team.receiptStorage.remove(fileIDs).catch(() => team.warn?.("receipt.delete_failed"));
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
  if (RECEIPT_ACTIONS.has(action) && !receiptsOn(team)) throw new UnsupportedActionError();

  if (action === "expenses.receipts.prepare") {
    // 直传：每个文件给一个只对指定路径有效的上传签名；拿不到签名时 ticket 为 null，网页改走中转
    const files = Array.isArray(p.files) ? p.files : [];
    if (!files.length || files.length > RECEIPT_MAX_FILES) throw new ReceiptError(`一次最多上传 ${RECEIPT_MAX_FILES} 个凭证`);
    const storage = team.receiptStorage!;
    const items = [];
    for (const f of files) {
      const name = typeof f?.name === "string" ? f.name.slice(0, 200) : "";
      const mime = receiptMime(name, typeof f?.type === "string" ? f.type : "");
      if (!mime) throw new ReceiptError("凭证只支持 PDF 和图片（JPG、PNG、HEIC、WebP）");
      if (!Number.isSafeInteger(f?.size) || f.size <= 0 || f.size > RECEIPT_MAX_BYTES)
        throw new ReceiptError("凭证单个不能超过 10MB");
      const cloudPath = receiptPath(actor.uid, mime, randomName(), today);
      const ticket = await storage.ticket(cloudPath).catch(() => {
        team.warn?.("receipt.ticket_failed");
        return null;
      });
      items.push({ type: mime, ticket });
    }
    return { data: { items } };
  }

  if (action === "expenses.receipts.upload") {
    // 中转（≤4MB）：查文件头，类型以文件头为准
    const bytes = decodeReceipt(p.data);
    const mime = sniffReceipt(bytes);
    if (!mime) throw new ReceiptError("凭证只支持 PDF 和图片（JPG、PNG、HEIC、WebP）");
    const fileID = await team.receiptStorage!.upload(receiptPath(actor.uid, mime, randomName(), today), bytes);
    return { data: { fileID, type: mime, size: bytes.length } };
  }

  if (action === "expenses.receipts.discard") {
    // 放弃还没保存进记录的凭证：只删自己上传、且没挂在任何记录上的
    const ids: string[] = (Array.isArray(p.fileIDs) ? p.fileIDs : [])
      .filter((x: unknown): x is string => typeof x === "string" && x.length <= 512)
      .slice(0, RECEIPT_MAX_FILES);
    const mine = ids.filter((id) => receiptUploader(id) === actor.uid);
    if (!mine.length) return { data: { removed: 0 } };
    const used = new Set((await listExpenses(store)).flatMap((r) => (r.receipts || []).map((x) => x.fileID)));
    const free = mine.filter((id) => !used.has(id));
    await removeFiles(team, free);
    return { data: { removed: free.length } };
  }

  if (action === "expenses.receipts.urls") {
    const id = recordId(p.id);
    const row = await store.get<Expense>(EXPENSES_COLLECTION, id);
    if (!row || !isExpenseRecord(row) || (row.deletedAt && !admin)) throw new Error("记录不存在");
    ensureOwn(actor, row, ctx.ownerUid);
    const list = row.receipts || [];
    let urls = new Map<string, string>();
    if (list.length) {
      try {
        urls = await team.receiptStorage!.tempUrls(list.map((r) => r.fileID));
      } catch {
        team.warn?.("receipt.url_failed");
      }
    }
    return {
      data: {
        items: list.map((r) => ({ name: r.name, type: r.type, kind: r.kind, size: r.size, url: urls.get(r.fileID) || null })),
      },
    };
  }

  if (action === "expenses.meta") {
    const settings = await loadSettings(store, time);
    const people = peopleOf(ctx, settings);
    const data: ExpenseMeta = {
      owner: { uid: people.ownerUid, name: people.ownerName || OWNER_LABEL },
      partner: { uid: people.partnerUid, name: people.partnerName || PARTNER_LABEL },
      categories: selectableCategories(settings.categories),
      salesPayerEnabled: payerEnabled,
      ...(receiptsOn(team) ? { receiptsEnabled: true } : {}),
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
      selectableCategories(settings.categories),
    );
    checkReceipts(team, actor, input.receipts, undefined);
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
    const r = await store.transaction(async (tx): Promise<{ data: Expense; target: { type: string; id: string; before?: Expense; after: Expense } }> => {
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
          receipts: raw.receipts !== undefined ? raw.receipts : old.receipts,
        },
        // 原记录的分类即使已删除或已下线（如「软件订阅」）也可以保留
        [
          ...selectableCategories(settings.categories),
          ...settings.categories.filter((c) => c.id === old.categoryId && c.id === (raw.categoryId ?? old.categoryId)),
        ],
      );
      checkReceipts(team, actor, input.receipts, old.receipts);
      const row: Expense = {
        ...old,
        ...input,
        updatedAt: time,
        revision: old.revision + 1,
        lastMutation: requestId,
        ...(actor.uid ? { updatedBy: actor.uid } : {}),
      };
      if (!input.receipts) delete row.receipts;
      await tx.put(EXPENSES_COLLECTION, id, row);
      return { data: row, target: { type: "expenses", id, before: old, after: row } };
    });
    // 改记录时拿掉的凭证：提交后再删文件（删失败只告警，不影响记录）
    const kept = new Set((r.data.receipts || []).map((x) => x.fileID));
    const dropped = (r.target.before as Expense | undefined)?.receipts?.filter((x) => !kept.has(x.fileID)) || [];
    if (r.target.before !== r.target.after) await removeFiles(team, dropped.map((x) => x.fileID));
    return r;
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
    }).then(async (r) => {
      // 彻底删除后再删凭证文件
      await removeFiles(team, ((r.target.before as Expense).receipts || []).map((x) => x.fileID));
      return r;
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
        ...(renewOn(team) ? { renewEnabled: true } : {}),
        today,
      },
    };
  }

  throw new UnsupportedActionError();
}
