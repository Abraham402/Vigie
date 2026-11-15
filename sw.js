/* Vigie — service worker : réseau d'abord, cache en secours (hors ligne) */
const CACHE = "vigie-v3";
const CORE = ["./", "index.html", "assets/style.css?v=3", "assets/data-demo.js?v=3", "assets/live.js?v=3", "assets/core.js?v=3", "assets/learn.js?v=3", "assets/boot.js?v=3", "manifest.webmanifest", "icons/icon-192.png"];
self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => {})) });
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const same = u.origin === location.origin, lib = u.hostname === "unpkg.com" || u.hostname.endsWith("gstatic.com") || u.hostname === "fonts.googleapis.com";
  if (!same && !lib) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)) } return r }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});
self.addEventListener("notificationclick", e => { e.notification.close(); e.waitUntil(self.clients.matchAll({ type: "window" }).then(w => w.length ? w[0].focus() : self.clients.openWindow("./"))) });
