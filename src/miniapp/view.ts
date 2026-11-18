/**
 * 小程序页面用的纯函数（第 1 批：首页看板、记一笔、销售明细、客户日程、铃铛）。
 * 计算一律复用 src/domain；这里只做「给 WXML 准备好要显示的字符串」。
 * 不碰网络、不碰 wx，单测直接跑。
 */
import type { Customer, CustomerRankingResult, CustomerTask, Dashboard, Product, Sale, SaleInput, Totals } from "../domain/model";
import { money, moneyInput, parseYuan } from "../domain/finance";
import { addDays, today } from "../domain/dates";
import { defaultFollowUp, findCustomerByName, inLunchBreak, scheduleText } from "../domain/entryHelpers";
export { quickProducts } from "../domain/entryHelpers";
import { dailyPendingTasks, sortTasksTodayFirst } from "../domain/tasks";
import { displayCustomerName } from "../domain/customers";
import { groupProducts } from "../domain/catalog";

const OFFSET = 8 * 3600_000;
/** ISO → 北京时间 YYYY-MM-DDTHH:MM（和网页 beijingInput 一致） */
export function beijingInput(iso: string = new Date().toISOString()): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + OFFSET).toISOString().slice(0, 16) : "";
}
export const beijingDay = (iso?: string) => beijingInput(iso).slice(0, 10);
/** 北京时间 YYYY-MM-DDTHH:MM → ISO；无效时报中文错误（和网页 beijingToUTC 一致） */
export function beijingToUTC(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("请选择有效的北京时间");
  const time = Date.parse(`${value}:00+08:00`);
  if (!Number.isFinite(time) || beijingInput(new Date(time).toISOString()) !== value) throw new Error("请选择有效的北京时间");
  return new Date(time).toISOString();
}
/** 幂等请求号：只用字母数字和横线，满足云端 recordId 规则 */
export function requestId(random: (n: number) => number[] | Uint8Array = defaultRandom): string {
  const bytes = random(16);
  return "mp-" + Array.from(bytes, (b) => (b & 255).toString(16).padStart(2, "0")).join("");
}
function defaultRandom(n: number) {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 256));
}
export const yuan = (cents: number) => "¥" + money(cents);
export function totalsText(t: Totals) {
  return { revenue: yuan(t.revenue), cost: yuan(t.cost), profit: yuan(t.profit), count: t.count, loss: t.profit < 0 };
}

// ───────────── 首页看板 ─────────────
export type TrendPeriod = "day" | "week" | "month";
export function homeView(d: Dashboard, ranking: CustomerRankingResult | null, day = today()) {
  const month = d.month;
  return {
    day,
    monthTitle: `${Number(day.slice(5, 7))} 月利润`,
    monthProfit: yuan(month.profit),
    monthLoss: month.profit < 0,
    stats: [
      { label: "本月销售额", value: yuan(month.revenue) },
      { label: "本月成本", value: yuan(month.cost) },
      { label: "本月成交", value: `${month.count} 笔` },
    ],
    quick: [
      { label: "今天", value: yuan(d.today.profit), loss: d.today.profit < 0 },
      { label: "本周", value: yuan(d.week.profit), loss: d.week.profit < 0 },
      { label: "累计", value: yuan(d.all.profit), loss: d.all.profit < 0 },
    ],
    hasProducts: d.products.length > 0,
    ranking: rankingRows(ranking),
  };
}
export function rankingRows(r: CustomerRankingResult | null, limit = 5) {
  if (!r) return [];
  return r.items.slice(0, limit).map((c) => ({
    id: c.customerId,
    rank: c.rank,
    name: displayCustomerName(c.name),
    profit: yuan(c.totals.profit),
    count: c.totals.count,
    pending: c.pendingTaskCount,
    top: c.products[0]?.name || "",
  }));
}
/** 走势图上方的汇总：选中某根柱就显示那段，否则显示整个时段 */
export function trendSummary(
  buckets: { key: string; from: string; to: string; profit: number; revenue: number; cost: number; count: number }[],
  selected?: string,
) {
  const hit = buckets.find((b) => b.key === selected || b.key.slice(0, 7) === selected);
  const sum = buckets.reduce(
    (a, b) => ({ profit: a.profit + b.profit, revenue: a.revenue + b.revenue, cost: a.cost + b.cost, count: a.count + b.count }),
    { profit: 0, revenue: 0, cost: 0, count: 0 },
  );
  const t = hit || sum;
  return {
    range: hit ? `${hit.from} 至 ${hit.to}` : "所选时段利润",
    profit: yuan(t.profit),
    detail: `${t.count} 笔 · 收入 ${yuan(t.revenue)} · 成本 ${yuan(t.cost)}`,
    from: hit?.from || "",
    to: hit?.to || "",
  };
}

// ───────────── 记一笔 ─────────────
export interface SaleDraft {
  requestId: string;
  productId: string;
  productName: string;
  customer: string;
  date: string;
  dateTouched?: boolean;
  revenue: string;
  cost: string;
  note: string;
  paidBy?: string;
  schedule?: boolean;
  scheduleDate?: string;
  scheduleTime?: string;
  scheduleTitle?: string;
  scheduleReminder?: "both" | "due" | "off";
  scheduleRequestId?: string;
}
export function freshDraft(date = today(), id = requestId()): SaleDraft {
  return { requestId: id, productId: "", productName: "", customer: "", date, revenue: "", cost: "", note: "" };
}
export function draftFromSale(s: Sale, id = requestId()): SaleDraft {
  return {
    requestId: id,
    productId: s.productId,
    productName: s.productName,
    customer: s.customer,
    date: s.date,
    dateTouched: true,
    revenue: moneyInput(s.revenue),
    cost: moneyInput(s.cost),
    note: s.note,
    ...(s.paidBy ? { paidBy: s.paidBy } : {}),
  };
}
export function draftDirty(d: SaleDraft, day = today()) {
  return Boolean(d.productName || d.customer || d.revenue || d.cost || d.note || d.date !== day);
}
export function pickProduct(d: SaleDraft, p: Product): SaleDraft {
  return {
    ...d,
    productId: p.id,
    productName: p.name,
    revenue: p.hasDefaultPrice === false ? "" : moneyInput(p.price),
    cost: p.hasDefaultCost === false ? "" : moneyInput(p.cost),
  };
}
export function draftProfit(d: SaleDraft, edit?: Sale): string {
  try {
    return yuan(parseYuan(d.revenue, edit?.revenue) - parseYuan(d.cost, edit?.cost));
  } catch {
    return "¥ —";
  }
}
export function productGroups(products: Product[]) {
  return groupProducts(products.filter((p) => p.active && !p.archivedAt));
}
/** 保存前把草稿变成 SaleInput；日程先在本地校验，不合格就不存销售 */
export function prepareSave(d: SaleDraft, opts: { edit?: Sale; payerOn?: boolean } = {}) {
  const sale: SaleInput & { paidBy?: string } = {
    productId: d.productId,
    productName: d.productName,
    customer: d.customer,
    date: d.date,
    revenue: parseYuan(d.revenue, opts.edit?.revenue),
    cost: parseYuan(d.cost, opts.edit?.cost),
    note: d.note,
    ...(opts.payerOn && d.paidBy ? { paidBy: d.paidBy } : {}),
  };
  let schedule: { customer: string; at: string; title: string; nextAction: string; reminder: "both" | "due" | "off"; requestId: string } | undefined;
  if (!opts.edit && d.schedule) {
    const wall = d.scheduleDate && d.scheduleTime ? `${d.scheduleDate}T${d.scheduleTime}` : defaultFollowUp(d.date);
    const customer = d.customer.trim();
    if (!customer) throw new Error("新增客户日程需要先填写客户名称");
    if (inLunchBreak(wall)) throw new Error("12:30–14:00 不排日程，请换个时间");
    schedule = {
      customer,
      at: beijingToUTC(wall),
      ...scheduleText(d.scheduleTitle || "", d.productName, []),
      reminder: d.scheduleReminder || "both",
      requestId: d.scheduleRequestId || requestId(),
    };
  }
  return { sale, schedule };
}
export function scheduleDefaults(d: SaleDraft): Pick<SaleDraft, "scheduleDate" | "scheduleTime"> {
  const wall = defaultFollowUp(d.date);
  return { scheduleDate: d.scheduleDate || wall.slice(0, 10), scheduleTime: d.scheduleTime || wall.slice(11) };
}
/** 按客户名（含合并别名的显示名）找客户档案的根 id */
export function customerRootByName(list: Customer[], name: string): string | null {
  const hit = findCustomerByName(list, name, displayCustomerName);
  if (!hit) return null;
  const byId = new Map(list.map((c) => [c.id, c]));
  let id = hit.id;
  const seen = new Set<string>();
  while (byId.get(id)?.mergedInto && !seen.has(id)) {
    seen.add(id);
    id = byId.get(id)!.mergedInto!;
  }
  return id;
}
/** 客户联想：名字里含输入的，最多 8 个 */
export function customerHints(names: string[], input: string, n = 8) {
  const q = input.trim().toLocaleLowerCase();
  if (!q) return [];
  return names.filter((c) => c.toLocaleLowerCase().includes(q) && c !== input.trim()).slice(0, n);
}

// ───────────── 销售明细 ─────────────
export interface DetailFilters {
  from?: string;
  to?: string;
  productId?: string;
  search?: string;
  deleted?: boolean;
  page?: number;
}
export type Preset = "all" | "today" | "week" | "month" | "lastMonth";
export function presetRange(p: Preset, day = today()): { from?: string; to?: string } {
  if (p === "today") return { from: day, to: day };
  if (p === "week") {
    const w = new Date(day + "T00:00:00Z").getUTCDay();
    const from = addDays(day, -((w + 6) % 7));
    return { from, to: addDays(from, 6) };
  }
  if (p === "month") {
    const from = day.slice(0, 7) + "-01";
    return { from, to: lastDay(from) };
  }
  if (p === "lastMonth") {
    const from = shiftMonth(day.slice(0, 7), -1) + "-01";
    return { from, to: lastDay(from) };
  }
  return {};
}
function lastDay(first: string) {
  return addDays(shiftMonth(first.slice(0, 7), 1) + "-01", -1);
}
export function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const i = y * 12 + m - 1 + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}
export function cleanFilters(f: DetailFilters) {
  const out: Record<string, unknown> = {};
  if (f.from) out.from = f.from;
  if (f.to) out.to = f.to;
  if (f.productId) out.productId = f.productId;
  if (f.search && f.search.trim()) out.search = f.search.trim();
  if (f.deleted) out.deleted = true;
  out.page = Math.max(1, Math.floor(f.page || 1));
  return out;
}
/** 成员只能改、删自己录入的；管理员都可以（云端同样把关，这里只决定按钮显不显示） */
export function canEdit(sale: Sale, me: { role: string; uid: string }) {
  return me.role === "admin" || (!!sale.createdBy && sale.createdBy === me.uid);
}
export function saleRow(s: Sale, me: { role: string; uid: string }) {
  const profit = s.revenue - s.cost;
  return {
    id: s.id,
    revision: s.revision,
    date: s.date.slice(5).replace("-", "/"),
    product: s.productName,
    customer: displayCustomerName(s.customer),
    note: s.note,
    revenue: yuan(s.revenue),
    cost: yuan(s.cost),
    profit: yuan(profit),
    loss: profit < 0,
    editable: canEdit(s, me),
    deleted: !!s.deletedAt,
  };
}
export function pageInfo(total: number, page: number, size = 30) {
  const pages = Math.max(1, Math.ceil(total / size));
  return { pages, page: Math.min(page, pages), hasPrev: page > 1, hasNext: page < pages, text: `第 ${Math.min(page, pages)} / ${pages} 页 · 共 ${total} 笔` };
}

// ───────────── 客户日程 + 铃铛 ─────────────
export function taskStatus(t: CustomerTask, now = Date.now()): string {
  if (t.deletedAt) return "已删除";
  if (t.completedAt) return "已完成";
  if (Date.parse(t.at) < now) return "已逾期";
  const day = beijingDay(new Date(now).toISOString());
  const at = beijingDay(t.at);
  return at === day ? "今日待办" : at === addDays(day, 1) ? "明日待办" : "待办";
}
export function taskRow(t: CustomerTask, customers: Map<string, string>, now = Date.now()) {
  const wall = beijingInput(t.at);
  const status = taskStatus(t, now);
  return {
    id: t.id,
    revision: t.revision,
    time: wall.slice(11),
    date: `${Number(wall.slice(5, 7))}月${Number(wall.slice(8, 10))}日`,
    short: `${Number(wall.slice(5, 7))}/${Number(wall.slice(8, 10))}`,
    customer: displayCustomerName(customers.get(t.customerId) || "未知客户"),
    title: t.title,
    nextAction: t.nextAction,
    status,
    tone: status === "已逾期" ? "late" : status === "已完成" ? "done" : status === "已删除" ? "gone" : "todo",
    done: !!t.completedAt,
    deleted: !!t.deletedAt,
  };
}
export function customerNames(list: Customer[]) {
  return new Map(list.map((c) => [c.id, c.name]));
}
/** 月历：周一开头，6 行；每天带「有几条未完成、几条已完成」 */
export function monthGrid(month: string, tasks: CustomerTask[], selected: string, day = today()) {
  const first = month + "-01";
  const w = new Date(first + "T00:00:00Z").getUTCDay();
  const start = addDays(first, -((w + 6) % 7));
  const byDay = new Map<string, { open: number; done: number }>();
  for (const t of tasks) {
    if (t.deletedAt) continue;
    const d = beijingDay(t.at);
    const c = byDay.get(d) || { open: 0, done: 0 };
    if (t.completedAt) c.done++;
    else c.open++;
    byDay.set(d, c);
  }
  const weeks = Array.from({ length: 6 }, (_, r) =>
    Array.from({ length: 7 }, (_, c) => {
      const date = addDays(start, r * 7 + c);
      const n = byDay.get(date) || { open: 0, done: 0 };
      return {
        date,
        num: Number(date.slice(8)),
        inMonth: date.startsWith(month),
        today: date === day,
        selected: date === selected,
        open: n.open,
        done: n.done,
      };
    }),
  );
  return { title: `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`, weeks: weeks.filter((wk, i) => i < 5 || wk.some((d) => d.inMonth)) };
}
export function monthRange(month: string) {
  const from = month + "-01";
  return { from, to: lastDay(from) };
}
/** 今日 / 明日 / 逾期 三组（逾期只算未完成、未删除） */
export function agenda(tasks: CustomerTask[], day = today(), now = Date.now()) {
  const live = tasks.filter((t) => !t.deletedAt);
  const sorted = sortTasksTodayFirst(live, day);
  return {
    today: sorted.filter((t) => beijingDay(t.at) === day),
    tomorrow: sorted.filter((t) => beijingDay(t.at) === addDays(day, 1)),
    overdue: sorted.filter((t) => !t.completedAt && Date.parse(t.at) < now && beijingDay(t.at) < day),
  };
}
/** 铃铛：今天还没完成的（与网页 DailyReminders 同一个 dailyPendingTasks） */
export function bell(tasks: CustomerTask[], day = today()) {
  const rows = dailyPendingTasks(tasks, day);
  return { count: rows.length, badge: rows.length > 99 ? "99+" : rows.length ? String(rows.length) : "", rows };
}
export interface TaskDraft {
  customerId: string;
  customerName: string;
  date: string;
  time: string;
  title: string;
  nextAction: string;
  feedback: string;
  reminder: "both" | "due" | "off";
  requestId: string;
}
export const REMINDERS = [
  { value: "both", label: "提前 + 到点提醒" },
  { value: "due", label: "只在到点提醒" },
  { value: "off", label: "不提醒" },
] as const;
export function freshTask(date = today(), id = requestId()): TaskDraft {
  return { customerId: "", customerName: "", date, time: "10:00", title: "", nextAction: "", feedback: "", reminder: "both", requestId: id };
}
export function draftFromTask(t: CustomerTask, customers: Map<string, string>, id = requestId()): TaskDraft {
  const wall = beijingInput(t.at);
  return {
    customerId: t.customerId,
    customerName: displayCustomerName(customers.get(t.customerId) || ""),
    date: wall.slice(0, 10),
    time: wall.slice(11),
    title: t.title,
    nextAction: t.nextAction,
    feedback: t.feedback,
    reminder: t.reminder,
    requestId: id,
  };
}
export function taskInput(d: TaskDraft) {
  if (!d.customerId) throw new Error("请选择客户");
  if (!d.title.trim()) throw new Error("请填写日程标题");
  const wall = `${d.date}T${d.time}`;
  if (inLunchBreak(wall)) throw new Error("12:30–14:00 不排日程，请换个时间");
  return {
    customerId: d.customerId,
    at: beijingToUTC(wall),
    title: d.title.trim(),
    feedback: d.feedback,
    nextAction: d.nextAction,
    reminder: d.reminder,
  };
}
