import { addDays, validDate } from "./dates";
import type { Sale } from "./model";

/** 报销状态：待确认、已驳回、待报销、已报销 */
export type ExpenseStatus =
  | "pending_confirm"
  | "rejected"
  | "pending_reimburse"
  | "reimbursed";

export const BOOKED_STATUSES: readonly ExpenseStatus[] = [
  "pending_reimburse",
  "reimbursed",
];

export const EXPENSE_STATUS_LABEL: Record<ExpenseStatus, string> = {
  pending_confirm: "待确认",
  rejected: "已驳回",
  pending_reimburse: "待报销",
  reimbursed: "已报销",
};

export const DEFAULT_CATEGORIES: { id: string; name: string; hint?: string }[] = [
  { id: "cat-hardware", name: "硬件设备" },
  { id: "cat-phone", name: "话费" },
  { id: "cat-transport", name: "交通" },
  { id: "cat-office", name: "办公" },
  { id: "cat-software", name: "软件订阅", hint: "ChatGPT / Claude / Grok Bot" },
  { id: "cat-other", name: "其他" },
];

export const OWNER_SHARE = 0.6;
export const PARTNER_SHARE = 0.4;
export const OWNER_LABEL = "章鱼哥";
export const PARTNER_LABEL = "周诗懿";

export interface ExpenseCategory {
  id: string;
  name: string;
  hint?: string;
  preset?: boolean;
  createdAt: string;
  archivedAt?: string | null;
}

export interface ExpenseInput {
  date: string;
  amount: number;
  categoryId: string;
  categoryName: string;
  paidBy: string;
  hasInvoice: boolean;
  note: string;
  status: ExpenseStatus;
}

export interface Expense extends ExpenseInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  revision: number;
  lastMutation?: string;
  createdBy?: string;
  updatedBy?: string;
  deletedBy?: string;
  confirmedBy?: string;
  confirmedAt?: string;
}

export interface ExpenseSettings {
  partnerUid: string;
  partnerName: string;
  categories: ExpenseCategory[];
}

export interface Decade {
  month: string;
  index: 0 | 1 | 2;
  from: string;
  to: string;
  label: string;
  shortLabel: string;
}

export type DecadePhase = "closed" | "current" | "upcoming";

export interface PayerShare {
  uid: string;
  name: string;
  share: number;
  amount: number;
  advance: number;
}

export interface DecadeSettlement {
  decade: Decade;
  phase: DecadePhase;
  revenue: number;
  cost: number;
  expense: number;
  totalCost: number;
  salesProfit: number;
  profit: number;
  owner: PayerShare;
  partner: PayerShare;
  partnerReceive: number;
}

export interface MonthSettlement {
  month: string;
  decades: DecadeSettlement[];
  /** 已出账 + 进行中的段合计；未出账段不计入 */
  posted: DecadeSettlement;
  pendingCount: number;
}

export interface MonthCompare {
  month: string;
  salesProfit: number;
  profit: number;
  /** 进行中的月份只计到已出账/进行中的段 */
  partial: boolean;
}

export interface ExpenseMeta {
  owner: { uid: string; name: string };
  partner: { uid: string; name: string };
  categories: ExpenseCategory[];
  salesPayerEnabled: boolean;
}

const SETTINGS_KEYS = new Set(["id", "_categories", "_settings"]);
export const isExpenseRecord = (row: { id?: string } | null | undefined) =>
  !!row && typeof row.id === "string" && !SETTINGS_KEYS.has(row.id) && !row.id.startsWith("_");

export function monthEnd(month: string): string {
  const from = `${month}-01`;
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return addDays(d.toISOString().slice(0, 10), -1);
}

export function monthDays(month: string): number {
  return Number(monthEnd(month).slice(8));
}

export function decadesOf(month: string): Decade[] {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("月份无效");
  const end = monthEnd(month);
  const last = Number(end.slice(8));
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const range = (index: 0 | 1 | 2, start: number, stop: number): Decade => {
    const from = `${month}-${String(start).padStart(2, "0")}`;
    const to = `${month}-${String(stop).padStart(2, "0")}`;
    return {
      month,
      index,
      from,
      to,
      label:
        index === 0
          ? `${m}月 1–10 日`
          : index === 1
            ? `${m}月 11–20 日`
            : `${m}月 21–${last} 日`,
      shortLabel:
        index === 0 ? "1–10 日" : index === 1 ? "11–20 日" : "21–月末",
    };
  };
  void y;
  return [
    range(0, 1, Math.min(10, last)),
    range(1, 11, Math.min(20, last)),
    range(2, 21, last),
  ];
}

export function decadeOf(date: string): Decade {
  if (!validDate(date)) throw new Error("日期无效");
  const month = date.slice(0, 7);
  const day = Number(date.slice(8));
  const list = decadesOf(month);
  return list[day <= 10 ? 0 : day <= 20 ? 1 : 2];
}

export function decadePhase(decade: Decade, today: string): DecadePhase {
  if (today < decade.from) return "upcoming";
  if (today > decade.to) return "closed";
  return "current";
}

/** 当前段 + 后面两段（可跨月） */
export function upcomingDecades(today: string, count = 3): Decade[] {
  if (!validDate(today)) throw new Error("日期无效");
  const out: Decade[] = [];
  let month = today.slice(0, 7);
  let list = decadesOf(month);
  let i = list.findIndex((d) => today >= d.from && today <= d.to);
  if (i < 0) i = 0;
  while (out.length < count) {
    if (i >= list.length) {
      const [y, m] = month.split("-").map(Number);
      const next = new Date(Date.UTC(y, m, 1)); // month is 1-based here after +1 via Date.UTC(y, m, 1)
      month = next.toISOString().slice(0, 7);
      list = decadesOf(month);
      i = 0;
    }
    out.push(list[i]);
    i += 1;
  }
  return out;
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export function isBookedStatus(status: ExpenseStatus): boolean {
  return BOOKED_STATUSES.includes(status);
}

/** 进货付款人：开关开且有 paidBy 才用 paidBy，否则按录入人；旧数据没有录入人视为管理员 */
export function salePayer(
  sale: Pick<Sale, "createdBy" | "paidBy">,
  ownerUid: string,
  payerEnabled: boolean,
): string {
  if (payerEnabled && sale.paidBy) return sale.paidBy;
  return sale.createdBy || ownerUid;
}

export function splitProfit(profit: number): { owner: number; partner: number } {
  const owner = Math.round(profit * OWNER_SHARE);
  return { owner, partner: profit - owner };
}

export interface People {
  ownerUid: string;
  ownerName?: string;
  partnerUid: string;
  partnerName?: string;
}

function payerShare(
  uid: string,
  name: string,
  share: number,
  profitPart: number,
  advance: number,
): PayerShare {
  return { uid, name, share, amount: profitPart, advance };
}

const emptyPosted = (month: string, people: People): DecadeSettlement => {
  const decade: Decade = {
    month,
    index: 0,
    from: `${month}-01`,
    to: `${month}-01`,
    label: "",
    shortLabel: "已出账合计",
  };
  const zero = splitProfit(0);
  return {
    decade,
    phase: "closed",
    revenue: 0,
    cost: 0,
    expense: 0,
    totalCost: 0,
    salesProfit: 0,
    profit: 0,
    owner: payerShare(people.ownerUid, people.ownerName || OWNER_LABEL, OWNER_SHARE, zero.owner, 0),
    partner: payerShare(people.partnerUid, people.partnerName || PARTNER_LABEL, PARTNER_SHARE, zero.partner, 0),
    partnerReceive: 0,
  };
};

export function settleDecade(
  decade: Decade,
  today: string,
  sales: Sale[],
  expenses: Expense[],
  people: People,
  payerEnabled: boolean,
): DecadeSettlement {
  const phase = decadePhase(decade, today);
  const ownerName = people.ownerName || OWNER_LABEL;
  const partnerName = people.partnerName || PARTNER_LABEL;
  if (phase === "upcoming") {
    const zero = splitProfit(0);
    return {
      decade,
      phase,
      revenue: 0,
      cost: 0,
      expense: 0,
      totalCost: 0,
      salesProfit: 0,
      profit: 0,
      owner: payerShare(people.ownerUid, ownerName, OWNER_SHARE, zero.owner, 0),
      partner: payerShare(people.partnerUid, partnerName, PARTNER_SHARE, zero.partner, 0),
      partnerReceive: 0,
    };
  }
  const inRange = (date: string) => date >= decade.from && date <= decade.to;
  const activeSales = sales.filter((s) => !s.deletedAt && inRange(s.date));
  const booked = expenses.filter(
    (e) => !e.deletedAt && inRange(e.date) && isBookedStatus(e.status),
  );
  const revenue = activeSales.reduce((n, s) => n + s.revenue, 0);
  const cost = activeSales.reduce((n, s) => n + s.cost, 0);
  const expense = booked.reduce((n, e) => n + e.amount, 0);
  const totalCost = cost + expense;
  const salesProfit = revenue - cost;
  const profit = revenue - totalCost;
  const parts = splitProfit(profit);
  const advances: Record<string, number> = {};
  const add = (uid: string, n: number) => {
    advances[uid] = (advances[uid] || 0) + n;
  };
  for (const s of activeSales) add(salePayer(s, people.ownerUid, payerEnabled), s.cost);
  for (const e of booked) add(e.paidBy || people.ownerUid, e.amount);
  const ownerAdvance = advances[people.ownerUid] || 0;
  const partnerAdvance = advances[people.partnerUid] || 0;
  return {
    decade,
    phase,
    revenue,
    cost,
    expense,
    totalCost,
    salesProfit,
    profit,
    owner: payerShare(people.ownerUid, ownerName, OWNER_SHARE, parts.owner, ownerAdvance),
    partner: payerShare(people.partnerUid, partnerName, PARTNER_SHARE, parts.partner, partnerAdvance),
    partnerReceive: partnerAdvance + parts.partner,
  };
}

export function settleMonth(
  month: string,
  today: string,
  sales: Sale[],
  expenses: Expense[],
  people: People,
  payerEnabled: boolean,
): MonthSettlement {
  const decades = decadesOf(month).map((d) =>
    settleDecade(d, today, sales, expenses, people, payerEnabled),
  );
  const posted = emptyPosted(month, people);
  for (const row of decades) {
    if (row.phase === "upcoming") continue;
    posted.revenue += row.revenue;
    posted.cost += row.cost;
    posted.expense += row.expense;
    posted.totalCost += row.totalCost;
    posted.salesProfit += row.salesProfit;
    posted.profit += row.profit;
    posted.owner.advance += row.owner.advance;
    posted.partner.advance += row.partner.advance;
    posted.owner.amount += row.owner.amount;
    posted.partner.amount += row.partner.amount;
    posted.partnerReceive += row.partnerReceive;
  }
  const pendingCount = expenses.filter(
    (e) =>
      !e.deletedAt &&
      e.date.startsWith(month) &&
      e.status === "pending_confirm",
  ).length;
  return { month, decades, posted, pendingCount };
}

export function compareMonths(
  today: string,
  sales: Sale[],
  expenses: Expense[],
  people: People,
  payerEnabled: boolean,
  count = 5,
): MonthCompare[] {
  const current = today.slice(0, 7);
  return Array.from({ length: count }, (_, i) => {
    const month = shiftMonth(current, i - count + 1);
    const settled = settleMonth(month, today, sales, expenses, people, payerEnabled);
    const partial = month === current && settled.decades.some((d) => d.phase === "upcoming");
    return {
      month,
      salesProfit: settled.posted.salesProfit,
      profit: settled.posted.profit,
      partial,
    };
  });
}

const NAME_MAX = 40;
const NOTE_MAX = 2000;

export function validateExpense(raw: ExpenseInput, categories: ExpenseCategory[]): ExpenseInput {
  if (!raw || typeof raw !== "object") throw new Error("记录格式无效");
  if (!validDate(raw.date)) throw new Error("请选择有效日期");
  if (!Number.isSafeInteger(raw.amount) || raw.amount <= 0 || raw.amount > 999_999_999_99)
    throw new Error("请填写有效金额");
  if (typeof raw.categoryId !== "string" || raw.categoryId.length > 200)
    throw new Error("请选择分类");
  const cat = categories.find((c) => c.id === raw.categoryId && !c.archivedAt);
  if (!cat) throw new Error("请选择分类");
  if (typeof raw.paidBy !== "string" || !raw.paidBy || raw.paidBy.length > 128 || !/^[\w-]+$/.test(raw.paidBy))
    throw new Error("请选择谁出的钱");
  if (typeof raw.hasInvoice !== "boolean") throw new Error("请选择有无发票");
  if (typeof raw.note !== "string" || raw.note.length > NOTE_MAX) throw new Error("备注过长");
  if (
    raw.status !== "pending_confirm" &&
    raw.status !== "rejected" &&
    raw.status !== "pending_reimburse" &&
    raw.status !== "reimbursed"
  )
    throw new Error("状态无效");
  return {
    date: raw.date,
    amount: raw.amount,
    categoryId: cat.id,
    categoryName: cat.name,
    paidBy: raw.paidBy,
    hasInvoice: raw.hasInvoice,
    note: raw.note,
    status: raw.status,
  };
}

export function validateCategoryName(name: unknown): string {
  if (typeof name !== "string") throw new Error("请填写分类名称");
  const n = name.trim();
  if (!n) throw new Error("请填写分类名称");
  if (n.length > NAME_MAX) throw new Error("分类名称最多 40 字");
  return n;
}

export function defaultSettings(now: string, partnerUid = "", partnerName = PARTNER_LABEL): ExpenseSettings {
  return {
    partnerUid,
    partnerName: partnerName || PARTNER_LABEL,
    categories: DEFAULT_CATEGORIES.map((c) => ({
      ...c,
      preset: true,
      createdAt: now,
    })),
  };
}

export function displayPayer(uid: string, people: People): string {
  if (uid === people.ownerUid) return people.ownerName || OWNER_LABEL;
  if (uid === people.partnerUid) return people.partnerName || PARTNER_LABEL;
  return PARTNER_LABEL;
}
