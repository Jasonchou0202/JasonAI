import { afterEach, expect, it, vi } from "vitest";
import {
  isAppleMobile,
  localPushReady,
  startPush,
  stopPush,
  testLocalNotification,
} from "../src/lib/notifications";
import type { Api } from "../src/domain/model";

function device() {
  const storage = new Map<string, string>();
  const subscription = {
    toJSON: () => ({
      endpoint: "https://wns2-test.notify.windows.com/w/?token=test",
      keys: {},
    }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
  const registration = {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(subscription),
      subscribe: vi.fn().mockResolvedValue(subscription),
    },
    showNotification: vi.fn().mockResolvedValue(undefined),
  };
  vi.stubGlobal("navigator", {
    userAgent: "Windows Edg/140",
    maxTouchPoints: 0,
    serviceWorker: {
      register: vi.fn().mockResolvedValue(registration),
      ready: Promise.resolve(registration),
      getRegistration: vi.fn().mockResolvedValue(registration),
    },
  });
  vi.stubGlobal("window", {
    PushManager: {},
    Notification: {},
    isSecureContext: true,
  });
  vi.stubGlobal("Notification", {
    permission: "granted",
    requestPermission: vi.fn().mockResolvedValue("granted"),
  });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key),
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  const call = vi.fn(async (action: string) =>
    action === "push.config"
      ? { configured: true, publicKey: "AQID" }
      : { id: "desktop-device" },
  );
  return { registration, subscription, storage, call, api: { call } as Api };
}
afterEach(() => vi.unstubAllGlobals());
it("云端撤销失败仍撤销本机订阅，并保留设备 ID 以供重试", async () => {
  const unsubscribe = vi.fn().mockResolvedValue(true),
    removeItem = vi.fn();
  vi.stubGlobal("localStorage", { getItem: () => "device-1", removeItem });
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistration: async () => ({
        pushManager: { getSubscription: async () => ({ unsubscribe }) },
      }),
    },
  });
  await expect(
    stopPush({
      call: async () => {
        throw new Error("offline");
      },
    }),
  ).rejects.toThrow("offline");
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(removeItem).not.toHaveBeenCalled();
});
it("云端和本机撤销确认后移除设备 ID", async () => {
  const removeItem = vi.fn(),
    call = vi.fn().mockResolvedValue({ active: false });
  vi.stubGlobal("localStorage", { getItem: () => "device-1", removeItem });
  vi.stubGlobal("navigator", {});
  await stopPush({ call });
  expect(call).toHaveBeenCalledWith("push.unsubscribe", { id: "device-1" });
  expect(removeItem).toHaveBeenCalledWith("zhangyuge-push-device");
});

it("distinguishes desktop and iPhone/iPad installation instructions", () => {
  expect(isAppleMobile("Windows Edg/140", 10)).toBe(false);
  expect(isAppleMobile("iPhone", 1)).toBe(true);
  expect(isAppleMobile("Macintosh", 5)).toBe(true);
  expect(isAppleMobile("Macintosh", 0)).toBe(false);
});
it("reuses an Edge subscription and only records the device after the backend accepts it", async () => {
  const d = device();
  await startPush(d.api);
  expect(d.registration.pushManager.subscribe).not.toHaveBeenCalled();
  expect(d.call).toHaveBeenCalledWith("push.subscribe", {
    subscription: d.subscription.toJSON(),
  });
  expect([...d.storage.values()]).toEqual(["desktop-device"]);
  expect(await localPushReady()).toBe(true);
});
it("keeps failed registration retryable without claiming it is enabled", async () => {
  const d = device();
  d.call.mockRejectedValueOnce(new Error("暂时无法连接"));
  await expect(startPush(d.api)).rejects.toThrow("暂时无法连接");
  expect(d.storage.size).toBe(0);
  await startPush(d.api);
  expect(d.storage.size).toBe(1);
});
it("detects a lost browser subscription even if notification permission is allowed", async () => {
  const d = device();
  d.registration.pushManager.getSubscription.mockResolvedValue(null);
  expect(await localPushReady()).toBe(false);
  await startPush(d.api);
  expect(d.registration.pushManager.subscribe).toHaveBeenCalled();
});
it("does not save a device when permission is refused", async () => {
  const d = device();
  vi.mocked(Notification.requestPermission).mockResolvedValue("denied");
  await expect(startPush(d.api)).rejects.toThrow("通知权限尚未允许");
  expect(d.call).not.toHaveBeenCalled();
  expect(d.storage.size).toBe(0);
});
it("offers a generic local display test independent of cloud subscriptions", async () => {
  const d = device();
  await testLocalNotification();
  expect(d.registration.showNotification).toHaveBeenCalledWith(
    "章鱼哥 · 本机通知自检",
    expect.objectContaining({
      tag: "local-notification-test",
      data: { url: import.meta.env.BASE_URL + "#/calendar" },
    }),
  );
  expect(d.call).not.toHaveBeenCalled();
  expect(d.storage.size).toBe(0);
});
it("unsubscribes this browser without changing other devices", async () => {
  const d = device();
  await startPush(d.api);
  await stopPush(d.api);
  expect(d.call).toHaveBeenCalledWith("push.unsubscribe", {
    id: "desktop-device",
  });
  expect(d.subscription.unsubscribe).toHaveBeenCalledOnce();
  expect(d.storage.size).toBe(0);
});
