import { useEffect, useRef, useState } from "react";
import type {
  Api,
  Sale,
  Totals,
  CustomerTask as TaskRecord,
} from "../domain/model";
import { cloudApi } from "./cloud";
import { message } from "../components/ui";

export type CustomerMode = "demo" | "cloud";
export interface Customer {
  archivedAt?: string | null;
  id: string;
  name: string;
  mergedInto: string | null;
  revision: number;
  aliases?: string[];
}
export type CustomerTask = TaskRecord;
export type TaskInput = Pick<
  CustomerTask,
  "customerId" | "at" | "title" | "feedback" | "nextAction" | "reminder"
>;
export interface CustomerProduct {
  name: string;
  profit: number;
  count: number;
}
export interface CustomerDetail {
  customer: Customer;
  aliases: string[];
  totals: Totals;
  products: CustomerProduct[];
  sales: Sale[];
}
export interface CustomerRank {
  pendingTaskCount: number;
  rank: number;
  customerId: string;
  name: string;
  aliases: string[];
  products: CustomerProduct[];
  totals: Totals;
}
export interface CustomerRankingData {
  items: CustomerRank[];
  unassigned: Totals;
  totals: Totals;
}
export const apiMode = (api: Api): CustomerMode =>
  api === cloudApi ? "cloud" : "demo";
export function customerRoot(
  customers: readonly Customer[],
  id: string,
): string {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const seen = new Set<string>();
  while (byId.get(id)?.mergedInto && !seen.has(id)) {
    seen.add(id);
    id = byId.get(id)!.mergedInto!;
  }
  return id;
}
const offset = 8 * 60 * 60 * 1000;
/** All wall-clock values belong to Beijing, regardless of the device timezone. */
export function beijingInput(iso = new Date().toISOString()): string {
  const time = Date.parse(iso);
  return Number.isFinite(time)
    ? new Date(time + offset).toISOString().slice(0, 16)
    : "";
}
export const beijingDay = (iso = new Date().toISOString()) =>
  beijingInput(iso).slice(0, 10);
export const currentMonth = () => beijingDay().slice(0, 7);
export function beijingToUTC(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("请选择有效的北京时间");
  const time = Date.parse(`${value}:00+08:00`);
  if (
    !Number.isFinite(time) ||
    beijingInput(new Date(time).toISOString()) !== value
  )
    throw new Error("请选择有效的北京时间");
  return new Date(time).toISOString();
}
export function shiftMonth(month: string, amount: number): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 7);
}
export function dayPlus(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
export function calendarDays(month: string): string[] {
  const first = `${month}-01`;
  const weekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  const start = dayPlus(first, -((weekday + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => dayPlus(start, i));
}
export type TaskTone = "complete" | "urgent" | "pending";
export function taskTone(task: CustomerTask, now = Date.now()): TaskTone {
  if (task.completedAt) return "complete";
  if (Date.parse(task.at) < now) return "pending";
  const day = beijingDay(new Date(now).toISOString());
  return beijingDay(task.at) <= dayPlus(day, 1) ? "urgent" : "pending";
}
export function taskStatus(task: CustomerTask, now = Date.now()): string {
  if (task.deletedAt) return "已删除";
  if (task.completedAt) return "已完成";
  if (Date.parse(task.at) < now) return "已逾期";
  const day = beijingDay(new Date(now).toISOString());
  const at = beijingDay(task.at);
  return at === day ? "今日待办" : at === dayPlus(day, 1) ? "明日待办" : "待办";
}
export function useCustomerQuery<T>(
  api: Api,
  action: string,
  payload: unknown,
  version: number,
  refresh = 0,
) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const encoded = JSON.stringify(payload);
  useEffect(() => {
    let active = true;
    setData(undefined);
    setError("");
    setLoading(true);
    api
      .call<T>(action, JSON.parse(encoded))
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(message(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, action, encoded, version, refresh]);
  return { data, error, loading };
}
export function readLocal<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}
export function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error("浏览器无法保留草稿，请保持页面打开并允许本机存储后重试");
  }
}
export function removeLocal(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* A successful request stays successful. */
  }
}
interface PendingMutation {
  action: string;
  payload: Record<string, unknown>;
  requestId: string;
}
const mutationLocks = new Set<string>();
export function isRejectedMutation(error: unknown) {
  const text = error instanceof Error ? error.message : "";
  return /已在另一处修改|请先恢复日程|客户不存在|日程不存在|形成循环|编号无效|标题、反馈或下一步无效|提醒选项无效|时间须为有效|目标客户|来源客户|回收站|合并数量|版本无效/.test(
    text,
  );
}
/** Persist the exact request before sending. An uncertain response is retried verbatim. */
export function useCustomerMutation(
  api: Api,
  mode: CustomerMode,
  scope: string,
) {
  const key = `zhangyuge-customer-mutation-${mode}-${scope}`;
  const pending = useRef<PendingMutation | undefined>(readLocal(key));
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hasPending, setHasPending] = useState(Boolean(pending.current));
  useEffect(() => {
    pending.current = readLocal(key);
    setHasPending(Boolean(pending.current));
    setError("");
  }, [key, api]);
  async function run(action: string, payload: Record<string, unknown>) {
    if (lock.current || mutationLocks.has(key)) return false;
    lock.current = true;
    mutationLocks.add(key);
    setBusy(true);
    setError("");
    try {
      const operation = readLocal<PendingMutation>(key) || pending.current;
      if (operation) {
        pending.current = operation;
        setHasPending(true);
      }
      if (
        operation &&
        (operation.action !== action ||
          JSON.stringify(operation.payload) !== JSON.stringify(payload))
      )
        throw new Error("上一次操作的结果尚未确认，请先重试该操作");
      const request = operation || {
        action,
        payload,
        requestId: crypto.randomUUID(),
      };
      writeLocal(key, request);
      pending.current = request;
      setHasPending(true);
      await api.call(request.action, {
        ...request.payload,
        requestId: request.requestId,
      });
      removeLocal(key);
      pending.current = undefined;
      setHasPending(false);
      return true;
    } catch (e) {
      if (isRejectedMutation(e)) {
        removeLocal(key);
        pending.current = undefined;
        setHasPending(false);
      }
      setError(message(e));
      return false;
    } finally {
      mutationLocks.delete(key);
      lock.current = false;
      setBusy(false);
    }
  }
  return { run, busy, error, hasPending, pending: pending.current };
}
export type SalesView = "month" | "recent" | "all";
/** 某笔成交是否在所选范围内。近 3 个月 = 本月和前两个月，不含未来月份。 */
export function inSalesView(
  view: SalesView,
  date: string,
  month: string,
  thisMonth: string,
): boolean {
  const m = date.slice(0, 7);
  if (view === "all") return true;
  if (view === "recent")
    return m >= shiftMonth(thisMonth, -2) && m <= thisMonth;
  return m === month;
}
/** 没带月份进入客户详情时的默认范围：本月 → 近 3 个月 → 全部 */
export function defaultSalesView(
  sales: { date: string }[],
  thisMonth: string,
): SalesView {
  if (sales.some((s) => inSalesView("month", s.date, thisMonth, thisMonth)))
    return "month";
  if (sales.some((s) => inSalesView("recent", s.date, thisMonth, thisMonth)))
    return "recent";
  return "all";
}
export function salesViewFallbackHint(view: SalesView): string {
  if (view === "recent") return "本月暂无成交，已为你显示近 3 个月";
  if (view === "all") return "本月和近 3 个月暂无成交，已为你显示全部";
  return "";
}
