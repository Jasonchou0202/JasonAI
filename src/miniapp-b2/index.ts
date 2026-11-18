/**
 * 小程序第 2 批（报销、开票、客户详情/合并、回收站、导出、成员、日志、4 张图）共用的计算和文案。
 * 打包成 miniprogram/pkg2/lib/b2.js（CommonJS），页面 require 后直接用；计算全部复用 src/domain，
 * 所以小程序和网页算出来的数一致。这里不读写任何数据，也不碰 wx API。
 */
import { money, parseYuan, totals } from "../domain/finance";
import { addDays, today } from "../domain/dates";
import {
  EXPENSE_START_DATE,
  EXPENSE_STATUS_LABEL,
  PROFIT_SHARE_BEFORE_HINT,
  PROFIT_SHARE_BEFORE_REFUND_HINT,
  PROFIT_SHARE_START_DATE,
  RECEIPT_KINDS,
  RECEIPT_KIND_LABEL,
  RECEIPT_MAX_FILES,
  deriveHasInvoice,
  formatCnDate,
  receiptMime,
  receiptSummary,
  selectableCategories,
  shareLabel,
  shiftMonth,
  type DecadeSettlement,
  type Expense,
  type ExpenseReceipt,
  type MonthCompare,
  type MonthSettlement,
} from "../domain/expenses";
import {
  FIELD_KEYS,
  FIELD_LABEL,
  INVOICE_FILE_MAX,
  INVOICE_FILE_MAX_BYTES,
  INVOICE_MIME,
  INVOICE_STATUS_LABEL,
  OPEN_STATUSES,
  invoiceFileMime,
  type InvoiceRow,
  type InvoiceStatus,
} from "../domain/invoices";
import { customerProducts, displayCustomerName } from "../domain/customers";
import { NEED_PRESETS, OCCUPATION_PRESETS, PAYMENT_METHODS, mergeOptions } from "../domain/profile";
import { NEW_RULE_TEXT, QUADRANTS, QUADRANT_INFO, pct, type Quadrant } from "../domain/insights";
import { OWNER_COLOR, memberColor } from "../domain/members";
import { renewLabel, renewName, renewRemindDate } from "../domain/renew";
import { treemap } from "../lib/treemap";
import { actionText, bjShort, diffText, targetText, type AuditRowLike } from "../lib/audit-text";
import type { Sale } from "../domain/model";

export { money, parseYuan, today, addDays, shiftMonth, displayCustomerName, formatCnDate, shareLabel, receiptSummary, deriveHasInvoice, selectableCategories, receiptMime, invoiceFileMime };
export { EXPENSE_START_DATE, PROFIT_SHARE_START_DATE, RECEIPT_KINDS, RECEIPT_KIND_LABEL, RECEIPT_MAX_FILES, INVOICE_FILE_MAX, INVOICE_FILE_MAX_BYTES, FIELD_KEYS, FIELD_LABEL };
export { renewName, renewLabel, renewRemindDate };
export { NEED_PRESETS, OCCUPATION_PRESETS, PAYMENT_METHODS, NEW_RULE_TEXT, QUADRANTS, QUADRANT_INFO };

/** 网页版地址（复制邀请链接用；公开地址，不是密钥） */
export const WEB_URL = "https://jasonchou0202.github.io/JasonAI/";
/** 小程序上传走云函数中转，单个不超过 4MB（和网页中转一致） */
export const RELAY_MAX_BYTES = 4 * 1024 * 1024;

export const yuan = (cents: number) => `¥${money(cents)}`;
export const monthLabel = (month: string) => `${month.slice(0, 4)} 年 ${Number(month.slice(5, 7))} 月`;
export const slashDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
/** 北京时间 yyyy-MM-dd HH:mm */
export const bjTime = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ");

/** 幂等请求号（只防重复提交，不是安全用途）：小程序没有 crypto.randomUUID */
export function requestId(random: () => number = Math.random): string {
  let s = "mp-" + Date.now().toString(36) + "-";
  for (let i = 0; i < 16; i++) s += Math.floor(random() * 16).toString(16);
  return s;
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* ───────────── 报销记账 ───────────── */
const SPLIT_FROM = formatCnDate(PROFIT_SHARE_START_DATE);
export interface SettlementPayload extends MonthSettlement {
  compare: MonthCompare[];
  details: (Expense & { payerName: string })[];
  people: { owner: { uid: string; name: string }; partner: { uid: string; name: string } };
  today: string;
  renewEnabled?: boolean;
}
const PHASE = { closed: "已出账", current: "进行中", upcoming: "待出账 · 示意" } as const;

function decadeView(row: DecadeSettlement) {
  const upcoming = row.phase === "upcoming";
  const n = (v: number) => (upcoming ? "—" : yuan(v));
  return {
    key: row.decade.from,
    label: row.decade.label,
    shortLabel: row.decade.shortLabel,
    phase: row.phase,
    phaseText: PHASE[row.phase],
    profitText: upcoming ? "尚未有数" : yuan(row.profit),
    overviewProfit: upcoming ? "—" : yuan(row.profit),
    upcoming,
    grid: [
      { k: "销售收入", v: n(row.revenue), sub: upcoming ? "" : "来自销售记录" },
      { k: "进货成本", v: n(row.cost), sub: "" },
      { k: "报销成本", v: n(row.expense), sub: "" },
      { k: "总成本", v: n(row.totalCost), sub: "" },
    ],
    splitTitle: row.sharesOpen ? "六四分账" : `分账 · ${SPLIT_FROM}前不分成`,
    ownerLine: `${row.owner.name} ${shareLabel(row.owner.share)}`,
    ownerAmount: n(row.owner.amount),
    partnerLine: `${row.partner.name} ${shareLabel(row.partner.share)}`,
    partnerAmount: n(row.partner.amount),
    ownerAdvanceLine: `${row.owner.name}垫付`,
    ownerAdvance: row.sharesOpen ? n(row.owner.advance) : upcoming ? n(0) : "不用退",
    partnerAdvanceLine: row.sharesOpen ? `${row.partner.name}垫付` : `${row.partner.name}垫付的报销`,
    partnerAdvance: n(row.partner.advance),
    receiveLine: row.sharesOpen || !upcoming ? `${row.partner.name}应收回 ${n(row.partnerReceive)}` : "",
    hint: upcoming ? "本段未出账，不做结算" : `${row.partner.name}应收回 ${yuan(row.partnerReceive)}`,
    hintSmall: !upcoming && !row.sharesOpen ? PROFIT_SHARE_BEFORE_REFUND_HINT : "",
    hintStrong: !upcoming,
  };
}

/** 利润对照柱：高度用 0–100 的百分比（有正数时至少 4%，看得见） */
export function compareBars(rows: MonthCompare[]) {
  const peak = Math.max(...rows.flatMap((r) => [r.salesProfit, r.profit]), 100);
  const h = (v: number) => Math.round(Math.max((Math.max(0, v) / peak) * 100, v > 0 ? 4 : 0) * 10) / 10;
  return rows.map((r) => ({ month: r.month, label: `${Number(r.month.slice(5, 7))}月`, sales: h(r.salesProfit), actual: h(r.profit), salesText: money(r.salesProfit), actualText: money(r.profit) }));
}

export function expensesView(data: SettlementPayload, admin: boolean, month: string) {
  const m = Number(month.slice(5, 7));
  const booked = data.details.filter((d) => d.status === "pending_reimburse" || d.status === "reimbursed");
  const pending = data.details.filter((d) => d.status === "pending_confirm");
  const postedFrom = data.decades.find((d) => d.phase !== "upcoming")?.decade.from;
  const postedTo = [...data.decades].reverse().find((d) => d.phase !== "upcoming")?.decade.to;
  const anyUpcoming = data.decades.some((d) => d.phase === "upcoming");
  const p = data.posted;
  const cur = data.compare.find((c) => c.month === month);
  return {
    title: monthLabel(month),
    lead: `十天合账。${SPLIT_FROM}起按${data.people.owner.name} 60%、${data.people.partner.name} 40% 分；之前${data.people.partner.name}为 0。`,
    decades: data.decades.map((d) => decadeView(d)),
    posted: {
      range: postedFrom && postedTo ? `${slashDate(postedFrom)}–${slashDate(postedTo)}` : "",
      metrics: [
        { k: "销售收入", v: yuan(p.revenue) },
        { k: "进货成本", v: yuan(p.cost) },
        { k: "报销成本", v: yuan(p.expense) },
        { k: "总成本", v: yuan(p.totalCost) },
        { k: "实际利润", v: yuan(p.profit) },
      ],
      splitTitle: p.partner.share === 0 ? `分账 · ${SPLIT_FROM}前不分成` : p.partner.share > 0 ? "六四分账" : "分账",
      ownerSplit: `${data.people.owner.name} ${shareLabel(p.owner.share)}　${yuan(p.owner.amount)}`,
      partnerSplit: `${data.people.partner.name} ${shareLabel(p.partner.share)}　${yuan(p.partner.amount)}`,
      receive: `${data.people.partner.name}应收回 ${yuan(p.partnerReceive)}`,
      receiveNote:
        (p.partner.share === 0
          ? `垫付的报销 ${yuan(p.partner.advance)} + 分成 ¥0 · ${PROFIT_SHARE_BEFORE_REFUND_HINT}`
          : `垫付 ${yuan(p.partner.advance)} + 四成利润 ${yuan(p.partner.amount)}${p.partner.share < 0 ? `（${SPLIT_FROM}起；此前只退垫付的报销）` : ""}`) +
        (anyUpcoming ? " · 未出账段未计入" : ""),
      profit: yuan(p.profit),
    },
    compare: compareBars(data.compare),
    compareLead: `近 ${data.compare.length} 个月对照。${month === data.today.slice(0, 7) && data.compare.some((c) => c.partial) ? `${m} 月只记已出账或进行中的段。` : ""}`,
    compareNote: `${m} 月${cur?.partial ? "按已记账的段合计" : "整月合计"}（只算销售 ${yuan(p.salesProfit)}，扣成本后 ${yuan(p.profit)}）${anyUpcoming ? "；未出账段未计入。" : "。"}`,
    detailLead: `已入账 ${booked.length} 笔，合计 ${yuan(booked.reduce((n, r) => n + r.amount, 0))}。${pending.length ? `待确认 ${pending.length} 笔尚未入账，不计入合账。` : ""}`,
    pendingCount: admin ? pending.length : 0,
    renewOn: !!data.renewEnabled,
    details: data.details.map((r) => ({
      id: r.id,
      revision: r.revision,
      date: slashDate(r.date),
      rawDate: r.date,
      category: r.categoryName,
      payer: r.payerName,
      amount: yuan(r.amount),
      receipt: receiptSummary(r),
      receiptCount: r.receipts?.length || 0,
      status: r.status,
      statusText: EXPENSE_STATUS_LABEL[r.status],
      note: r.note || "",
      renewText: r.renew ? `已设提醒 · ${Number(r.renew.date.slice(5, 7))}月${Number(r.renew.date.slice(8, 10))}日` : "",
      renewable: !r.renew && r.status !== "rejected",
      renewWhen: renewLabel(renewRemindDate(r.date)),
      own: true,
    })),
  };
}

/** 报销「待确认」列表一行 */
export function pendingRow(r: Expense & { payerName?: string }, people?: { owner: { uid: string; name: string }; partner: { uid: string; name: string } }) {
  const payer = r.payerName || (people ? (r.paidBy === people.partner.uid ? people.partner.name : people.owner.name) : "");
  return { id: r.id, revision: r.revision, date: slashDate(r.date), category: r.categoryName, payer, amount: yuan(r.amount), receipt: receiptSummary(r), receiptCount: r.receipts?.length || 0, note: r.note || "" };
}

/** 选好的凭证 → 能存进记录的凭证列表（类型按扩展名定；云端会按文件头再查一次） */
export function receiptEntry(file: { name: string; size: number }, kind: string) {
  const type = receiptMime(file.name, "");
  if (!type) return { error: `「${file.name}」不是 PDF 或图片（JPG、PNG、HEIC、WebP）` };
  if (file.size > RELAY_MAX_BYTES) return { error: `「${file.name}」超过 4MB，请压缩后再传` };
  return { error: "", type, kind: (RECEIPT_KINDS as readonly string[]).includes(kind) ? kind : "invoice" };
}
export type { ExpenseReceipt };

/* ───────────── 开票 ───────────── */
export const INVOICE_STATUS_CHOICES: InvoiceStatus[] = ["awaiting_info", "pending", "issued", "sent"];
export const INVOICE_STATUS_FILTERS = [{ id: "", label: "全部" }, { id: "open", label: "未开" }, ...INVOICE_STATUS_CHOICES.map((s) => ({ id: s, label: INVOICE_STATUS_LABEL[s] }))];
/** 四种状态配色（和网页 invoices.css 完全一致：灰、深红、浅绿、深绿） */
export const INVOICE_COLORS: Record<string, { fg: string; bg: string; line: string }> = {
  awaiting_info: { fg: "#5C5854", bg: "#EEEAE4", line: "#D8D3CC" },
  pending: { fg: "#9E2A1E", bg: "#F8DAD4", line: "#E8C0B8" },
  issued: { fg: "#1B6B40", bg: "#E3F6EA", line: "#C5E6D1" },
  sent: { fg: "#0B3D28", bg: "#A8D5B8", line: "#7EBE98" },
  void: { fg: "#5C5854", bg: "#EEEAE4", line: "#D8D3CC" },
  red: { fg: "#5C5854", bg: "#EEEAE4", line: "#D8D3CC" },
};
export const invoiceStatusLabel = (s: InvoiceStatus) => INVOICE_STATUS_LABEL[s] ?? "未知状态";
export function invoiceRow(r: InvoiceRow) {
  return {
    id: r.id,
    saleId: r.saleId,
    revision: r.revision,
    customerId: r.customerId,
    customer: r.customerName ? displayCustomerName(r.customerName) : "未填客户",
    product: r.productName,
    saleDate: slashDate(r.saleDate),
    amount: yuan(r.amount),
    status: r.status,
    statusText: invoiceStatusLabel(r.status),
    open: OPEN_STATUSES.includes(r.status),
    retired: r.status === "void" || r.status === "red",
    invoiceNo: r.invoiceNo || "",
    issuedOn: r.issuedOn || "",
    sentTo: r.sentTo || "",
    files: r.files?.length || 0,
    profileComplete: r.profileComplete,
    profileText: r.customerId ? (r.profileComplete ? "资料齐" : "缺资料") : "未对上客户",
  };
}
export function invoiceStatsView(s: { month: string; pending: { count: number; amount: number; awaiting: number }; issued: { count: number; amount: number }; missingCustomers: number }) {
  return [
    { k: "待开票", v: yuan(s.pending.amount), sub: `${s.pending.count} 笔${s.pending.awaiting ? ` · 其中待收资料 ${s.pending.awaiting}` : ""}`, tone: "pending" },
    { k: `${Number(s.month.slice(5, 7))} 月已开`, v: yuan(s.issued.amount), sub: `${s.issued.count} 笔`, tone: "issued" },
    { k: "缺资料客户", v: `${s.missingCustomers} 位`, sub: s.missingCustomers ? "补齐后才好开票" : "都齐了", tone: s.missingCustomers ? "warn" : "ok" },
  ];
}
/** 开票附件类型检查：发票原件只收 PDF 和图片 */
export function invoiceFileCheck(file: { name: string; size: number }, purpose: "invoice" | "profile") {
  const mime = invoiceFileMime(file.name);
  if (!mime || (purpose === "invoice" && !INVOICE_MIME.includes(mime)))
    return purpose === "invoice" ? "发票只支持 PDF 和图片（PNG、JPG）" : "只支持 PDF、Word、txt、PNG、JPG";
  if (file.size > INVOICE_FILE_MAX_BYTES) return "文件不能超过 4MB";
  return "";
}

/* ───────────── 客户详情 ───────────── */
export type SalesView = "month" | "recent" | "all";
export function inSalesView(view: SalesView, date: string, month: string, thisMonth: string) {
  const m = date.slice(0, 7);
  if (view === "all") return true;
  if (view === "recent") return m >= shiftMonth(thisMonth, -2) && m <= thisMonth;
  return m === month;
}
export function defaultSalesView(sales: { date: string }[], thisMonth: string): SalesView {
  if (sales.some((s) => inSalesView("month", s.date, thisMonth, thisMonth))) return "month";
  if (sales.some((s) => inSalesView("recent", s.date, thisMonth, thisMonth))) return "recent";
  return "all";
}
export function salesViewHint(view: SalesView) {
  return view === "recent" ? "本月暂无成交，已为你显示近 3 个月" : view === "all" ? "本月和近 3 个月暂无成交，已为你显示全部" : "";
}
export function customerDetailView(sales: Sale[], view: SalesView, month: string, thisMonth: string, limit = 20) {
  const rows = sales.filter((s) => inSalesView(view, s.date, month, thisMonth)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const t = totals(rows);
  const groups: { month: string; label: string; items: ReturnType<typeof saleLine>[] }[] = [];
  for (const s of rows.slice(0, limit)) {
    const key = s.date.slice(0, 7);
    if (groups[groups.length - 1]?.month !== key) groups.push({ month: key, label: monthLabel(key), items: [] });
    groups[groups.length - 1].items.push(saleLine(s));
  }
  return {
    period: view === "month" ? monthLabel(month) : view === "recent" ? `近 3 个月（${monthLabel(shiftMonth(thisMonth, -2))}至${monthLabel(thisMonth)}）` : "全部历史",
    totals: { revenue: yuan(t.revenue), cost: yuan(t.cost), profit: yuan(t.profit), count: t.count },
    products: customerProducts(rows).slice(0, 8).map((p) => ({ name: p.name, count: p.count, profit: yuan(p.profit) })),
    groups,
    remaining: Math.max(0, rows.length - limit),
    empty: rows.length === 0,
  };
}
function saleLine(s: Sale) {
  return { id: s.id, date: slashDate(s.date), product: s.productName, revenue: yuan(s.revenue), profit: yuan(s.revenue - s.cost), note: s.note || "", customerName: s.customer };
}
/** 合并候选：排除自己和已经并进别人的；按名字搜 */
export function mergeCandidates(customers: { id: string; name: string; mergedInto: string | null; archivedAt?: string | null }[], selfId: string, query: string) {
  const q = query.trim().toLocaleLowerCase();
  return customers
    .filter((c) => c.id !== selfId && !c.mergedInto && !c.archivedAt && !c.id.startsWith("expense_") && !c.id.startsWith("invoice_"))
    .filter((c) => !q || c.name.toLocaleLowerCase().includes(q))
    .slice(0, 30)
    .map((c) => ({ id: c.id, name: displayCustomerName(c.name) }));
}
export function profileOptions(used: { occupation?: string; needs?: string[] }[]) {
  return {
    occupations: mergeOptions(OCCUPATION_PRESETS, used.map((p) => p.occupation ?? "")),
    needs: mergeOptions(NEED_PRESETS, used.flatMap((p) => p.needs ?? [])),
    payments: [...PAYMENT_METHODS],
  };
}

/* ───────────── 回收站 ───────────── */
export function trashSale(s: Sale) {
  return { id: s.id, revision: s.revision, title: s.productName, sub: `${displayCustomerName(s.customer || "未填客户")} · ${s.date}`, amount: yuan(s.revenue), deletedAt: s.deletedAt ? bjTime(s.deletedAt) : "" };
}
export function trashTask(t: { id: string; revision: number; title: string; at: string; deletedAt: string | null; customerId: string }, customerName: (id: string) => string) {
  return { id: t.id, revision: t.revision, title: t.title, sub: `${customerName(t.customerId)} · ${bjTime(t.at)}`, amount: "", deletedAt: t.deletedAt ? bjTime(t.deletedAt) : "" };
}
export function trashExpense(r: Expense) {
  return { id: r.id, revision: r.revision, title: r.categoryName, sub: `${r.date} · ${receiptSummary(r)}`, amount: yuan(r.amount), deletedAt: r.deletedAt ? bjTime(r.deletedAt) : "" };
}

/* ───────────── 成员 ───────────── */
const MEMBER_STATUS = { pending: "待批准", active: "使用中", disabled: "已停用" } as const;
export function membersView(
  members: { uid: string; name: string; status: "pending" | "active" | "disabled"; createdAt: string; color?: string; inviteId?: string }[],
  ownerUid: string,
  colorsOn: boolean,
) {
  const colorOf = (uid: string) => members.find((m) => m.uid === uid)?.color;
  return {
    needFill: colorsOn && members.some((m) => m.status !== "pending" && !m.color),
    owner: { name: "管理员（你）", color: OWNER_COLOR.dot, colorName: `${OWNER_COLOR.name}（固定）` },
    rows: members.map((m) => {
      const c = memberColor(m.uid, ownerUid, colorOf);
      const same = m.color ? members.filter((o) => o.uid !== m.uid && o.color === m.color).map((o) => o.name) : [];
      return {
        uid: m.uid,
        name: m.name,
        status: m.status,
        statusText: MEMBER_STATUS[m.status],
        joined: bjTime(m.createdAt),
        miniapp: m.inviteId === "miniapp" || m.uid.startsWith("wx_"),
        color: m.status === "pending" ? "" : c.dot,
        colorName: m.status === "pending" ? "批准后分色" : c.name,
        sameColor: same.length ? `和${same.join("、")}同色，靠名字区分` : "",
      };
    }),
  };
}
export const inviteLink = (code: string) => `${WEB_URL}#/join?code=${encodeURIComponent(code)}`;

/* ───────────── 操作日志 ───────────── */
export interface AuditRow extends AuditRowLike {
  id?: string;
  at: string;
  actorUid: string;
  actorName?: string;
  role?: string;
  result: string;
  reason?: string;
}
/** 网页 audit-text 还没收录的报销、开票动作（只在小程序这边补中文，不改网页） */
const EXTRA_ACTION_TEXT: Record<string, string> = {
  "expenses.create": "记一笔报销",
  "expenses.update": "修改报销",
  "expenses.delete": "删除报销",
  "expenses.restore": "恢复报销",
  "expenses.purge": "彻底删除报销",
  "expenses.confirm": "确认报销",
  "expenses.reject": "驳回报销",
  "expenses.categories.create": "新增报销分类",
  "expenses.categories.archive": "停用报销分类",
  "invoices.profile.save": "保存开票资料",
  "invoices.toggle": "切换要不要开票",
  "invoices.update": "更新开票状态",
};
export const auditActionText = (r: AuditRowLike) => {
  const t = actionText(r);
  return t === r.action ? EXTRA_ACTION_TEXT[r.action] ?? t : t;
};
export function auditView(rows: AuditRow[], person: (uid: string) => string, customer: (id: string) => string | undefined) {
  const n = { person, customer };
  return rows.map((r, i) => ({
    key: r.id || `${r.at}-${i}`,
    // 网页用「—」占位；小程序里没有对象就不显示这一行
    at: bjShort(r.at),
    who: r.actorName || person(r.actorUid) || "不详",
    action: auditActionText(r),
    target: targetText(r, n) === "—" ? "" : targetText(r, n),
    diff: diffText(r, n).join("；"),
    result: r.result,
    resultText: r.result === "ok" ? "" : r.result === "denied" ? "被拒" : "失败",
    via: r.after && (r.after as Record<string, unknown>).via === "miniapp" ? "小程序" : "",
  }));
}
export const AUDIT_RANGES = [
  { id: "", label: "全部", back: -1 },
  { id: "1", label: "今天", back: 0 },
  { id: "7", label: "近 7 天", back: 6 },
  { id: "30", label: "近 30 天", back: 29 },
];

/* ───────────── 4 张图 ───────────── */
/** 每月新增客户折线：画布坐标（Canvas 2D 直接用） */
export function lineChart(rows: { month: string; count: number }[], W: number, H: number, P = 28) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  const x = (i: number) => P + (rows.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (rows.length - 1));
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  return { baseline: H - P, points: rows.map((r, i) => ({ x: x(i), y: y(r.count), label: `${Number(r.month.slice(5))}月`, value: r.count })) };
}
export function quadMonthsView(rows: { month: string; active: number; counts: Record<Quadrant, number> }[], end: number, windowSize = 3) {
  const last = Math.max(rows.length - 1, 0);
  const at = Math.min(Math.max(end, 0), last);
  const shown = rows.slice(Math.max(0, at - windowSize + 1), at + 1);
  return {
    last,
    at,
    minEnd: Math.min(windowSize - 1, last),
    range: shown.length ? `${shown[0].month.replace("-", ".")} – ${shown[shown.length - 1].month.replace("-", ".")}` : "",
    months: shown.map((r) => ({
      month: r.month.replace("-", "."),
      active: r.active,
      cells: treemap(QUADRANTS.map((q) => ({ item: q, value: r.counts[q] }))).map((c) => ({
        q: c.item,
        x: c.x, y: c.y, w: c.w, h: c.h,
        color: QUADRANT_INFO[c.item].color,
        short: QUADRANT_INFO[c.item].short,
        value: c.value,
        pct: pct(c.value, r.active),
        tiny: c.w < 22 || c.h < 22,
      })),
      nums: QUADRANTS.map((q) => ({ q, text: `${QUADRANT_INFO[q].short} ${r.counts[q]}位 · ${pct(r.counts[q], r.active)}%`, color: r.counts[q] ? QUADRANT_INFO[q].color : "", zero: !r.counts[q] })),
    })),
  };
}
/** 四象限：上排新客户，下排老客户；左列老产品，右列新产品（和网页一致） */
const GRID: Quadrant[] = ["newOld", "newNew", "oldOld", "oldNew"];
export function matrixView(t: Record<Quadrant, { count: number; revenue: number; profit: number }>) {
  return GRID.map((q) => ({ q, label: QUADRANT_INFO[q].label, color: QUADRANT_INFO[q].color, on: t[q].count > 0, count: `${t[q].count} 笔`, revenue: `销售额 ${yuan(t[q].revenue)}`, profit: `纯利 ${yuan(t[q].profit)}` }));
}
export function decadeShareTitle(row: DecadeSettlement) {
  const m = Number(row.decade.from.slice(5, 7));
  return row.decade.index === 0 ? `${m}月 1–10 日` : row.decade.index === 1 ? `${m}月 11–20 日` : `${m}月 21–月末`;
}
export function decadeSharesView(items: DecadeSettlement[]) {
  return items.map((row) => {
    const upcoming = row.phase === "upcoming";
    return {
      key: row.decade.from,
      title: decadeShareTitle(row),
      phase: row.phase,
      phaseText: PHASE[row.phase],
      ownerLine: `${row.owner.name} ${shareLabel(row.owner.share)}`,
      owner: upcoming ? "—" : yuan(row.owner.amount),
      partnerLine: `${row.partner.name} ${shareLabel(row.partner.share)}`,
      partner: upcoming ? "—" : yuan(row.partner.amount),
      advance: !row.sharesOpen && !upcoming && row.partner.advance > 0 ? { line: `另退${row.partner.name}垫付的报销`, v: yuan(row.partner.advance) } : null,
      wait: row.sharesOpen ? "" : `${formatCnDate(PROFIT_SHARE_START_DATE)}前不分成`,
    };
  });
}
export const DECADE_SHARES_DESC = `当前段与后两段。${formatCnDate(PROFIT_SHARE_START_DATE)}起六四分，之前周诗懿为 0；${formatCnDate(EXPENSE_START_DATE)}起垫付的报销照退。`;

/** 开票金额：可带两位小数（和网页 parseInvoiceAmount 一致） */
export function parseInvoiceAmount(text: string): number {
  const s = String(text ?? "").trim().replace(/^[¥￥]\s*/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error("开票金额填数字，最多两位小数");
  const cents = Math.round(Number(s) * 100);
  if (cents <= 0) throw new Error("开票金额要大于 0");
  return cents;
}
export const invoiceAmountInput = (cents: number) => (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100));
export const ISSUED_LIKE = (s: string) => s === "issued" || s === "sent" || s === "void" || s === "red";
/** 编辑页的状态步骤：常用四态；历史作废/红冲只读显示 */
export function invoiceSteps(current: InvoiceStatus) {
  const list: InvoiceStatus[] = current === "void" || current === "red" ? [...INVOICE_STATUS_CHOICES, current] : INVOICE_STATUS_CHOICES;
  return list.map((s) => ({ id: s, label: invoiceStatusLabel(s), color: INVOICE_COLORS[s] }));
}
