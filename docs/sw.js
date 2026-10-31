/* halo.je Studio service worker: keeps the app working offline. Data is cached by backend.js. */
const CACHE = "studio-95d973c027";
const SHELL = ["./", "index.html", "backend.js", "manifest.webmanifest",
  "vendor/supabase-2.45.4.js", "vendor/html2canvas.min.js", "vendor/jspdf.umd.min.js", "vendor/pdf.min.js", "vendor/pdf.worker.min.js",
  "icons/logo-full.png", "icons/emblem-96.png", "icons/icon-192.png", "icons/apple-touch-icon.png",
  "fonts/outfit-latin-300-normal.woff2", "fonts/outfit-latin-400-normal.woff2", "fonts/hanken-grotesk-latin-400-normal.woff2", "fonts/hanken-grotesk-latin-500-normal.woff2",
  "fonts/hanken-grotesk-latin-600-normal.woff2", "fonts/hanken-grotesk-latin-700-normal.woff2", "fonts/geist-mono-latin-400-normal.woff2", "fonts/geist-mono-latin-700-normal.woff2"];
self.addEventListener("install", e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())); });
self.addEventListener("activate", e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k !== CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener("fetch", e=>{
  const u = new URL(e.request.url);
  if(e.request.method !== "GET" || u.origin !== location.origin) return;           // Supabase and other APIs go straight to the network
  if(e.request.mode === "navigate"){ e.respondWith(fetch(e.request).then(r=>{ const cp = r.clone(); caches.open(CACHE).then(c=>c.put("index.html", cp)); return r; }).catch(()=>caches.match("index.html"))); return; }
  e.respondWith(caches.match(e.request).then(hit=>hit || fetch(e.request).then(r=>{ if(r.ok){ const cp = r.clone(); caches.open(CACHE).then(c=>c.put(e.request, cp)); } return r; })));
});
