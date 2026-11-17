/**
 * 普票开票管理（INVOICE_ENABLED=1）：缺省关。
 * - 独立集合 invoices：客户开票资料（prof_…，每个客户一套）+ 每笔销售的开票记录（inv_…）。
 * - 不改 sales、customers 集合：开关关着时手账与现在一字不差。
 * - 附件只存原件（不识别内容），复用报销凭证那套私有云存储，路径 invoices/<上传人>/…
 */
import { addDays } from "./dates";

export const INVOICE_TYPE = "vat_normal" as const;
export const INVOICE_TYPE_LABEL = "增值税普通发票";

export type InvoiceStatus = "awaiting_info" | "pending" | "issued" | "sent" | "void" | "red";
export const INVOICE_STATUSES: readonly InvoiceStatus[] = ["awaiting_info", "pending", "issued", "sent", "void", "red"];
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  awaiting_info: "待收资料",
  pending: "待开票",
  issued: "已开票",
  sent: "已寄出",
  void: "已作废",
  red: "已红冲",
};
/** 还没开出来的（可以关掉「需要开票」） */
export const OPEN_STATUSES: readonly InvoiceStatus[] = ["awaiting_info", "pending"];
/** 已开出（需要发票号码和开票日期） */
export const ISSUED_STATUSES: readonly InvoiceStatus[] = ["issued", "sent", "void", "red"];

/** 待开票超过几天没动就提醒 */
export const INVOICE_REMIND_DAYS = 3;
export const INVOICE_REMIND_TIME = "10:00";
/** 销售没对上客户时，提醒挂在这个固定客户下（第一次需要时才建） */
export const INVOICE_CUSTOMER_ID = "invoice_remind";
export const INVOICE_CUSTOMER_NAME = "🧾开票提醒";

export const INVOICE_FILE_MAX_BYTES = 4 * 1024 * 1024;
export const INVOICE_FILE_MAX = 6;
export const INVOICE_TEXT_MAX = 2000;
export const INVOICE_FIELD_MAX = 120;

export const PROFILE_MIME = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "image/png",
  "image/jpeg",
] as const;
export type ProfileMime = (typeof PROFILE_MIME)[number];
/** 发票原件只收 PDF 和图片 */
export const INVOICE_MIME: readonly ProfileMime[] = ["application/pdf", "image/png", "image/jpeg"];
export const INVOICE_MIME_EXT: Record<ProfileMime, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "image/png": "png",
  "image/jpeg": "jpg",
};
const EXT_MIME: Record<string, ProfileMime> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};
export const PROFILE_ACCEPT = ".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg";
export const INVOICE_ACCEPT = ".pdf,.png,.jpg,.jpeg";

/** 按扩展名定类型（浏览器给的 type 常常为空或不准，以扩展名为准） */
export function invoiceFileMime(name: string): ProfileMime | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? null;
}

export type InvoiceFilePurpose = "profile" | "invoice";
export interface InvoiceFile {
  fileID: string;
  name: string;
  type: ProfileMime;
  size: number;
}

export interface InvoiceFields {
  /** 抬头 */
  title?: string;
  /** 税号 */
  taxNo?: string;
  /** 地址电话 */
  addressPhone?: string;
  /** 开户行及账号 */
  bankAccount?: string;
  /** 收票邮箱 */
  email?: string;
}
export const FIELD_KEYS = ["title", "taxNo", "addressPhone", "bankAccount", "email"] as const;
export const FIELD_LABEL: Record<(typeof FIELD_KEYS)[number], string> = {
  title: "抬头",
  taxNo: "税号",
  addressPhone: "地址电话",
  bankAccount: "开户行账号",
  email: "收票邮箱",
};

export interface InvoiceProfile {
  kind: "profile";
  id: string;
  customerId: string;
  /** 直接粘贴的开票资料原文 */
  text: string;
  fields: InvoiceFields;
  files: InvoiceFile[];
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
  revision: number;
}

export interface InvoiceRemind {
  taskId: string;
  at: string;
  /** 日程归属人（把这笔设成「需要开票」的人） */
  by: string;
  /** 进入「待开票」的时刻；换一轮就换一条日程 */
  since: string;
  /** 离开「待开票」时已把日程标完成 */
  doneAt?: string;
}

export interface InvoiceRecord {
  kind: "invoice";
  id: string;
  saleId: string;
  /** 客户（合并后的根客户；没对上客户时为空） */
  customerId: string;
  customerName: string;
  productName: string;
  saleDate: string;
  /** 这笔销售额（分，打开开票时的快照） */
  saleRevenue: number;
  /** 开票金额（分） */
  amount: number;
  type: typeof INVOICE_TYPE;
  status: InvoiceStatus;
  /** 抬头快照（打开时自动带上客户资料里的抬头） */
  title: string;
  invoiceNo?: string;
  /** 开票日期 yyyy-MM-dd */
  issuedOn?: string;
  /** 寄送去向：邮箱或快递单号 */
  sentTo?: string;
  sentOn?: string;
  files?: InvoiceFile[];
  note?: string;
  /** 最近一次改状态的时刻（「多久没动」从这里算） */
  statusAt: string;
  remind?: InvoiceRemind;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy?: string;
  revision: number;
}

export type InvoiceDoc = InvoiceProfile | InvoiceRecord;

export const profileId = (customerId: string) => `prof_${customerId}`.slice(0, 128);
export const invoiceId = (saleId: string) => `inv_${saleId}`.slice(0, 128);

/** 资料齐：抬头+税号都填了，或贴了原文 / 传了文件（原件不识别，由人核对） */
export function profileComplete(p: Pick<InvoiceProfile, "text" | "fields" | "files"> | null | undefined): boolean {
  if (!p) return false;
  const f = p.fields || {};
  return !!(f.title?.trim() && f.taxNo?.trim()) || !!p.text?.trim() || (p.files?.length ?? 0) > 0;
}

/** 抬头：结构化字段优先，没有就取原文第一行 */
export function profileTitle(p: Pick<InvoiceProfile, "text" | "fields"> | null | undefined): string {
  if (!p) return "";
  const t = p.fields?.title?.trim();
  if (t) return t;
  const line = (p.text || "").split(/\r?\n/).map((s) => s.trim()).find(Boolean) || "";
  return Array.from(line.replace(/^(名称|抬头|发票抬头)\s*[:：]\s*/, "")).slice(0, 60).join("");
}

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? Array.from(v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim()).slice(0, max).join("") : "";
}

export function validateFields(raw: unknown): InvoiceFields {
  if (raw !== undefined && raw !== null && (typeof raw !== "object" || Array.isArray(raw))) throw new Error("开票信息格式无效");
  const r = (raw || {}) as Record<string, unknown>;
  const out: InvoiceFields = {};
  for (const k of FIELD_KEYS) {
    const v = clean(r[k], INVOICE_FIELD_MAX);
    if (v) out[k] = k === "taxNo" ? v.toUpperCase().replace(/\s+/g, "") : v;
  }
  if (out.taxNo && !/^[0-9A-Z]{15,20}$/.test(out.taxNo)) throw new Error("税号应为 15～20 位数字或大写字母");
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new Error("收票邮箱格式不对");
  return out;
}

export function validateText(raw: unknown): string {
  if (raw !== undefined && raw !== null && typeof raw !== "string") throw new Error("开票信息格式无效");
  const s = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim() : "";
  if (Array.from(s).length > INVOICE_TEXT_MAX) throw new Error(`粘贴的开票信息最多 ${INVOICE_TEXT_MAX} 字`);
  return s;
}

export function validateFiles(raw: unknown, purpose: InvoiceFilePurpose): InvoiceFile[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error("附件格式无效");
  if (raw.length > INVOICE_FILE_MAX) throw new Error(`附件最多 ${INVOICE_FILE_MAX} 个`);
  const allowed = purpose === "invoice" ? INVOICE_MIME : PROFILE_MIME;
  return raw.map((r) => {
    if (!r || typeof r !== "object") throw new Error("附件格式无效");
    const f = r as Record<string, unknown>;
    if (typeof f.fileID !== "string" || !f.fileID || f.fileID.length > 512) throw new Error("附件格式无效");
    if (!(allowed as readonly string[]).includes(f.type as string)) throw new Error(purpose === "invoice" ? "发票只支持 PDF 和图片" : "附件类型不支持");
    if (!Number.isSafeInteger(f.size) || (f.size as number) <= 0 || (f.size as number) > INVOICE_FILE_MAX_BYTES) throw new Error("附件单个不能超过 4MB");
    return { fileID: f.fileID, name: clean(f.name, 120) || "附件", type: f.type as ProfileMime, size: f.size as number };
  });
}

/** 上传人：invoices/<uid>/… */
export function invoiceUploader(fileID: string): string | null {
  const m = /(?:^|\/)invoices\/([\w-]+)\/[\w.-]+$/.exec(fileID);
  return m ? m[1] : null;
}

/** 提醒日：进入待开票的北京日期 + 3 天，上午 10:00 */
export function invoiceRemindDate(sinceIso: string): string {
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(sinceIso));
  return addDays(day, INVOICE_REMIND_DAYS);
}
export function invoiceRemindAt(sinceIso: string): string {
  return new Date(`${invoiceRemindDate(sinceIso)}T${INVOICE_REMIND_TIME}:00+08:00`).toISOString();
}
export function invoiceRemindTitle(customerName: string): string {
  const name = Array.from(customerName.trim() || "客户").slice(0, 20).join("");
  return `给${name}开普票（待开票 ${INVOICE_REMIND_DAYS} 天）`;
}

/** 某状态需要的字段是否齐 */
export function checkStatus(status: InvoiceStatus, r: Pick<InvoiceRecord, "invoiceNo" | "issuedOn">) {
  if (ISSUED_STATUSES.includes(status)) {
    if (!r.invoiceNo) throw new Error("请先填发票号码");
    if (!r.issuedOn) throw new Error("请先填开票日期");
  }
}

export interface InvoiceStats {
  month: string;
  pending: { count: number; amount: number; awaiting: number };
  issued: { count: number; amount: number };
  missingCustomers: number;
}

export function invoiceStats(rows: InvoiceRecord[], complete: (customerId: string) => boolean, month: string): InvoiceStats {
  const open = rows.filter((r) => OPEN_STATUSES.includes(r.status));
  // 待开票按积压算：本月及以前还没开的都算
  const pending = open.filter((r) => r.saleDate.slice(0, 7) <= month);
  const issued = rows.filter((r) => (r.status === "issued" || r.status === "sent") && (r.issuedOn || "").slice(0, 7) === month);
  const missing = new Set(open.filter((r) => !r.customerId || !complete(r.customerId)).map((r) => r.customerId || "name:" + r.customerName));
  return {
    month,
    pending: { count: pending.length, amount: pending.reduce((s, r) => s + r.amount, 0), awaiting: pending.filter((r) => r.status === "awaiting_info").length },
    issued: { count: issued.length, amount: issued.reduce((s, r) => s + r.amount, 0) },
    missingCustomers: missing.size,
  };
}

/** 网页上用的一行（含客户资料齐不齐） */
export interface InvoiceRow extends InvoiceRecord {
  profileComplete: boolean;
}
export interface InvoiceListResult {
  items: InvoiceRow[];
  stats: InvoiceStats;
  customers: { id: string; name: string }[];
  filesEnabled: boolean;
}
export interface InvoiceProfileView {
  customerId: string;
  profile: InvoiceProfile | null;
  complete: boolean;
  title: string;
  filesEnabled: boolean;
  open: number;
}
