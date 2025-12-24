const CACHE_VERSION = "v2"
const STATIC_CACHE = `skylog-static-${CACHE_VERSION}`
const DYNAMIC_CACHE = `skylog-dynamic-${CACHE_VERSION}`
const CDN_CACHE = `skylog-cdn-${CACHE_VERSION}`

// All app routes to precache
const APP_ROUTES = ["/", "/logbook", "/new-flight", "/aircraft", "/airports", "/crew", "/data"]

// Static assets to precache
const STATIC_ASSETS = ["/manifest.json", "/icon-192.png", "/icon-512.jpg"]

// CDN URLs to cache (will be cached on first use)
const CDN_PATTERNS = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"]

// Install event - precache static assets and app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const staticCache = await caches.open(STATIC_CACHE)

      // Cache static assets
      await staticCache.addAll(STATIC_ASSETS)

      // Cache app routes (fetch HTML for each route)
      for (const route of APP_ROUTES) {
        try {
          const response = await fetch(route, {
            credentials: "same-origin",
            headers: { Accept: "text/html" },
          })
          if (response.ok) {
            await staticCache.put(route, response)
          }
        } catch (e) {
          console.warn(`Failed to precache route: ${route}`, e)
        }
      }

      console.log("[SW] Static assets and routes precached")
    })(),
  )
  self.skipWaiting()
})

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys()
      await Promise.all(
        cacheNames
          .filter((name) => {
            return name.startsWith("skylog-") && name !== STATIC_CACHE && name !== DYNAMIC_CACHE && name !== CDN_CACHE
          })
          .map((name) => caches.delete(name)),
      )
      console.log("[SW] Old caches cleaned up")
    })(),
  )
  self.clients.claim()
})

// Helper: Check if URL is a CDN resource
function isCDNRequest(url) {
  return CDN_PATTERNS.some((pattern) => url.includes(pattern))
}

// Helper: Check if URL is an API request
function isAPIRequest(url) {
  return url.includes("/api/")
}

// Helper: Check if request is for a page navigation
function isNavigationRequest(request) {
  return (
    request.mode === "navigate" || (request.method === "GET" && request.headers.get("accept")?.includes("text/html"))
  )
}

// Helper: Check if URL is a Next.js static asset
function isNextStaticAsset(url) {
  return url.includes("/_next/static/") || url.includes("/_next/image")
}

// Fetch event - handle different request types with appropriate strategies
self.addEventListener("fetch", (event) => {
  const { request } = event
  const url = request.url

  // Skip non-GET requests
  if (request.method !== "GET") {
    return
  }

  // Strategy 1: CDN resources - Cache first, then network
  if (isCDNRequest(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CDN_CACHE)
        const cachedResponse = await cache.match(request)

        if (cachedResponse) {
          // Return cached, but update in background
          fetch(request)
            .then((response) => {
              if (response.ok) {
                cache.put(request, response)
              }
            })
            .catch(() => {})
          return cachedResponse
        }

        try {
          const response = await fetch(request)
          if (response.ok) {
            cache.put(request, response.clone())
          }
          return response
        } catch (e) {
          // Return offline fallback for CDN
          return new Response(JSON.stringify({ error: "Offline - CDN unavailable" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          })
        }
      })(),
    )
    return
  }

  // Strategy 2: API requests - Network first, fallback to offline response
  if (isAPIRequest(url)) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request)
          return response
        } catch (e) {
          // Return offline indicator for API calls
          return new Response(
            JSON.stringify({
              error: "Offline",
              offline: true,
              message: "You are offline. Changes will sync when back online.",
            }),
            {
              status: 503,
              headers: { "Content-Type": "application/json" },
            },
          )
        }
      })(),
    )
    return
  }

  // Strategy 3: Next.js static assets - Cache first
  if (isNextStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(DYNAMIC_CACHE)
        const cachedResponse = await cache.match(request)

        if (cachedResponse) {
          return cachedResponse
        }

        try {
          const response = await fetch(request)
          if (response.ok) {
            cache.put(request, response.clone())
          }
          return response
        } catch (e) {
          return new Response("Offline", { status: 503 })
        }
      })(),
    )
    return
  }

  // Strategy 4: Page navigations - Network first, fallback to cache
  if (isNavigationRequest(request)) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request)

          // Cache successful page responses
          if (response.ok) {
            const cache = await caches.open(STATIC_CACHE)
            cache.put(request, response.clone())
          }

          return response
        } catch (e) {
          // Try to serve from cache
          const cache = await caches.open(STATIC_CACHE)

          // Try exact match first
          let cachedResponse = await cache.match(request)

          if (!cachedResponse) {
            // Try matching the pathname
            const urlObj = new URL(request.url)
            cachedResponse = await cache.match(urlObj.pathname)
          }

          if (!cachedResponse) {
            // Fallback to root page (app shell)
            cachedResponse = await cache.match("/")
          }

          if (cachedResponse) {
            return cachedResponse
          }

          // Return offline page
          return new Response(
            `<!DOCTYPE html>
            <html>
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>Offline - SkyLog</title>
                <style>
                  body { 
                    font-family: system-ui, sans-serif; 
                    display: flex; 
                    align-items: center; 
                    justify-content: center; 
                    height: 100vh; 
                    margin: 0;
                    background: #1a1d2e;
                    color: white;
                    text-align: center;
                  }
                  .container { padding: 20px; }
                  h1 { font-size: 24px; margin-bottom: 16px; }
                  p { color: #888; }
                  button {
                    margin-top: 20px;
                    padding: 12px 24px;
                    background: #3b82f6;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-size: 16px;
                    cursor: pointer;
                  }
                </style>
              </head>
              <body>
                <div class="container">
                  <h1>You're Offline</h1>
                  <p>Please check your internet connection and try again.</p>
                  <button onclick="location.reload()">Retry</button>
                </div>
              </body>
            </html>`,
            {
              status: 503,
              headers: { "Content-Type": "text/html" },
            },
          )
        }
      })(),
    )
    return
  }

  // Strategy 5: Other requests - Stale while revalidate
  event.respondWith(
    (async () => {
      const cache = await caches.open(DYNAMIC_CACHE)
      const cachedResponse = await cache.match(request)

      const fetchPromise = fetch(request)
        .then((response) => {
          if (response.ok) {
            cache.put(request, response.clone())
          }
          return response
        })
        .catch(() => null)

      return cachedResponse || (await fetchPromise) || new Response("Offline", { status: 503 })
    })(),
  )
})

// Background sync for offline operations
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-flights") {
    event.waitUntil(notifyClientsToSync())
  }
})

// Periodic sync for keeping data fresh
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "sync-data") {
    event.waitUntil(notifyClientsToSync())
  }
})

async function notifyClientsToSync() {
  const clients = await self.clients.matchAll({ type: "window" })
  clients.forEach((client) => {
    client.postMessage({ type: "SYNC_REQUIRED" })
  })
}

// Listen for skip waiting message
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting()
  }
})
