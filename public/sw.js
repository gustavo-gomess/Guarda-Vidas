/* Service worker: lets the presence page open without internet.
 *
 * Deliberately small (no library): only /presenca and /alertas/novo are kept
 * for offline use,
 * network first, so online users always get fresh data. Static build files
 * (/_next/static, content-hashed) are cached on first use. API calls are
 * never cached or answered from cache: the device must not believe the
 * server confirmed something it did not.
 */
const PAGE_CACHE = "gv-pages-v2";
const STATIC_CACHE = "gv-static-v2";
// /alertas/novo opens offline only to say clearly that an alert cannot be
// sent without internet and to point to the official channel.
const OFFLINE_PAGES = ["/presenca", "/alertas/novo"];

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = [PAGE_CACHE, STATIC_CACHE];
      for (const key of await caches.keys()) {
        if (key.startsWith("gv-") && !keep.includes(key)) {
          await caches.delete(key);
        }
      }
      await self.clients.claim();
    })(),
  );
});

async function cachePage(response, path) {
  // Only real pages: not redirects (e.g. to /login) nor errors.
  if (response.ok && !response.redirected && response.type === "basic") {
    const cache = await caches.open(PAGE_CACHE);
    await cache.put(path, response.clone());
  }
  return response;
}

async function networkFirstPage(request, path) {
  try {
    return await cachePage(await fetch(request), path);
  } catch {
    const cached = await caches.match(path, { cacheName: PAGE_CACHE });
    return (
      cached ??
      new Response(
        "<!doctype html><meta charset=utf-8><title>Sem conexão</title>" +
          "<p>Sem conexão e esta página ainda não foi aberta neste aparelho.</p>",
        {
          status: 503,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        },
      )
    );
  }
}

async function cacheFirstStatic(request) {
  const cached = await caches.match(request, { cacheName: STATIC_CACHE });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirstStatic(request));
    return;
  }
  if (request.mode === "navigate" && OFFLINE_PAGES.includes(url.pathname)) {
    event.respondWith(networkFirstPage(request, url.pathname));
  }
});

// The page asks to store itself and the files it already loaded (the first
// visit happens before the service worker controls the page).
self.addEventListener("message", (event) => {
  if (event.origin && event.origin !== self.location.origin) return;
  const data = event.data;
  if (data?.type === "CACHE_PAGE" && OFFLINE_PAGES.includes(data.path)) {
    event.waitUntil(
      fetch(data.path, { credentials: "same-origin" })
        .then((response) => cachePage(response, data.path))
        .catch(() => undefined),
    );
  }
  if (data?.type === "CACHE_STATIC" && Array.isArray(data.urls)) {
    event.waitUntil(
      caches
        .open(STATIC_CACHE)
        .then((cache) =>
          Promise.all(
            data.urls
              .filter((url) =>
                new URL(url).pathname.startsWith("/_next/static/"),
              )
              .map((url) => cache.add(url).catch(() => undefined)),
          ),
        ),
    );
  }
  if (data?.type === "FORGET_PAGES") {
    event.waitUntil(caches.delete(PAGE_CACHE));
  }
});
