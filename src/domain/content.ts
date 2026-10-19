/**
 * 内容获客录入：前端和 content 云函数共用的纯函数。
 * 这个文件不引用任何销售代码（源码扫描测试会检查）。
 */
export const CONTENT_SOURCES = ["抖音", "视频号", "公众号", "小红书"] as const;
export type ContentSource = (typeof CONTENT_SOURCES)[number];
export type ContentLeads = Record<ContentSource, number>;
export interface ContentDailyInput {
  date: string;
  wechat_adds: number;
  leads: ContentLeads;
  note: string;
}
export interface ContentDaily extends ContentDailyInput {
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  lastMutation: string;
}
/** 可发布汇总：只含日期、人数和 4 个来源，不含备注和任何时间以外的信息 */
export interface PublishableExport {
  kind: "content-daily-export";
  version: 1;
  from: string;
  to: string;
  exported_at: string;
  daily: { date: string; wechat_adds: number; sources: ContentLeads }[];
}
export const NOTE_MAX = 60;
export const COUNT_MAX = 100000;
export const RANGE_MAX_DAYS = 400;

export function contentToday(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
/** 北京时间 YYYY-MM-DD HH:MM（看板 reported_at 格式） */
export function beijingMinute(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(now)
    .replace("T", " ");
}
export function contentValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const d = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(d.getTime()) &&
    d.toISOString().slice(0, 10) === value &&
    value >= "2020-01-01" &&
    value <= "2199-12-31"
  );
}
export function contentAddDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  return (
    Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86400000,
    ) + 1
  );
}
function count(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > COUNT_MAX
  )
    throw new Error(`${label}必须是 0 到 ${COUNT_MAX} 之间的整数`);
  return value;
}
export function leadsSum(leads: ContentLeads): number {
  return CONTENT_SOURCES.reduce((s, k) => s + leads[k], 0);
}
/** 校验一天的录入；不通过就抛出中文错误。前端保存前和云函数里都调用它 */
export function validateDailyInput(raw: unknown): ContentDailyInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("录入格式无效");
  const v = raw as Record<string, unknown>;
  for (const key of Object.keys(v))
    if (!["date", "wechat_adds", "leads", "note"].includes(key))
      throw new Error("录入里有不认识的字段");
  if (!contentValidDate(v.date)) throw new Error("日期无效");
  const wechat_adds = count(v.wechat_adds, "新增微信好友数");
  const l = v.leads;
  if (!l || typeof l !== "object" || Array.isArray(l))
    throw new Error("来源拆分格式无效");
  for (const key of Object.keys(l))
    if (!(CONTENT_SOURCES as readonly string[]).includes(key))
      throw new Error(
        `来源「${key.slice(0, 10)}」不认识，只能是抖音、视频号、公众号、小红书`,
      );
  const leads = {} as ContentLeads;
  for (const key of CONTENT_SOURCES)
    leads[key] = count((l as Record<string, unknown>)[key], `${key}人数`);
  const sum = leadsSum(leads);
  if (sum !== wechat_adds)
    throw new Error(
      `四个来源合计 ${sum} 人，和当天新增微信好友 ${wechat_adds} 人对不上，请核对后再保存`,
    );
  if (v.note !== undefined && typeof v.note !== "string")
    throw new Error("备注格式无效");
  const note = ((v.note as string | undefined) ?? "").trim();
  if ([...note].length > NOTE_MAX)
    throw new Error(`备注最多 ${NOTE_MAX} 字，只写来源情况，不写人`);
  if (/wxid_|微信号|(?<!\d)1[3-9]\d{9}(?!\d)/.test(note))
    throw new Error("备注里像是有微信号或手机号，请只写来源情况");
  return { date: v.date, wechat_adds, leads, note };
}
export function toPublishable(
  rows: ContentDaily[],
  from: string,
  to: string,
  exportedAt: string,
): PublishableExport {
  return {
    kind: "content-daily-export",
    version: 1,
    from,
    to,
    exported_at: exportedAt,
    daily: rows
      .filter((r) => !r.deletedAt && r.date >= from && r.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({
        date: r.date,
        wechat_adds: r.wechat_adds,
        sources: Object.fromEntries(
          CONTENT_SOURCES.map((k) => [k, r.leads[k]]),
        ) as ContentLeads,
      })),
  };
}
