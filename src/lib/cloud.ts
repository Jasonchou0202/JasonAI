import type { Api } from "../domain/model";
export const configured = Boolean(
  import.meta.env.VITE_CLOUDBASE_ENV_ID &&
  import.meta.env.VITE_CLOUDBASE_PUBLISHABLE_KEY,
);
let appPromise: Promise<any> | undefined;
async function cloud() {
  if (!configured) throw new Error("云端账本尚未连接");
  if (!appPromise)
    appPromise = import("@cloudbase/js-sdk").then(({ default: cloudbase }) =>
      cloudbase.init({
        env: import.meta.env.VITE_CLOUDBASE_ENV_ID,
        region: import.meta.env.VITE_CLOUDBASE_REGION || "ap-shanghai",
        accessKey: import.meta.env.VITE_CLOUDBASE_PUBLISHABLE_KEY,
        auth: { detectSessionInUrl: true },
      }),
    );
  return appPromise;
}
export const cloudApi: Api = {
  async call<T>(action: string, payload: unknown = {}) {
    if (!navigator.onLine)
      throw new Error("网络已断开，草稿已保留，请联网后重试");
    const app = await cloud();
    const response = await app.callFunction({
      name: import.meta.env.VITE_CLOUDBASE_FUNCTION || "sales",
      data: { action, payload },
    });
    const result = response.result;
    if (!result || typeof result.ok !== "boolean")
      throw new Error("后台响应异常，请稍后重试");
    if (!result.ok) {
      if (
        typeof result.code === "string" &&
        /^[A-Za-z0-9_.-]{1,100}$/.test(result.code)
      )
        console.warn("云端错误码", result.code);
      throw new Error(result.error || "操作未完成");
    }
    return result.data as T;
  },
};
export async function session() {
  if (!configured) return false;
  const app = await cloud();
  const r = await app.auth.getSession();
  if (r.error) throw new Error(r.error.message);
  return Boolean(r.data?.session);
}
export async function login() {
  const app = await cloud();
  const { error } = await app.auth.signInWithOAuth({
    provider: "github",
    options: { redirectTo: location.origin + import.meta.env.BASE_URL },
  });
  if (error) throw new Error(error.message);
}
export async function logout() {
  const app = await cloud();
  const { error } = await app.auth.signOut();
  if (error) throw new Error(error.message);
}
