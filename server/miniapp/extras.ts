/**
 * miniapp 函数第 2 批的附加调用（只给小程序用，网页来源一律不开放）。
 * 都是「先交给原来的 handle() 做权限和读写，再在这里做小程序平台需要的搬运」：
 * - miniapp.insights：看板剩余 4 张图的统计（读 export + customers.list，权限同网页；只回汇总数，不回明细）
 * - miniapp.export.csv：销售明细 CSV，分块回传（只给管理员，和网页一样）
 * - miniapp.files.relay：小程序用 wx.cloud.CDN 交来的文件 → 原样交给 expenses.receipts.upload / invoices.files.upload
 * - miniapp.files.chunk：凭证、开票附件分块下载（先用原来的 *.urls 调用确认这个人能看这条记录）
 * 不改 sales 函数；不新增任何权限。
 */
import { exportCsv } from "../../src/domain/import";
import {
  buildInsights,
  monthlyNewCustomers,
  monthlyQuadrantCustomers,
  quadrantTotals,
  QUADRANTS,
} from "../../src/domain/insights";
import { needSharesByRoot } from "../../src/domain/profile";
import { today as bjToday } from "../../src/domain/dates";
import type { Customer, Sale } from "../../src/domain/model";

export class ExtraError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** 取文件：url 由云函数自己生成（临时链接）或经过 CDN 白名单校验；可按字节区间取 */
export interface FileFetcher {
  fetch(url: string, opts: { start?: number; end?: number; max?: number }): Promise<{ bytes: Uint8Array; total: number }>;
  /** wx.cloud.CDN 上传后给云函数的地址只认这些域名后缀 */
  cdnHosts: string[];
}

export interface ExtraDeps {
  business: (uid: string, event: { action: string; payload: unknown }) => Promise<unknown>;
  files?: FileFetcher;
  now: () => string;
}
export interface ExtraWho {
  role: "owner" | "member";
  uid: string;
}

export const EXTRA_ACTIONS = new Set(["miniapp.insights", "miniapp.export.csv", "miniapp.files.relay", "miniapp.files.chunk"]);

/** 单次回传上限：callFunction 返回不能太大，按 256KB 原始字节 / 8 万个字符分块 */
export const FILE_CHUNK = 256 * 1024;
export const CSV_CHUNK = 80_000;
export const RELAY_MAX = 4 * 1024 * 1024;
export const DEFAULT_CDN_HOSTS = [".tcb.qcloud.la", ".tcloudbaseapp.com", ".myqcloud.com"];

const VIA = new Set(["expenses.receipts.urls", "invoices.files.urls"]);
const RELAY_TARGET = new Set(["expenses.receipts.upload", "invoices.files.upload"]);
const ID = /^[\w-]{1,128}$/;

export function cdnHostsFromEnv(env: Record<string, string | undefined>): string[] {
  const raw = (env.MINIAPP_CDN_HOSTS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const ok = raw.filter((h) => /^\.[a-z0-9.-]+\.[a-z]{2,}$/.test(h));
  return ok.length ? ok : DEFAULT_CDN_HOSTS;
}

/** 只认 https + 白名单域名后缀；不认 IP、端口、用户名密码 */
export function allowedCdnUrl(raw: unknown, hosts: string[]): string | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (/^[\d.]+$/.test(host) || host.includes(":")) return null;
  return hosts.some((h) => host.endsWith(h) && host.length > h.length) ? u.toString() : null;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function biz<T>(deps: ExtraDeps, who: ExtraWho, action: string, payload: unknown): Promise<T> {
  const r = (await deps.business(who.uid, { action, payload })) as { ok?: boolean; data?: T; error?: string; code?: string };
  if (!r || r.ok !== true) throw new ExtraError(r?.code || "FAILED", r?.error || "云端操作未完成，请稍后重试");
  return r.data as T;
}

const int = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max ? v : null;

export async function handleExtra(deps: ExtraDeps, who: ExtraWho, action: string, p: Record<string, unknown>) {
  if (action === "miniapp.insights") return insights(deps, who);
  if (action === "miniapp.export.csv") {
    if (who.role !== "owner") throw new ExtraError("ADMIN_ONLY", "导出只有管理员可以进行");
    const offset = int(p.offset ?? 0, 0, 50_000_000);
    if (offset === null) throw new Error("请求格式无效");
    const filters: Record<string, unknown> = {};
    for (const k of ["from", "to", "search", "productId"]) if (typeof p[k] === "string" && p[k]) filters[k] = p[k];
    const rows = await biz<Sale[]>(deps, who, "export", filters);
    const csv = exportCsv(rows);
    const part = csv.slice(offset, offset + CSV_CHUNK);
    const next = offset + part.length < csv.length ? offset + part.length : null;
    return { rows: rows.length, length: csv.length, offset, next, text: part, name: `销售明细-${bjToday(new Date(deps.now()))}.csv` };
  }
  if (!deps.files) throw new ExtraError("NOT_IN_MINIAPP", "文件功能暂不可用");
  if (action === "miniapp.files.relay") {
    const target = String(p.target ?? "");
    if (!RELAY_TARGET.has(target)) throw new Error("请求格式无效");
    const url = allowedCdnUrl(p.url, deps.files.cdnHosts);
    if (!url) throw new ExtraError("BAD_FILE_URL", "文件地址无效，请重新选择文件");
    const { bytes } = await deps.files.fetch(url, { max: RELAY_MAX + 1 });
    if (!bytes.length) throw new Error("文件是空的，请重新选择");
    if (bytes.length > RELAY_MAX) throw new Error("文件不能超过 4MB");
    const name = typeof p.name === "string" ? p.name.slice(0, 120) : "";
    const payload: Record<string, unknown> = { name, data: toBase64(bytes) };
    if (target === "invoices.files.upload") payload.purpose = p.purpose === "invoice" ? "invoice" : "profile";
    return biz(deps, who, target, payload);
  }
  // miniapp.files.chunk
  const via = String(p.via ?? "");
  if (!VIA.has(via) || typeof p.id !== "string" || !ID.test(p.id)) throw new Error("请求格式无效");
  const index = int(p.index, 0, 20);
  const offset = int(p.offset ?? 0, 0, 20 * 1024 * 1024);
  if (index === null || offset === null) throw new Error("请求格式无效");
  // 先用原来的调用确认权限（报销凭证：授权成员可看全量；开票附件按开票权限）
  const list = await biz<{ items: { name: string; type: string; size: number; url: string | null }[] }>(deps, who, via, { id: p.id });
  const item = list.items[index];
  if (!item) throw new Error("附件不存在");
  if (!item.url) throw new Error("附件暂时打不开，请稍后重试");
  if (offset >= item.size && item.size > 0) throw new Error("请求格式无效");
  const { bytes, total } = await deps.files.fetch(item.url, { start: offset, end: offset + FILE_CHUNK - 1 });
  const size = total || item.size;
  const part = bytes.subarray(0, FILE_CHUNK);
  const end = offset + part.length;
  return { name: item.name, type: item.type, size, offset, next: end < size ? end : null, data: toBase64(part) };
}

async function insights(deps: ExtraDeps, who: ExtraWho) {
  const [sales, customers] = await Promise.all([
    biz<Sale[]>(deps, who, "export", {}),
    biz<Customer[]>(deps, who, "customers.list", {}),
  ]);
  const day = bjToday(new Date(deps.now()));
  const live = sales.filter((s) => !s.deletedAt);
  const ins = buildInsights(live, customers);
  const [y, m] = day.split("-").map(Number);
  const starts = {
    month: day.slice(0, 7) + "-01",
    quarter: `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`,
    year: `${y}-01-01`,
  };
  const matrix = Object.fromEntries(
    Object.entries(starts).map(([k, from]) => [k, quadrantTotals(live.filter((s) => s.date >= from && s.date <= day), ins.quadrantOf)]),
  );
  const months = monthlyQuadrantCustomers(live, ins).map((r) => ({
    month: r.month,
    active: r.active,
    counts: Object.fromEntries(QUADRANTS.map((q) => [q, r.counts[q]])),
  }));
  return {
    today: day,
    newCustomers: monthlyNewCustomers(live, customers),
    quadMonths: months,
    matrix,
    needs: needSharesByRoot(customers),
  };
}
