/** content 云函数只认这 3 个集合；其他名字一律拒绝（见 guard.ts） */
export const CONTENT_COLLECTIONS = [
  "content_daily",
  "content_audit",
  "content_receipts",
] as const;
export type ContentCollection = (typeof CONTENT_COLLECTIONS)[number];
export interface ListOptions {
  /** 只取文档编号在 [fromId, toId] 之间的记录（按编号升序） */
  fromId?: string;
  toId?: string;
  /** 最多读多少条，超过就报错，防止一次读太多 */
  max: number;
}
export interface ContentTx {
  get<T>(collection: ContentCollection, id: string): Promise<T | null>;
  put<T>(collection: ContentCollection, id: string, value: T): Promise<void>;
  del(collection: ContentCollection, id: string): Promise<void>;
}
export interface ContentStore extends ContentTx {
  list<T>(collection: ContentCollection, options: ListOptions): Promise<T[]>;
  transaction<T>(fn: (tx: ContentTx) => Promise<T>): Promise<T>;
}
/** 底层存储：集合名是普通字符串，必须先经过 contentOnly() 才能交给业务代码 */
export interface RawTx {
  get<T>(collection: string, id: string): Promise<T | null>;
  put<T>(collection: string, id: string, value: T): Promise<void>;
  del(collection: string, id: string): Promise<void>;
}
export interface RawStore extends RawTx {
  list<T>(collection: string, options: ListOptions): Promise<T[]>;
  transaction<T>(fn: (tx: RawTx) => Promise<T>): Promise<T>;
}
export interface ContentContext {
  uid: string | null;
  ownerUid: string;
  now?: () => string;
  hash: (text: string) => Promise<string>;
}
