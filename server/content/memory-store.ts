import type { ListOptions, RawStore, RawTx } from "./types";
/** 内存存储：单元测试和演示模式用。集合名照样要经过 contentOnly() */
export class ContentMemoryStore implements RawStore {
  data: Record<string, Record<string, unknown>> = {};
  private queue = Promise.resolve();
  private bucket(c: string) {
    return (this.data[c] ??= {});
  }
  async get<T>(c: string, id: string): Promise<T | null> {
    return structuredClone(this.bucket(c)[id] ?? null) as T | null;
  }
  async put<T>(c: string, id: string, v: T) {
    this.bucket(c)[id] = structuredClone(v);
  }
  async del(c: string, id: string) {
    delete this.bucket(c)[id];
  }
  async list<T>(c: string, o: ListOptions): Promise<T[]> {
    const ids = Object.keys(this.bucket(c))
      .filter(
        (id) =>
          (o.fromId === undefined || id >= o.fromId) &&
          (o.toId === undefined || id <= o.toId),
      )
      .sort();
    if (ids.length > o.max) throw new Error("记录太多，请缩小范围");
    return ids.map((id) => structuredClone(this.bucket(c)[id])) as T[];
  }
  async transaction<T>(fn: (tx: RawTx) => Promise<T>): Promise<T> {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const prev = this.queue;
    this.queue = prev.then(() => next);
    await prev;
    const saved = structuredClone(this.data);
    try {
      return await fn(this);
    } catch (e) {
      this.data = saved;
      throw e;
    } finally {
      release();
    }
  }
}
