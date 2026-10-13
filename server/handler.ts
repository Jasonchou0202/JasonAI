import { execute, identity, type Context, type Store } from "./service";
export async function handle(
  store: () => Store,
  ctx: Context,
  event: unknown,
  diagnose?: (code: string) => void,
  extra?: (store: Store, action: string, payload: unknown) => Promise<unknown>,
) {
  try {
    identity(ctx);
    if (!event || typeof event !== "object" || Array.isArray(event))
      throw new Error("请求格式无效");
    const e = event as { action?: unknown; payload?: unknown };
    if (typeof e.action !== "string") throw new Error("请求格式无效");
    return {
      ok: true,
      data: e.action.startsWith("push.") && extra
        ? await extra(store(), e.action, e.payload ?? {})
        : await execute(store(), ctx, e.action, e.payload ?? {}),
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    const safeCode = /^[A-Za-z0-9_.-]{1,100}$/.test(code) ? code : undefined;
    if (safeCode) diagnose?.(safeCode);
    const text = error instanceof Error ? error.message : "";
    return {
      ok: false,
      ...(safeCode ? { code: safeCode } : {}),
      error:
        /[\u4e00-\u9fa5]/.test(text) && text.length <= 200
          ? text
          : "云端操作未完成，请稍后重试",
    };
  }
}
