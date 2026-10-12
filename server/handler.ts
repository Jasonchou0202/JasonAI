import { execute, identity, type Context, type Store } from "./service";
export async function handle(store: () => Store, ctx: Context, event: unknown) {
  try {
    identity(ctx);
    if (!event || typeof event !== "object" || Array.isArray(event))
      throw new Error("请求格式无效");
    const e = event as { action?: unknown; payload?: unknown };
    if (typeof e.action !== "string") throw new Error("请求格式无效");
    return {
      ok: true,
      data: await execute(store(), ctx, e.action, e.payload ?? {}),
    };
  } catch (error) {
    const text = error instanceof Error ? error.message : "";
    return {
      ok: false,
      error:
        /[\u4e00-\u9fa5]/.test(text) && text.length <= 200
          ? text
          : "云端操作未完成，请稍后重试",
    };
  }
}
