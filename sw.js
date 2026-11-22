/*
 * TrueFrame — service worker that makes the page "cross-origin isolated".
 *
 * Static hosts such as GitHub Pages cannot send custom HTTP headers. Isolation (COOP + COEP)
 * is what lets the neural networks use several CPU cores (multi-threaded WebAssembly), which
 * makes them ~3× faster. This worker adds those two headers to the site's own files; it caches
 * nothing, so updates to the site are picked up normally.
 *
 * Every outside resource the site uses (jsDelivr, Hugging Face, Google Fonts) allows
 * cross-origin loading, so `require-corp` works in every browser, Safari included.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  // Only the site's own responses need the headers; outside requests go straight to the network.
  if (new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (!res || res.status === 0 || res.type === 'opaqueredirect') return res;
        const headers = new Headers(res.headers);
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
        headers.set('Cross-Origin-Resource-Policy', 'same-origin');
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      })
      .catch(() => fetch(req))
  );
});
