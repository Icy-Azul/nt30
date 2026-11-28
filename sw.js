// NT in 30 service worker: offline support + push notifications
const CACHE = "nt30-v30", TEXT = "nt30-kjv-1";
const CORE = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./apple-touch-icon.png", "./favicon.png"];
self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => {})); });
self.addEventListener("activate", e => { e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== CACHE && k !== TEXT) await caches.delete(k); await self.clients.claim(); })()); });
self.addEventListener("fetch", e => {
  const r = e.request; if (r.method !== "GET") return;
  const u = new URL(r.url); if (u.origin !== location.origin) return;
  if ((u.pathname.includes("/kjv/")||u.pathname.includes("/art/")||u.pathname.includes("/grk/"))) { e.respondWith(caches.open(TEXT).then(c => c.match(r).then(m => m || fetch(r).then(res => { if (res.ok) c.put(r, res.clone()); return res; })))); return; }
  const fresh = r.mode === "navigate" || /\/$|\.html$|\.json$/.test(u.pathname);
  e.respondWith((fresh ? fetch(u.href, { cache: "no-store", credentials: "same-origin" }) : fetch(r)).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); } return res; })
    .catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match("./index.html"))));
});
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "New Testament in 30 Days", { body: d.body || "", icon: "icon-192.png", badge: "icon-192.png", tag: d.tag || "nt30", data: { url: d.url || "./" } }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    for (const c of cs) { if ("focus" in c) { c.navigate && url.includes("#") && c.navigate(url); return c.focus(); } }
    return clients.openWindow(url);
  }));
});
