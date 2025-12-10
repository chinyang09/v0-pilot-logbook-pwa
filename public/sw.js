const CACHE_NAME = "skylog-v1"
const STATIC_ASSETS = ["/", "/manifest.json", "/icon-192.png", "/icon-512.jpg"]

// Install event - cache static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS)
    }),
  )
  self.skipWaiting()
})

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
    }),
  )
  self.clients.claim()
})

// Fetch event - network first, fallback to cache
self.addEventListener("fetch", (event) => {
  // Skip non-GET requests and API calls for sync
  if (event.request.method !== "GET") {
    return
  }

  // For API requests, try network first
  if (event.request.url.includes("/api/")) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ error: "Offline" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        })
      }),
    )
    return
  }

  // For other requests, try network first, then cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses
        if (response.ok) {
          const responseClone = response.clone()
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone)
          })
        }
        return response
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse
          }
          // Return offline page for navigation requests
          if (event.request.mode === "navigate") {
            return caches.match("/")
          }
          return new Response("Offline", { status: 503 })
        })
      }),
  )
})

// Background sync for offline operations
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-flights") {
    event.waitUntil(syncFlights())
  }
})

async function syncFlights() {
  // This will be triggered when coming back online
  const clients = await self.clients.matchAll()
  clients.forEach((client) => {
    client.postMessage({ type: "SYNC_REQUIRED" })
  })
}
