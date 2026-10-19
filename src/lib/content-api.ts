import { cloud } from "./cloud";
/** 内容获客数据接口：只调用独立的 content 云函数，不经过销售账本的 sales 函数 */
export interface ContentApi {
  call<T>(action: string, payload?: unknown): Promise<T>;
}
export const CONTENT_FUNCTION = "content";
export const contentCloudApi: ContentApi = {
  async call<T>(action: string, payload: unknown = {}) {
    if (!navigator.onLine)
      throw new Error("网络已断开，草稿已保留，请联网后重试");
    const app = await cloud();
    const response = await app.callFunction({
      name: CONTENT_FUNCTION,
      data: { action, payload },
    });
    const result = response.result;
    if (!result || typeof result.ok !== "boolean")
      throw new Error("内容数据后台响应异常，请稍后重试");
    if (!result.ok) {
      if (
        typeof result.code === "string" &&
        /^[A-Za-z0-9_.-]{1,100}$/.test(result.code)
      )
        console.warn("内容云端错误码", result.code);
      throw new Error(result.error || "操作未完成");
    }
    return result.data as T;
  },
};
