import type { Collection, Store, Transaction } from "./service";

export function documentData<T>(result: { data?: unknown }): T | null {
  const value = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!value) return null;
  const { _id, ...data } = value as Record<string, unknown>;
  return data as T;
}
export class CloudStore implements Store {
  constructor(private db: any) {}
  async get<T>(c: Collection, id: string) {
    return documentData<T>(await this.db.collection(c).doc(id).get());
  }
  async put<T>(c: Collection, id: string, value: T) {
    await this.db.collection(c).doc(id).set(value);
  }
  async list<T>(c: Collection): Promise<T[]> {
    const rows: T[] = [];
    let cursor: string | undefined;
    for (;;) {
      let query = this.db.collection(c).orderBy("_id", "asc").limit(100);
      if (cursor) query = query.where({ _id: this.db.command.gt(cursor) });
      const result = await query.get();
      if (!Array.isArray(result.data)) throw new Error("数据库响应异常");
      rows.push(
        ...result.data.map((r: Record<string, unknown>) =>
          documentData<T>({ data: r })!,
        ),
      );
      if (result.data.length < 100) return rows;
      cursor = result.data[result.data.length - 1]._id;
      if (!cursor) throw new Error("数据库分页失败");
    }
  }
  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.runTransaction((transaction: any) =>
      fn({
        get: async <V>(c: Collection, id: string) =>
          documentData<V>(await transaction.collection(c).doc(id).get()),
        put: async <V>(c: Collection, id: string, value: V) => {
          await transaction.collection(c).doc(id).set(value);
        },
      }),
    );
  }
}
