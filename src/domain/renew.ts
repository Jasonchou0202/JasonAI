/**
 * 报销「续费提醒」：记账日期 = 已扣费日，提醒在下一次扣费的前一天上午 10:00（北京时间）。
 * 前端（确认框里的日期）和 sales 云函数（真正建日程）共用这一份规则。
 */
import { addMonthsClamp } from "./entryHelpers";
import { addDays } from "./dates";

/** 提醒钟点（北京时间） */
export const RENEW_REMIND_TIME = "10:00";
/** 提醒提前几天（扣费前一天） */
export const RENEW_DAYS_BEFORE = 1;
/** 续费日程挂在这个固定客户下（第一次需要时才建，与手机临时日程同一做法） */
export const RENEW_CUSTOMER_ID = "expense_renew";
export const RENEW_CUSTOMER_NAME = "🧾报销续费";
/** 续费名最长字数 */
export const RENEW_NAME_MAX = 40;

/**
 * 提醒日期：下个月同一天再往前一天。
 * 下个月没有这一天时沿用手账「小月取月末」（addMonthsClamp），取月末之后再往前一天。
 * 例：11-10 → 12-09；01-31 → 02-27（闰年 02-28）；03-31 → 04-29；12-15 → 次年 01-14；03-01 → 03-31。
 * （Jason 11-16 已确认小月按「月末前一天」）
 */
export function renewRemindDate(expenseDate: string): string {
  return addDays(addMonthsClamp(expenseDate, 1), -RENEW_DAYS_BEFORE);
}

/** 提醒时刻（UTC ISO，日程 at 字段用） */
export function renewRemindAt(expenseDate: string): string {
  return new Date(`${renewRemindDate(expenseDate)}T${RENEW_REMIND_TIME}:00+08:00`).toISOString();
}

/** 续费名缺省取报销分类名；手填的去空格、截断 */
export function renewName(input: unknown, fallback: string): string {
  const raw = typeof input === "string" && input.trim() ? input : fallback;
  return Array.from(raw.replace(/\s+/g, " ").trim()).slice(0, RENEW_NAME_MAX).join("");
}

export function renewTitle(name: string): string {
  return `${name}续费`;
}

/** 「12月9日 10:00」 */
export function renewLabel(date: string): string {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日 ${RENEW_REMIND_TIME}`;
}

/** 报销记录上记下的续费提醒（防重复建：有这一项就不再建） */
export interface ExpenseRenew {
  taskId: string;
  /** 日程时刻 UTC ISO */
  at: string;
  /** 提醒日期（北京时间 yyyy-MM-dd） */
  date: string;
  title: string;
  /** 点按钮的人（日程归属人） */
  by: string;
  createdAt: string;
}
