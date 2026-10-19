/**
 * 云函数 sales-stats 的入口：只读每日新客户数。
 * 只用数据库的查询（get），代码里没有任何 set / update / remove / 事务。
 */
import cloudbase from "@cloudbase/node-sdk";
import {
  handleStats,
  readOnly,
  STATS_MAX_DOCS,
  type StatsCollection,
} from "./stats";

const PAGE = 100;
function reader(db: any) {
  return readOnly({
    // 按 _id 翻页读取，最多 STATS_MAX_DOCS 条；超出就停止并报错
    async list(c: StatsCollection): Promise<unknown[]> {
      const rows: unknown[] = [];
      let cursor: string | undefined;
      for (let page = 0; page <= STATS_MAX_DOCS / PAGE; page++) {
        let query = db.collection(c).orderBy("_id", "asc").limit(PAGE);
        if (cursor) query = query.where({ _id: db.command.gt(cursor) });
        const result = await query.get();
        if (!Array.isArray(result.data)) throw new Error("数据库响应异常");
        for (const r of result.data) {
          const { _id, ...data } = r as Record<string, unknown>;
          rows.push(data);
        }
        if (result.data.length < PAGE) return rows;
        cursor = result.data[result.data.length - 1]._id;
        if (!cursor) throw new Error("数据库分页失败");
      }
      throw new Error("数据量超过统计上限");
    },
  });
}

export async function main(event: unknown) {
  return handleStats(
    event,
    { STATS_TOKEN_SHA256: process.env.STATS_TOKEN_SHA256 },
    () =>
      reader(cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV }).database()),
  );
}
