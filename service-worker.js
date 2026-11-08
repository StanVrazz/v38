const CACHE = "zeljezni-dnevnik-v27";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./images/zeljezni-dnevnik-start.png",
  "./images/iron-weight-texture-clean-v13.png"
];
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Only successful, complete responses are ever stored (a 404 or a partial 206 must never end up in the cache).
function storable(response) {
  return response && response.ok && response.status === 200;
}

// Videos are requested with a Range header (Safari/iOS always does). Cache the whole file once,
// then answer range requests from the cached copy, so animations also play offline.
async function rangeResponse(req) {
  const cache = await caches.open(CACHE);
  const key = req.url;
  let full = await cache.match(key);
  if (!full) {
    let net;
    try { net = await fetch(key); } catch (e) { return new Response(null, { status: 504 }); }
    if (!storable(net)) return net;
    await cache.put(key, net.clone());
    full = net;
  }
  const buf = await full.arrayBuffer();
  const size = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || "");
  let start = 0, end = size - 1;
  if (m) {
    if (m[1] !== "") {
      start = parseInt(m[1], 10);
      if (m[2] !== "") end = Math.min(parseInt(m[2], 10), size - 1);
    } else if (m[2] !== "") {
      start = Math.max(0, size - parseInt(m[2], 10));
    }
  }
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
  }
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "Content-Type": full.headers.get("Content-Type") || "video/mp4",
      "Content-Length": String(end - start + 1),
      "Content-Range": "bytes " + start + "-" + end + "/" + size
    }
  });
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isAppShell = req.mode === "navigate" || url.pathname.endsWith("/index.html") || url.pathname.endsWith("/");
  if (isAppShell) {
    // Network-first for the app shell: always try to get the latest build first.
    // The cached copy is used only when offline or when the server answers with an error.
    event.respondWith(
      fetch(req).then(response => {
        if (storable(response)) {
          const copy = response.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return response;
        }
        return caches.match(req).then(cached => cached || caches.match("./index.html")).then(cached => cached || response);
      }).catch(() => caches.match(req).then(cached => cached || caches.match("./index.html")))
    );
    return;
  }
  if (req.headers.has("range")) {
    event.respondWith(rangeResponse(req));
    return;
  }
  // Static assets (icons, images, thumbnails): cache-first.
  event.respondWith(
    caches.match(req).then(cached =>
      cached || fetch(req).then(response => {
        if (storable(response)) {
          const copy = response.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return response;
      })
    )
  );
});
