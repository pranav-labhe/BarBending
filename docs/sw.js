const CACHE_NAME = "bbs-offline-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./vendor/pdf.min.js",
  "./vendor/pdf.worker.min.js",
  "./vendor/jszip.min.js",
  "./js/bbs_calculator.js",
  "./js/pdf_parser.js",
  "./js/xlsx_exporter.js",
  "./js/app.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
