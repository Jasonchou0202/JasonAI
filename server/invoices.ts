/**
 * 普票开票管理（INVOICE_ENABLED=1）：缺省关，关着时入口不认这些 action（UNSUPPORTED_ACTION），不读不写 invoices。
 * - 客户开票资料：invoices/prof_<客户id>，每个客户一套（粘贴原文 / 上传原件 / 可选结构化字段）。
 * - 每笔销售的开票：invoices/inv_<销售id>，只读 sales，不改 sales、customers（冻结集合一行不动）。
 * - 「待开票」超过 3 天没动：进入待开票时就按确定性编号建一条日程（复用 tasks.create：归打开开票的人，
 *   只有归 Jason 的才同步 iPhone / Notion），离开待开票时把这条日程标完成。
 */
import type { Customer, CustomerTask, Sale } from "../src/domain/model";
import { customerRoots, displayCustomerName } from "../src/domain/customers";
import { today as todayOf } from "../src/domain/dates";
import {
  INVOICE_CUSTOMER_ID,
  INVOICE_CUSTOMER_NAME,
  INVOICE_FILE_MAX,
  INVOICE_FILE_MAX_BYTES,
  INVOICE_MIME,
  INVOICE_MIME_EXT,
  INVOICE_STATUSES,
  INVOICE_STATUS_LABEL,
  INVOICE_TYPE,
  OPEN_STATUSES,
  checkStatus,
  invoiceFileMime,
  invoiceId,
  invoiceRemindAt,
  invoiceRemindTitle,
  invoiceStats,
  invoiceUploader,
  profileComplete,
  profileId,
  profileTitle,
  validateFields,
  validateFiles,
  validateText,
  type InvoiceDoc,
  type InvoiceFile,
  type InvoiceFilePurpose,
  type InvoiceListResult,
  type InvoiceProfile,
  type InvoiceProfileView,
  type InvoiceRecord,
  type InvoiceRow,
  type InvoiceStatus,
  type ProfileMime,
} from "../src/domain/invoices";
import { UnsupportedActionError, writable, type Context, type Store } from "./service";
import { sniffReceipt } from "./receipts";
import type { Actor, TeamConfig } from "./team";

export const INVOICES = "invoices" as const;
export const INVOICE_ACTIONS = new Set([
  "invoices.meta",
  "invoices.list",
  "invoices.forSales",
  "invoices.profile.get",
  "invoices.profile.save",
  "invoices.toggle",
  "invoices.update",
  "invoices.files.upload",
  "invoices.files.discard",
  "invoices.files.urls",
]);
export const INVOICE_AUDITED_ACTIONS = new Set(["invoices.profile.save", "invoices.toggle", "invoices.update"]);

/** 开票真正生效：开关开（附件另外要有云存储） */
export const invoicesOn = (t: TeamConfig) => !!t.invoiceEnabled;
export const invoiceFilesOn = (t: TeamConfig) => invoicesOn(t) && !!t.receiptStorage;

const ID = /^[\w-]{1,128}$/;
function idOf(v: unknown, what = "记录编号无效"): string {
  if (typeof v !== "string" || !ID.test(v)) throw new Error(what);
  return v;
}

export interface InvoiceHooks {
  /** 用原有 tasks.create 建日程，ownerUid = 日程归属人 */
  createTask: (ownerUid: string, requestId: string, task: Record<string, unknown>) => Promise<CustomerTask>;
  /** 用原有 tasks.complete 把日程标完成 */
  completeTask: (task: CustomerTask, requestId: string) => Promise<unknown>;
}

/** 同一笔开票、同一轮「待开票」对应的日程编号固定：重复点、并发、半路失败重试都落到同一条 */
export async function invoiceTaskId(ctx: Context, id: string, since: string): Promise<string> {
  return "invrem_" + (await ctx.hash(`invoice-remind:${id}:${since}`)).slice(0, 40);
}

/** 按文件头 + 扩展名判断类型；Word/txt 没有可靠文件头，按扩展名并做最基本的核对 */
export function sniffInvoiceFile(b: Uint8Array, name: string): ProfileMime | null {
  const byName = invoiceFileMime(name);
  const head = sniffReceipt(b);
  if (head === "application/pdf" || head === "image/png" || head === "image/jpeg") return head;
  if (head) return null;
  if (byName === "application/msword")
    return b.length >= 8 && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((x, i) => b[i] === x) ? byName : null;
  if (byName === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 ? byName : null;
  if (byName === "text/plain") {
    if (b.includes(0)) return null;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(b);
      return byName;
    } catch {
      return null;
    }
  }
  return null;
}

export function invoicePath(uid: string, mime: ProfileMime, random: string, day: string): string {
  if (!ID.test(uid)) throw new Error("上传人无效");
  const safe = random.replace(/[^\w]/g, "").slice(0, 32) || "file";
  return `invoices/${uid}/${day.replace(/-/g, "")}-${safe}.${INVOICE_MIME_EXT[mime]}`;
}

function decodeFile(input: unknown): Uint8Array {
  if (typeof input !== "string" || !input) throw new Error("文件无效");
  const raw = input.replace(/^data:[\w/+.-]*;base64,/, "");
  if (raw.length > Math.ceil(INVOICE_FILE_MAX_BYTES / 3) * 4 + 4) throw new Error("文件不能超过 4MB");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) throw new Error("文件无效");
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (!bytes.length || bytes.length > INVOICE_FILE_MAX_BYTES) throw new Error("文件不能超过 4MB");
  return bytes;
}

async function allDocs(store: Store): Promise<InvoiceDoc[]> {
  return (await store.list<InvoiceDoc>(INVOICES)).filter((d) => d && (d.kind === "profile" || d.kind === "invoice"));
}

/** 销售上的客户名 → 根客户（名字或别名完全一致；对不上返回空） */
async function customerOf(store: Store, name: string): Promise<{ id: string; name: string }> {
  const customers = await store.list<Customer>("customers");
  const roots = customerRoots(customers);
  const hit = customers.find((c) => !c.archivedAt && c.name === name);
  if (!hit) return { id: "", name: displayCustomerName(name || "") };
  const root = roots.get(hit.id) || hit.id;
  const rc = customers.find((c) => c.id === root);
  return { id: root, name: displayCustomerName(rc?.name || name) };
}

function checkNewFiles(next: InvoiceFile[], prev: InvoiceFile[] | undefined, actor: Actor, team: TeamConfig) {
  const before = new Set((prev || []).map((f) => f.fileID));
  for (const f of next) {
    if (before.has(f.fileID)) continue;
    if (!invoiceFilesOn(team)) throw new Error("附件上传尚未开放");
    if (invoiceUploader(f.fileID) !== actor.uid) throw new Error("只能附上自己上传的文件");
  }
}

async function removeFiles(team: TeamConfig, ids: string[]) {
  if (!ids.length || !team.receiptStorage) return;
  await team.receiptStorage.remove(ids).catch(() => team.warn?.("invoice.delete_failed"));
}

function amountOf(v: unknown): number {
  if (!Number.isSafeInteger(v) || (v as number) <= 0 || (v as number) > 10_000_000_000) throw new Error("开票金额无效");
  return v as number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function executeInvoices(
  store: Store,
  ctx: Context,
  team: TeamConfig,
  actor: Actor,
  action: string,
  p: Record<string, any>,
  now: () => string,
  hooks: InvoiceHooks,
): Promise<{ data: unknown; target?: { type: string; id: string; before?: unknown; after?: unknown } }> {
  if (!invoicesOn(team) || !INVOICE_ACTIONS.has(action)) throw new UnsupportedActionError();
  const time = now();
  const today = todayOf(new Date(time));
  const filesOn = invoiceFilesOn(team);

  /** 进入「待开票」：先按确定性编号建好日程（已有就复用），再写回记录 */
  const schedule = async (rec: InvoiceRecord): Promise<InvoiceRecord> => {
    const since = rec.statusAt;
    if (rec.remind && rec.remind.since === since) return rec;
    const taskId = await invoiceTaskId(ctx, rec.id, since);
    let customerId = rec.customerId;
    if (!customerId || !(await store.get<Customer>("customers", customerId))) {
      customerId = INVOICE_CUSTOMER_ID;
      await store.transaction(async (tx) => {
        await writable(tx);
        if (!(await tx.get<Customer>("customers", INVOICE_CUSTOMER_ID)))
          await tx.put<Customer>("customers", INVOICE_CUSTOMER_ID, {
            id: INVOICE_CUSTOMER_ID, name: INVOICE_CUSTOMER_NAME, mergedInto: null, revision: 1, createdAt: time, updatedAt: time,
          });
      });
    }
    const owner = rec.createdBy || ctx.ownerUid;
    const existing = await store.get<CustomerTask>("tasks", taskId);
    const task =
      existing ??
      (await hooks.createTask(owner, taskId, {
        customerId,
        at: invoiceRemindAt(since),
        title: invoiceRemindTitle(rec.customerName),
        feedback: "",
        nextAction: "",
        reminder: "both",
      }));
    return { ...rec, remind: { taskId: task.id, at: task.at, by: owner, since } };
  };
  /** 离开「待开票」：把这一轮的日程标完成（失败只告警，不影响开票记录） */
  const close = async (rec: InvoiceRecord): Promise<InvoiceRecord> => {
    if (!rec.remind || rec.remind.doneAt) return rec;
    try {
      const task = await store.get<CustomerTask>("tasks", rec.remind.taskId);
      if (task && !task.completedAt && !task.deletedAt)
        await hooks.completeTask(task, "invdone_" + (await ctx.hash(`invoice-done:${rec.remind.taskId}`)).slice(0, 40));
      return { ...rec, remind: { ...rec.remind, doneAt: time } };
    } catch {
      team.warn?.("invoice.remind_close_failed");
      return rec;
    }
  };
  const putRecord = async (rec: InvoiceRecord) =>
    store.transaction(async (tx) => {
      await writable(tx);
      await tx.put(INVOICES, rec.id, rec);
    });

  if (action === "invoices.meta") return { data: { filesEnabled: filesOn } };

  if (action === "invoices.files.upload") {
    if (!filesOn) throw new Error("附件上传尚未开放");
    const purpose: InvoiceFilePurpose = p.purpose === "invoice" ? "invoice" : "profile";
    const name = typeof p.name === "string" ? p.name.slice(0, 120) : "";
    const bytes = decodeFile(p.data);
    const mime = sniffInvoiceFile(bytes, name);
    if (!mime || (purpose === "invoice" && !INVOICE_MIME.includes(mime)))
      throw new Error(purpose === "invoice" ? "发票只支持 PDF 和图片（PNG、JPG）" : "只支持 PDF、Word、txt、PNG、JPG");
    const random = globalThis.crypto.randomUUID().replace(/-/g, "");
    const fileID = await team.receiptStorage!.upload(invoicePath(actor.uid, mime, random, today), bytes);
    const file: InvoiceFile = { fileID, name: name || "附件", type: mime, size: bytes.length };
    return { data: file };
  }

  if (action === "invoices.files.discard") {
    const ids: string[] = (Array.isArray(p.fileIDs) ? p.fileIDs : [])
      .filter((x: unknown): x is string => typeof x === "string" && x.length <= 512)
      .slice(0, INVOICE_FILE_MAX);
    const mine = ids.filter((id) => invoiceUploader(id) === actor.uid);
    if (!mine.length) return { data: { removed: 0 } };
    const used = new Set((await allDocs(store)).flatMap((d) => (d.files || []).map((f) => f.fileID)));
    const free = mine.filter((id) => !used.has(id));
    await removeFiles(team, free);
    return { data: { removed: free.length } };
  }

  if (action === "invoices.files.urls") {
    const id = idOf(p.id);
    const doc = await store.get<InvoiceDoc>(INVOICES, id);
    if (!doc) throw new Error("记录不存在");
    const list = doc.files || [];
    let urls = new Map<string, string>();
    if (list.length && team.receiptStorage)
      try {
        urls = await team.receiptStorage.tempUrls(list.map((f) => f.fileID));
      } catch {
        team.warn?.("invoice.url_failed");
      }
    return { data: { items: list.map((f) => ({ name: f.name, type: f.type, size: f.size, url: urls.get(f.fileID) || null })) } };
  }

  if (action === "invoices.profile.get") {
    const customerId = idOf(p.customerId, "客户编号无效");
    const [profile, docs] = await Promise.all([store.get<InvoiceProfile>(INVOICES, profileId(customerId)), allDocs(store)]);
    const view: InvoiceProfileView = {
      customerId,
      profile: profile?.kind === "profile" ? profile : null,
      complete: profileComplete(profile),
      title: profileTitle(profile),
      filesEnabled: filesOn,
      open: docs.filter((d): d is InvoiceRecord => d.kind === "invoice" && d.customerId === customerId && OPEN_STATUSES.includes(d.status)).length,
    };
    return { data: view };
  }

  if (action === "invoices.profile.save") {
    const customerId = idOf(p.customerId, "客户编号无效");
    const customer = await store.get<Customer>("customers", customerId);
    if (!customer || customer.mergedInto) throw new Error("客户不存在");
    const text = validateText(p.text);
    const fields = validateFields(p.fields);
    const files = validateFiles(p.files, "profile");
    const id = profileId(customerId);
    const { before, row, dropped } = await store.transaction(async (tx) => {
      await writable(tx);
      const old = await tx.get<InvoiceProfile>(INVOICES, id);
      if ((old?.revision ?? 0) !== (p.revision ?? 0)) throw new Error("开票信息已在另一处修改，请刷新后重试");
      checkNewFiles(files, old?.files, actor, team);
      const row: InvoiceProfile = {
        kind: "profile", id, customerId, text, fields, files,
        createdAt: old?.createdAt || time, updatedAt: time, updatedBy: actor.uid, revision: (old?.revision ?? 0) + 1,
      };
      await tx.put(INVOICES, id, row);
      const keep = new Set(files.map((f) => f.fileID));
      return { before: old, row, dropped: (old?.files || []).map((f) => f.fileID).filter((x) => !keep.has(x)) };
    });
    await removeFiles(team, dropped);
    // 资料齐了：这位客户「待收资料」的开票自动进入「待开票」（并按归属人建提醒）
    let moved = 0;
    if (profileComplete(row)) {
      const title = profileTitle(row);
      const waiting = (await allDocs(store)).filter((d): d is InvoiceRecord => d.kind === "invoice" && d.customerId === customerId && d.status === "awaiting_info");
      for (const rec of waiting) {
        const next = await schedule({ ...rec, status: "pending", title: rec.title || title, statusAt: time, updatedAt: time, updatedBy: actor.uid, revision: rec.revision + 1 });
        await putRecord(next);
        moved += 1;
      }
    }
    return {
      data: { profile: row, complete: profileComplete(row), title: profileTitle(row), moved },
      target: { type: "invoices", id, before: before ? { revision: before.revision } : null, after: { revision: row.revision, complete: profileComplete(row), files: files.length } },
    };
  }

  if (action === "invoices.toggle") {
    const saleId = idOf(p.saleId);
    const id = invoiceId(saleId);
    const old = await store.get<InvoiceRecord>(INVOICES, id);
    if (p.on === false) {
      if (!old) return { data: { record: null }, target: { type: "invoices", id } };
      if (!OPEN_STATUSES.includes(old.status)) throw new Error(`已${INVOICE_STATUS_LABEL[old.status].replace(/^已/, "")}的发票不能取消，请改为作废或红冲`);
      await close(old);
      await store.transaction(async (tx) => {
        await writable(tx);
        await tx.del(INVOICES, id);
      });
      await removeFiles(team, (old.files || []).map((f) => f.fileID));
      return { data: { record: null }, target: { type: "invoices", id, before: { status: old.status }, after: null } };
    }
    if (old) return { data: { record: old }, target: { type: "invoices", id, before: { status: old.status }, after: { status: old.status } } };
    const sale = await store.get<Sale>("sales", saleId);
    if (!sale || sale.deletedAt) throw new Error("销售记录不存在");
    const customer = await customerOf(store, sale.customer);
    const profile = customer.id ? await store.get<InvoiceProfile>(INVOICES, profileId(customer.id)) : null;
    const amount = p.amount === undefined || p.amount === null ? sale.revenue : amountOf(p.amount);
    if (!(amount > 0)) throw new Error("这笔销售额为 0，请填开票金额");
    const status: InvoiceStatus = profileComplete(profile) ? "pending" : "awaiting_info";
    let rec: InvoiceRecord = {
      kind: "invoice", id, saleId,
      customerId: customer.id, customerName: customer.name,
      productName: sale.productName, saleDate: sale.date, saleRevenue: sale.revenue,
      amount, type: INVOICE_TYPE, status, title: profileTitle(profile),
      statusAt: time, createdAt: time, updatedAt: time, createdBy: actor.uid, revision: 1,
    };
    if (status === "pending") rec = await schedule(rec);
    const saved = await store.transaction(async (tx) => {
      await writable(tx);
      const cur = await tx.get<InvoiceRecord>(INVOICES, id);
      if (cur) return cur;
      await tx.put(INVOICES, id, rec);
      return rec;
    });
    return { data: { record: saved }, target: { type: "invoices", id, after: { status: saved.status, amount: saved.amount } } };
  }

  if (action === "invoices.update") {
    const id = idOf(p.id);
    const old = await store.get<InvoiceRecord>(INVOICES, id);
    if (!old || old.kind !== "invoice") throw new Error("开票记录不存在");
    if (old.revision !== p.revision) throw new Error("开票记录已在另一处修改，请刷新后重试");
    if (old.status === "void" || old.status === "red") throw new Error("已作废或红冲的发票不能再改");
    let next: InvoiceRecord = { ...old };
    if (p.amount !== undefined) next.amount = amountOf(p.amount);
    if (p.title !== undefined) next.title = typeof p.title === "string" ? Array.from(p.title.trim()).slice(0, 60).join("") : "";
    if (p.invoiceNo !== undefined) {
      const no = typeof p.invoiceNo === "string" ? p.invoiceNo.trim().replace(/\s+/g, "") : "";
      if (no && !/^[0-9A-Za-z-]{6,30}$/.test(no)) throw new Error("发票号码应为 6～30 位数字或字母");
      next.invoiceNo = no || undefined;
    }
    if (p.issuedOn !== undefined) {
      if (p.issuedOn && (typeof p.issuedOn !== "string" || !DATE.test(p.issuedOn))) throw new Error("开票日期无效");
      next.issuedOn = p.issuedOn || undefined;
    }
    if (p.sentTo !== undefined) next.sentTo = typeof p.sentTo === "string" && p.sentTo.trim() ? Array.from(p.sentTo.trim()).slice(0, 80).join("") : undefined;
    if (p.note !== undefined) next.note = typeof p.note === "string" && p.note.trim() ? Array.from(p.note.trim()).slice(0, 200).join("") : undefined;
    let dropped: string[] = [];
    if (p.files !== undefined) {
      const files = validateFiles(p.files, "invoice");
      checkNewFiles(files, old.files, actor, team);
      const keep = new Set(files.map((f) => f.fileID));
      dropped = (old.files || []).map((f) => f.fileID).filter((x) => !keep.has(x));
      next.files = files.length ? files : undefined;
    }
    const status: InvoiceStatus = p.status === undefined ? old.status : (INVOICE_STATUSES as readonly string[]).includes(p.status) ? p.status : (() => { throw new Error("状态无效"); })();
    if (status === "sent" && !next.sentOn) next.sentOn = today;
    if (status === "issued" && !next.issuedOn && p.issuedOn === undefined) next.issuedOn = today;
    checkStatus(status, next);
    next.status = status;
    next.updatedAt = time;
    next.updatedBy = actor.uid;
    next.revision = old.revision + 1;
    if (status !== old.status) next.statusAt = time;
    // 先建提醒、再写记录；离开待开票时先写记录、再标完成
    if (status === "pending" && old.status !== "pending") next = await schedule(next);
    const saved = await store.transaction(async (tx) => {
      await writable(tx);
      const cur = await tx.get<InvoiceRecord>(INVOICES, id);
      if (!cur || cur.revision !== old.revision) throw new Error("开票记录已在另一处修改，请刷新后重试");
      await tx.put(INVOICES, id, next);
      return next;
    });
    let final = saved;
    if (old.status === "pending" && status !== "pending") {
      final = await close(saved);
      if (final !== saved) await putRecord(final);
    }
    await removeFiles(team, dropped);
    return { data: { record: final }, target: { type: "invoices", id, before: { status: old.status, amount: old.amount }, after: { status: final.status, amount: final.amount } } };
  }

  // 读：列表 / 按销售查
  const docs = await allDocs(store);
  const profiles = new Map(docs.filter((d): d is InvoiceProfile => d.kind === "profile").map((d) => [d.customerId, d]));
  const complete = (cid: string) => profileComplete(profiles.get(cid));
  const records = docs.filter((d): d is InvoiceRecord => d.kind === "invoice");

  if (action === "invoices.forSales") {
    const ids: string[] = (Array.isArray(p.ids) ? p.ids : []).filter((x: unknown): x is string => typeof x === "string" && ID.test(x)).slice(0, 100);
    const want = new Set(ids);
    const out: Record<string, { id: string; status: InvoiceStatus; amount: number; revision: number; profileComplete: boolean }> = {};
    for (const r of records)
      if (want.has(r.saleId)) out[r.saleId] = { id: r.id, status: r.status, amount: r.amount, revision: r.revision, profileComplete: complete(r.customerId) };
    return { data: out };
  }

  // invoices.list
  const month = typeof p.month === "string" && /^\d{4}-\d{2}$/.test(p.month) ? p.month : today.slice(0, 7);
  const allMonths = p.month === "all";
  const status = typeof p.status === "string" && (INVOICE_STATUSES as readonly string[]).includes(p.status) ? (p.status as InvoiceStatus) : p.status === "open" ? "open" : null;
  const customerId = typeof p.customerId === "string" && ID.test(p.customerId) ? p.customerId : null;
  const order: Record<InvoiceStatus, number> = { awaiting_info: 0, pending: 1, issued: 2, sent: 3, void: 4, red: 5 };
  const items: InvoiceRow[] = records
    .filter((r) => allMonths || r.saleDate.slice(0, 7) === month || (r.issuedOn || "").slice(0, 7) === month || (OPEN_STATUSES.includes(r.status) && r.saleDate.slice(0, 7) < month))
    .filter((r) => !status || (status === "open" ? OPEN_STATUSES.includes(r.status) : r.status === status))
    .filter((r) => !customerId || r.customerId === customerId)
    .sort((a, b) => order[a.status] - order[b.status] || b.saleDate.localeCompare(a.saleDate) || a.id.localeCompare(b.id))
    .map((r) => ({ ...r, profileComplete: complete(r.customerId) }));
  const names = new Map<string, string>();
  for (const r of records) if (r.customerId) names.set(r.customerId, r.customerName);
  const result: InvoiceListResult = {
    items,
    stats: invoiceStats(records, complete, month),
    customers: [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    filesEnabled: filesOn,
  };
  return { data: result };
}
