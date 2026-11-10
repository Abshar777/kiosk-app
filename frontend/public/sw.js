/**
 * Kiosk service worker.
 *
 * Its only job is to keep the shell usable when the network wobbles. It must
 * never make the kiosk show stale money: anything under /api is passed straight
 * through, so a course price, a seat count or a payment status is always the
 * server's answer and never a cached one.
 */

const VERSION = "v1";
const SHELL_CACHE = `kiosk-shell-${VERSION}`;
const ASSET_CACHE = `kiosk-assets-${VERSION}`;
const OFFLINE_URL = "/offline.html";

/** Fetched during install; a failure here must not block activation. */
const SHELL = [OFFLINE_URL, "/manifest.webmanifest", "/icons/icon-192.png", "/delta-mark.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, so one missing file cannot fail the whole install and
      // leave the kiosk with no worker at all.
      await Promise.allSettled(SHELL.map((url) => cache.add(url)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      await Promise.all(
        (await caches.keys()).map((key) => (keep.has(key) ? null : caches.delete(key))),
      );
      await self.clients.claim();
    })(),
  );
});

/** Build output and icons are content-addressed or change rarely. */
function isCacheableAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    /\.(?:css|js|woff2?|png|jpe?g|svg|webp|avif|ico)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Never interfere with anything that changes state or carries a session.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Same-origin only. A cross-origin request — the payment gateway's script, a
  // remote course image — is left entirely alone.
  if (url.origin !== self.location.origin) return;

  // Live data, always. Caching this is how a kiosk shows a seat that is gone or
  // a payment that already failed.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: try the network, fall back to the offline page. Falling back
  // to a cached page would be worse — a student could start enrolling against a
  // course list that no longer exists.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          return (await caches.match(OFFLINE_URL)) ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (!isCacheableAsset(url)) return;

  // Cache-first: these are versioned by the build, so a hit is never stale.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;

      try {
        const response = await fetch(request);
        // Opaque and error responses are not worth keeping.
        if (response.ok && response.type === "basic") {
          const cache = await caches.open(ASSET_CACHE);
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        return Response.error();
      }
    })(),
  );
});

// Lets a new build take over without the operator power-cycling the kiosk.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
