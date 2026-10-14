/* Cache only the public app shell. Auth, cloud requests and business data bypass it. */
const SHELL_CACHE = "zhangyuge-shell-__BUILD_VERSION__";
const SHELL_FILES = /*__SHELL_FILES__*/ ["/JasonAI/", "/JasonAI/index.html"];
const STATIC_FILES = new Set(SHELL_FILES);
self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("zhangyuge-shell-") && key !== SHELL_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.search || !url.pathname.startsWith("/JasonAI/")) return;
  if (request.mode === "navigate" && ["/JasonAI/", "/JasonAI/index.html"].includes(url.pathname)) {
    event.respondWith(fetch(request).catch(async () => (await caches.match("/JasonAI/", {cacheName: SHELL_CACHE})) || Response.error()));
  } else if (STATIC_FILES.has(url.pathname)) {
    event.respondWith(caches.open(SHELL_CACHE).then(async cache => {
      // The same public asset can be requested with different Origin headers
      // by module scripts and precaching; neither response contains user data.
      const saved = await cache.match(request, { ignoreVary: true });
      if (saved) return saved;
      const response = await fetch(request);
      if (response.ok && response.type === "basic") await cache.put(request, response.clone());
      return response;
    }));
  }
});
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
