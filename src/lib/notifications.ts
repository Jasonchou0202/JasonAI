import type { Api } from "../domain/model";

const deviceKey = "zhangyuge-push-device";
export function pushAvailable() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.isSecureContext;
}
export function standalone() {
  return matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}
export function pushDevice() { return localStorage.getItem(deviceKey) || undefined; }
function publicKeyBytes(key: string): Uint8Array<ArrayBuffer> {
  const value = atob(key.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - key.length % 4) % 4));
  return Uint8Array.from(value, c => c.charCodeAt(0));
}
export async function startPush(api: Api) {
  if (!pushAvailable()) throw new Error("当前浏览器不支持系统推送。iPhone 请将网站添加到主屏幕后打开。");
  // Ask immediately from the user's click; iOS requires a direct user gesture.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("通知权限尚未允许，请在系统设置中允许本应用的通知。");
  const config = await api.call<{ configured: boolean; publicKey: string }>("push.config");
  if (!config.configured || !config.publicKey) throw new Error("后台推送尚未配置，请稍后再试。");
  const registration = await navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js", { scope: import.meta.env.BASE_URL });
  await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKeyBytes(config.publicKey) });
  const result = await api.call<{ id: string }>("push.subscribe", { subscription: subscription.toJSON() });
  localStorage.setItem(deviceKey, result.id);
  return result.id;
}
export async function stopPush(api: Api) {
  const id = pushDevice();
  let remoteError: unknown;
  try { if (id) await api.call("push.unsubscribe", { id }); }
  catch (error) { remoteError = error; }
  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  }
  if (remoteError) throw remoteError;
  localStorage.removeItem(deviceKey);
}
