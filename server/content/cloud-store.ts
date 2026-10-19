import type { ListOptions, RawStore, RawTx } from "./types";
/** CloudBase 文档型数据库。只被 content-cloud.ts 使用，并且总是包在 contentOnly() 里 */
function data<T>(result: { data?: unknown }): T | null {
  const value = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!value) return null;
  const { _id, ...rest } = value as Record<string, unknown>;
  return rest as T;
}
const PAGE = 100;
export class ContentCloudStore implements RawStore {
  constructor(private db: any) {}
  async get<T>(c: string, id: string) {
    return data<T>(await this.db.collection(c).doc(id).get());
  }
  async put<T>(c: string, id: string, value: T) {
    await this.db.collection(c).doc(id).set(value);
  }
  async del(c: string, id: string) {
    await this.db.collection(c).doc(id).remove();
  }
  async list<T>(c: string, o: ListOptions): Promise<T[]> {
    const _ = this.db.command;
    const rows: T[] = [];
    let cursor: string | undefined;
    for (;;) {
      const conds: unknown[] = [];
      if (cursor) conds.push(_.gt(cursor));
      else if (o.fromId !== undefined) conds.push(_.gte(o.fromId));
      if (o.toId !== undefined) conds.push(_.lte(o.toId));
      let query = this.db.collection(c);
      if (conds.length)
        query = query.where({
          _id: conds.length === 1 ? conds[0] : _.and(...(conds as any[])),
        });
      const result = await query.orderBy("_id", "asc").limit(PAGE).get();
      if (!Array.isArray(result.data)) throw new Error("数据库响应异常");
      for (const r of result.data) rows.push(data<T>({ data: r })!);
      if (rows.length > o.max) throw new Error("记录太多，请缩小范围");
      if (result.data.length < PAGE) return rows;
      cursor = result.data[result.data.length - 1]._id;
      if (!cursor) throw new Error("数据库分页失败");
    }
  }
  async transaction<T>(fn: (tx: RawTx) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async (transaction: any) => {
      // 事务里不能并发操作，逐个排队执行
      let pending: Promise<unknown> = Promise.resolve();
      const serial = <V>(op: () => Promise<V>): Promise<V> => {
        const result = pending.then(op);
        pending = result;
        return result;
      };
      try {
        const result = await fn({
          get: <V>(c: string, id: string) =>
            serial(async () =>
              data<V>(await transaction.collection(c).doc(id).get()),
            ),
          put: <V>(c: string, id: string, value: V) =>
            serial(async () => {
              await transaction.collection(c).doc(id).set(value);
            }),
          del: (c: string, id: string) =>
            serial(async () => {
              await transaction.collection(c).doc(id).remove();
            }),
        });
        await pending;
        return result;
      } catch (error) {
        await pending.catch(() => undefined);
        throw error;
      }
    });
  }
}
