/**
 * 只读每日统计：最近 7 天（北京时间）每天的「新客户数」。
 * 只返回日期和整数，不返回金额、笔数、姓名、编号或任何明细。
 * 这里只会读取 sales / customers / batches 三个集合，绝不写入。
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { addDays, today } from "../src/domain/dates";
import { customerKey, customerRoots } from "../src/domain/customers";
import type { Customer, ImportBatch, Sale } from "../src/domain/model";

export const STATS_DAYS = 7;
/** 每个集合最多读取的文档数；超过就拒绝，不会无限翻页。 */
export const STATS_MAX_DOCS = 20_000;
export type StatsCollection = "sales" | "customers" | "batches";
const ALLOWED: readonly StatsCollection[] = ["sales", "customers", "batches"];

/** 统计只需要的读取能力：没有 put / del / transaction。 */
export interface StatsReader {
  list<T>(collection: StatsCollection): Promise<T[]>;
}

/** 结构性护栏：包一层只读外壳，任何写方法都会直接抛错，并限制可读集合和数量。 */
export function readOnly(
  source: { list(collection: StatsCollection): Promise<unknown[]> },
  maxDocs = STATS_MAX_DOCS,
): StatsReader & Record<string, unknown> {
  const refuse = (name: string) => () => {
    throw new Error(`统计接口只读，禁止调用 ${name}`);
  };
  return {
    async list<T>(collection: StatsCollection): Promise<T[]> {
      if (!ALLOWED.includes(collection))
        throw new Error("统计接口不读取这个集合");
      const rows = (await source.list(collection)) as T[];
      if (!Array.isArray(rows)) throw new Error("数据库响应异常");
      if (rows.length > maxDocs) throw new Error("数据量超过统计上限");
      return rows;
    },
    get: refuse("get"),
    put: refuse("put"),
    del: refuse("del"),
    transaction: refuse("transaction"),
  };
}

export interface DailyStats {
  asOf: string;
  days: { date: string; new_customers: number }[];
}

/** 北京时间 ISO 字符串，例如 2026-10-19T12:46:00+08:00 */
export function shanghaiIso(now: Date): string {
  const local = new Date(now.getTime() + 8 * 3600_000);
  return local.toISOString().slice(0, 19) + "+08:00";
}

/**
 * 新客户定义（与研究结论一致）：
 * - 客户按 mergedInto 链归到最终的主客户（canonical root）；
 * - 主客户的名字集合 = 所有归到它的客户文档的名字，
 *   加上还没有客户文档、但 customerKey（去掉 ✅ 和末尾 IP）与某个已有客户相同的名字；
 *   都没有文档的名字按 customerKey 自成一组（和后台补建客户时的归并规则一致）；
 * - 只看「有效销售」：deletedAt 为空，且不属于未完成的导入批次；
 * - 客户名为空的销售不计；
 * - 主客户已在设置中删除（archivedAt 有值）时，整组都不计入；
 * - 某组最早一笔有效销售的 date 恰好是 D，就算 D 的 1 个新客户。
 */
export function newCustomersByDay(
  customers: readonly Customer[],
  sales: readonly Sale[],
  batches: readonly ImportBatch[],
  days: readonly string[],
): Map<string, number> {
  const roots = customerRoots(customers);
  const byId = new Map(customers.map((c) => [c.id, c]));
  const byName = new Map(customers.map((c) => [c.name, c]));
  // 没有文档的名字按 customerKey 找主客户：干净名字优先，其次最早建档，再按编号
  const clean = (c: Customer) => (c.name === customerKey(c.name) ? 0 : 1);
  const byKey = new Map<string, string>();
  for (const c of [...customers].sort(
    (a, b) =>
      clean(a) - clean(b) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  )) {
    const key = customerKey(c.name);
    if (key && !byKey.has(key)) byKey.set(key, roots.get(c.id)!);
  }
  const complete = new Set(
    batches.filter((b) => b.status === "complete").map((b) => b.id),
  );
  const first = new Map<string, string>();
  for (const s of sales) {
    if (s.deletedAt) continue;
    if (s.importBatch && !complete.has(s.importBatch)) continue;
    if (typeof s.customer !== "string" || !s.customer.trim()) continue;
    if (typeof s.date !== "string") continue;
    const doc = byName.get(s.customer);
    const key = customerKey(s.customer);
    const group = doc ? roots.get(doc.id)! : (byKey.get(key) ?? "key:" + key);
    if (!group.startsWith("key:") && byId.get(group)?.archivedAt) continue;
    const prev = first.get(group);
    if (!prev || s.date < prev) first.set(group, s.date);
  }
  const counts = new Map(days.map((d) => [d, 0]));
  for (const date of first.values())
    if (counts.has(date)) counts.set(date, counts.get(date)! + 1);
  return counts;
}

export async function dailyStats(
  reader: StatsReader,
  now: Date,
): Promise<DailyStats> {
  const [customers, sales, batches] = await Promise.all([
    reader.list<Customer>("customers"),
    reader.list<Sale>("sales"),
    reader.list<ImportBatch>("batches"),
  ]);
  const end = today(now);
  const days = Array.from({ length: STATS_DAYS }, (_, i) =>
    addDays(end, i - (STATS_DAYS - 1)),
  ); // 从早到晚，最后一项是今天
  const counts = newCustomersByDay(customers, sales, batches, days);
  return {
    asOf: shanghaiIso(now),
    days: days.map((date) => ({ date, new_customers: counts.get(date)! })),
  };
}

/** 令牌：32–256 位字母数字或 -_；与环境变量里的 SHA-256（64 位小写十六进制）按常数时间比较。 */
export function tokenMatches(
  token: unknown,
  expectedSha256: string | undefined,
): boolean {
  if (!expectedSha256 || !/^[a-f0-9]{64}$/.test(expectedSha256)) return false;
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(token))
    return false;
  const actual = createHash("sha256").update(token).digest();
  return timingSafeEqual(actual, Buffer.from(expectedSha256, "hex"));
}

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded: false;
}
const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
function respond(statusCode: number, body: unknown): HttpResponse {
  return {
    statusCode,
    headers: { ...HEADERS },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}
function header(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  for (const [k, v] of Object.entries(headers as Record<string, unknown>))
    if (k.toLowerCase() === name && typeof v === "string") return v;
  return undefined;
}

/**
 * 入口逻辑（与云平台无关，便于测试）：
 * - HTTP 访问服务：只接受 GET，令牌放在 Authorization: Bearer <令牌>（不接受放在网址里）；
 *   不返回任何 CORS 头，浏览器跨域页面读不到结果。
 * - callFunction / 控制台调用：事件里传 { token }，返回同样的 JSON（包在 { ok, data } 里）。
 * - 环境变量 STATS_TOKEN_SHA256 缺失或格式不对时一律拒绝。
 */
export async function handleStats(
  event: unknown,
  env: { STATS_TOKEN_SHA256?: string },
  reader: () => StatsReader,
  now: () => Date = () => new Date(),
): Promise<HttpResponse | { ok: boolean; data?: DailyStats; error?: string }> {
  const e =
    event && typeof event === "object" && !Array.isArray(event)
      ? (event as Record<string, unknown>)
      : {};
  const http = typeof e.httpMethod === "string";
  const enabled = /^[a-f0-9]{64}$/.test(env.STATS_TOKEN_SHA256 || "");
  if (http) {
    if (!enabled) return respond(503, { error: "统计接口未启用" });
    if (e.httpMethod !== "GET") return respond(405, { error: "只支持 GET" });
    const auth = header(e.headers, "authorization") || "";
    const token = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(auth)?.[1];
    if (!tokenMatches(token, env.STATS_TOKEN_SHA256))
      return respond(401, { error: "未授权" });
    try {
      return respond(200, await dailyStats(reader(), now()));
    } catch {
      return respond(500, { error: "统计暂时不可用" });
    }
  }
  if (!enabled) return { ok: false, error: "统计接口未启用" };
  if (!tokenMatches(e.token, env.STATS_TOKEN_SHA256))
    return { ok: false, error: "未授权" };
  try {
    return { ok: true, data: await dailyStats(reader(), now()) };
  } catch {
    return { ok: false, error: "统计暂时不可用" };
  }
}
