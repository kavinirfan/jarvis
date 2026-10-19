/*
 * JARVIS service worker. Caches only static assets (app shell, wake-word models, wasm) so the
 * app installs and starts fast. API responses, audio and anything personal are never cached.
 */
const CACHE = "jarvis-static-v1";
const PRECACHE = ["/models/wakeword/melspectrogram.onnx", "/models/wakeword/embedding_model.onnx", "/models/wakeword/hey_jarvis_v0.1.onnx", "/worklets/pcm-capture.js", "/icons/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never cache personal data
  const isStatic = /^\/(_next\/static|models|ort|worklets|icons)\//.test(url.pathname);
  if (!isStatic) return; // pages: network only (they depend on the signed-in user)
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        }),
    ),
  );
});
