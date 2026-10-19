import {
  CONTENT_COLLECTIONS,
  type ContentCollection,
  type ContentStore,
  type ContentTx,
  type ListOptions,
  type RawStore,
  type RawTx,
} from "./types";

export const LIST_MAX = 5000;
export class ContentGuardError extends Error {}
/** 集合白名单：只允许 content_daily / content_audit / content_receipts */
export function allowedCollection(name: unknown): ContentCollection {
  if (
    typeof name !== "string" ||
    !(CONTENT_COLLECTIONS as readonly string[]).includes(name)
  )
    throw new ContentGuardError("内容函数不能访问这个集合");
  return name as ContentCollection;
}
function allowedId(id: unknown): string {
  if (typeof id !== "string" || !/^[\w-]{1,128}$/.test(id))
    throw new ContentGuardError("记录编号无效");
  return id;
}
function allowedList(options: ListOptions): ListOptions {
  if (
    !options ||
    !Number.isInteger(options.max) ||
    options.max < 1 ||
    options.max > LIST_MAX
  )
    throw new ContentGuardError("一次读取的条数超出上限");
  if (options.fromId !== undefined) allowedId(options.fromId);
  if (options.toId !== undefined) allowedId(options.toId);
  return { fromId: options.fromId, toId: options.toId, max: options.max };
}
function guardTx(tx: RawTx): ContentTx {
  return {
    get: async (c, id) => tx.get(allowedCollection(c), allowedId(id)),
    put: async (c, id, value) =>
      tx.put(allowedCollection(c), allowedId(id), value),
    del: async (c, id) => tx.del(allowedCollection(c), allowedId(id)),
  };
}
/**
 * 云函数在平台上是管理员身份，数据库规则管不住它，所以在代码里再包一层：
 * 业务代码拿到的存储对象只能读写 3 个 content_ 集合，其他集合（包括全部销售集合）直接抛错。
 */
export function contentOnly(raw: RawStore): ContentStore {
  const base = guardTx(raw);
  return Object.freeze({
    ...base,
    list: async <T>(c: ContentCollection, options: ListOptions) =>
      raw.list<T>(allowedCollection(c), allowedList(options)),
    transaction: <T>(fn: (tx: ContentTx) => Promise<T>) =>
      raw.transaction((tx) => fn(guardTx(tx))),
  });
}
