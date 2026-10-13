/* Notifications only: never cache authenticated responses or business data. */
self.addEventListener("install", event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener("activate", event => { event.waitUntil(self.clients.claim()); });
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* generic notification */ }
  const task = typeof data.taskId === "string" && /^[\w-]{1,128}$/.test(data.taskId) ? data.taskId : "";
  const url = "/JasonAI/#/calendar" + (task ? "?task=" + encodeURIComponent(task) : "");
  event.waitUntil(self.registration.showNotification("章鱼哥 · 日程提醒", {
    body: "有一项客户待办需要处理，点击查看。",
    icon: "/JasonAI/icon-192.png", badge: "/JasonAI/icon-192.png",
    tag: typeof data.tag === "string" ? data.tag.slice(0, 150) : "zhangyuge-reminder",
    data: { url },
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/JasonAI/#/calendar", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async clients => {
    for (const client of clients) {
      if (new URL(client.url).pathname.startsWith("/JasonAI/")) { await client.navigate(url); return client.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
