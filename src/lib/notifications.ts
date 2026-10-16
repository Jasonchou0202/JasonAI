import type { Api } from "../domain/model";

const deviceKey = "zhangyuge-push-device";
export function pushAvailable() {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    window.isSecureContext
  );
}
export function standalone() {
  return (
    matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}
export function pushDevice() {
  return localStorage.getItem(deviceKey) || undefined;
}
export function isAppleMobile(
  agent = navigator.userAgent,
  touchPoints = navigator.maxTouchPoints,
) {
  return (
    /iPhone|iPad|iPod/i.test(agent) ||
    (/Macintosh/i.test(agent) && touchPoints > 1)
  );
}
export async function localPushReady() {
  if (!pushAvailable() || Notification.permission !== "granted") return false;
  const registration = await navigator.serviceWorker.getRegistration(
    import.meta.env.BASE_URL,
  );
  return Boolean(await registration?.pushManager.getSubscription());
}
async function pushRegistration() {
  await navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js", {
    scope: import.meta.env.BASE_URL,
  });
  return navigator.serviceWorker.ready;
}
export async function testLocalNotification() {
  if (!pushAvailable() || Notification.permission !== "granted")
    throw new Error("请先允许此网站的通知权限。");
  const registration = await pushRegistration();
  await registration.showNotification("章鱼哥 · 本机通知自检", {
    body: "电脑通知显示测试；这条通知不经过云端推送。",
    icon: import.meta.env.BASE_URL + "icon-192.png",
    tag: "local-notification-test",
    data: { url: import.meta.env.BASE_URL + "#/calendar" },
  });
}
function publicKeyBytes(key: string): Uint8Array<ArrayBuffer> {
  const value = atob(
    key.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (key.length % 4)) % 4),
  );
  return Uint8Array.from(value, (c) => c.charCodeAt(0));
}
export async function startPush(api: Api) {
  if (!pushAvailable())
    throw new Error(
      "当前浏览器不支持系统推送。电脑请使用 Edge、Chrome 或 Firefox；iPhone 请从主屏幕应用打开。",
    );
  // Ask immediately from the user's click; iOS requires a direct user gesture.
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error(
      "通知权限尚未允许。请在浏览器地址栏的网站权限中允许通知，再重新开启此设备提醒。",
    );
  const config = await api.call<{ configured: boolean; publicKey: string }>(
    "push.config",
  );
  if (!config.configured || !config.publicKey)
    throw new Error("后台推送尚未配置，请稍后再试。");
  const registration = await pushRegistration();
  let subscription;
  try {
    subscription =
      (await registration.pushManager.getSubscription()) ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKeyBytes(config.publicKey),
      }));
  } catch {
    throw new Error(
      "浏览器未能连接推送服务，请检查电脑网络和通知权限，再点击开启重试。",
    );
  }
  const result = await api.call<{ id: string }>("push.subscribe", {
    subscription: subscription.toJSON(),
  });
  localStorage.setItem(deviceKey, result.id);
  return result.id;
}
export async function stopPush(api: Api) {
  const id = pushDevice();
  let remoteError: unknown;
  try {
    if (id) await api.call("push.unsubscribe", { id });
  } catch (error) {
    remoteError = error;
  }
  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration(
      import.meta.env.BASE_URL,
    );
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  }
  if (remoteError) throw remoteError;
  localStorage.removeItem(deviceKey);
}
