// Service worker for the Field Visit Log PWA. Plain static app, so a simple
// precache of a known file list is reliable. Bump CACHE on every change.
const CACHE = "fieldvisit-v17";
const ASSETS = ["./","./index.html","./app.js","./icons.js","./manifest.json","./farmers.csv","./icon-192.png","./icon-512.png","./vendor/chart.umd.js","./vendor/leaflet.min.js","./vendor/leaflet.min.css"];
self.addEventListener("install",e=>{ self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))); });
self.addEventListener("activate",e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener("fetch",e=>{
  const req=e.request; if(req.method!=="GET") return;
  const url=new URL(req.url); if(url.origin!==self.location.origin) return; // don't touch Google upload
  e.respondWith(caches.match(req).then(c=>c||fetch(req).catch(()=>{ if(req.mode==="navigate") return caches.match("./index.html"); })));
});
