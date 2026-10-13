import type { Store, Transaction, Collection } from "./service";
export class MemoryStore implements Store {
  data: Record<Collection, Record<string, unknown>> = {
    sales: {},
    products: {},
    batches: {},
    customers: {},
    tasks: {},
    subscriptions: {},
    deliveries: {},
  };
  private queue = Promise.resolve();
  async get<T>(c: Collection, id: string): Promise<T | null> {
    return structuredClone(this.data[c][id] ?? null) as T | null;
  }
  async put<T>(c: Collection, id: string, v: T) {
    this.data[c][id] = structuredClone(v);
  }
  async list<T>(c: Collection): Promise<T[]> {
    return structuredClone(Object.values(this.data[c])) as T[];
  }
  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
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
