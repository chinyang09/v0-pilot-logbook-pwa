const CACHE_VERSION = "v4"
const STATIC_CACHE = `skylog-static-${CACHE_VERSION}`
const DYNAMIC_CACHE = `skylog-dynamic-${CACHE_VERSION}`
const CDN_CACHE = `skylog-cdn-${CACHE_VERSION}`
const MODELS_CACHE = `skylog-models-${CACHE_VERSION}`

// OCR model files for offline support (critical for offline OCR functionality)
const OCR_MODEL_FILES = [
  "/models/ch_PP-OCRv4_det_infer.onnx",
  "/models/ch_PP-OCRv4_rec_infer.onnx",
  "/models/ppocr_keys_v1.txt",
]

// Static assets to precache during install (these don't require auth)
const PRECACHE_ASSETS = [
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.jpg",
  "/offline.html",
  "/login", // Login page can be cached during install
]

// CDN URLs to cache (will be cached on first use)
const CDN_PATTERNS = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"]

// Routes that should be cached when visited (runtime caching)
const CACHEABLE_ROUTES = ["/", "/logbook", "/new-flight", "/aircraft", "/airports", "/crew", "/data", "/roster", "/fdp", "/currencies", "/discrepancies"]

// Install event - precache static assets only (not protected routes)
self.addEventListener("install", (event) => {
  console.log("[SW] Installing version:", CACHE_VERSION)
  event.waitUntil(
    (async () => {
      const staticCache = await caches.open(STATIC_CACHE)
      const modelsCache = await caches.open(MODELS_CACHE)

      // Cache static assets that don't require authentication
      for (const asset of PRECACHE_ASSETS) {
        try {
          // Use fetch with cache: 'reload' to ensure fresh copies
          const response = await fetch(asset, { cache: "reload" })
          if (response.ok) {
            await staticCache.put(asset, response)
            console.log("[SW] Precached:", asset)
          }
        } catch (e) {
          console.warn("[SW] Failed to precache:", asset, e)
        }
      }

      // Cache OCR models for offline support (non-blocking)
      console.log("[SW] Starting OCR models precache...")
      for (const modelPath of OCR_MODEL_FILES) {
        try {
          const response = await fetch(modelPath, { credentials: "same-origin" })
          if (response.ok) {
            await modelsCache.put(modelPath, response)
            console.log("[SW] Cached OCR model:", modelPath)
          } else {
            console.warn("[SW] Failed to fetch OCR model:", modelPath, response.status)
          }
        } catch (e) {
          console.warn("[SW] Failed to precache OCR model:", modelPath, e)
        }
      }

      console.log("[SW] Install complete - static assets and models cached")
    })()
  )
  // Don't skip waiting - let the new SW wait until pages are closed
  // This prevents disrupting users mid-session
})

// Activate event - clean up old caches and claim clients
self.addEventListener("activate", (event) => {
  console.log("[SW] Activating version:", CACHE_VERSION)
  event.waitUntil(
    (async () => {
      // Clean up old caches
      const cacheNames = await caches.keys()
      const validCaches = [STATIC_CACHE, DYNAMIC_CACHE, CDN_CACHE, MODELS_CACHE]
      await Promise.all(
        cacheNames
          .filter((name) => {
            return name.startsWith("skylog-") && !validCaches.includes(name)
          })
          .map((name) => {
            console.log("[SW] Deleting old cache:", name)
            return caches.delete(name)
          })
      )

      // Take control of all clients immediately
      await self.clients.claim()
      console.log("[SW] Activation complete")
    })()
  )
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
  return request.mode === "navigate" || (request.method === "GET" && request.headers.get("accept")?.includes("text/html"))
}

// Helper: Check if URL is a Next.js static asset
function isNextStaticAsset(url) {
  return url.includes("/_next/static/") || url.includes("/_next/image")
}

// Helper: Check if URL is an OCR model file
function isOCRModelRequest(url) {
  return url.includes("/models/") && (url.endsWith(".onnx") || url.endsWith(".txt"))
}

// Helper: Check if this is a cacheable app route
function isCacheableRoute(url) {
  const urlObj = new URL(url)
  const pathname = urlObj.pathname
  return CACHEABLE_ROUTES.includes(pathname) || CACHEABLE_ROUTES.some((route) => pathname.startsWith(route + "/"))
}

// Helper: Get the offline fallback page
async function getOfflineFallback() {
  const cache = await caches.open(STATIC_CACHE)
  const offlinePage = await cache.match("/offline.html")
  if (offlinePage) {
    return offlinePage
  }

  // If offline.html isn't cached, return a basic offline response
  return new Response(
    `<!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Offline - OOOI</title>
        <style>
          body {
            font-family: system-ui, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            background: #05080B;
            color: white;
            text-align: center;
          }
          .container { padding: 20px; }
          h1 { font-size: 24px; margin-bottom: 16px; }
          p { color: #888; margin-bottom: 20px; }
          button {
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
          <p>Please connect to the internet to continue.</p>
          <button onclick="location.reload()">Retry</button>
        </div>
      </body>
    </html>`,
    {
      status: 503,
      headers: { "Content-Type": "text/html" },
    }
  )
}

// Fetch event - handle different request types with appropriate strategies
self.addEventListener("fetch", (event) => {
  const { request } = event
  const url = request.url

  // Skip non-GET requests
  if (request.method !== "GET") {
    return
  }

  // Skip chrome-extension and other non-http(s) requests
  if (!url.startsWith("http")) {
    return
  }

  // Strategy 1: CDN resources - Cache first with background update
  if (isCDNRequest(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CDN_CACHE)
        const cachedResponse = await cache.match(request)

        if (cachedResponse) {
          // Return cached, update in background
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
          return new Response(JSON.stringify({ error: "Offline - CDN unavailable" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          })
        }
      })()
    )
    return
  }

  // Strategy 2: API requests - Network only (let client handle offline state)
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
            }
          )
        }
      })()
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
      })()
    )
    return
  }

  // Strategy 4: OCR model files - Cache first (critical for offline OCR)
  if (isOCRModelRequest(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(MODELS_CACHE)
        const cachedResponse = await cache.match(request)

        if (cachedResponse) {
          console.log("[SW] Serving OCR model from cache:", url)
          return cachedResponse
        }

        // Not in cache - try to fetch and cache
        try {
          console.log("[SW] Fetching OCR model from network:", url)
          const response = await fetch(request)
          if (response.ok) {
            cache.put(request, response.clone())
            console.log("[SW] Cached OCR model:", url)
          }
          return response
        } catch (e) {
          console.error("[SW] Failed to fetch OCR model offline:", url, e)
          return new Response(JSON.stringify({ error: "OCR model not available offline" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          })
        }
      })()
    )
    return
  }

  // Strategy 5: Page navigations - CACHE FIRST with network update (offline-first!)
  if (isNavigationRequest(request)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE)
        const urlObj = new URL(request.url)
        const pathname = urlObj.pathname

        // Try to get from cache first
        let cachedResponse = await cache.match(request)

        // Also try matching by pathname (for different URL formats)
        if (!cachedResponse) {
          cachedResponse = await cache.match(pathname)
        }

        // If we have a cached response, return it immediately
        // and update the cache in the background
        if (cachedResponse) {
          // Background update (stale-while-revalidate)
          fetch(request)
            .then(async (networkResponse) => {
              if (networkResponse.ok && !networkResponse.redirected) {
                // Only cache successful, non-redirect responses
                await cache.put(request, networkResponse.clone())
                // Also cache by pathname for easier matching
                if (pathname !== request.url) {
                  await cache.put(pathname, networkResponse)
                }
              }
            })
            .catch(() => {
              // Network failed, but we already returned cached version
            })

          return cachedResponse
        }

        // No cache - try network
        try {
          const networkResponse = await fetch(request)

          // Cache successful HTML responses for future offline use
          if (networkResponse.ok && !networkResponse.redirected) {
            const responseToCache = networkResponse.clone()
            // Cache both by full URL and pathname
            cache.put(request, responseToCache.clone())
            if (pathname !== request.url) {
              cache.put(pathname, responseToCache)
            }
            console.log("[SW] Cached page:", pathname)
          }

          return networkResponse
        } catch (e) {
          // Network failed, no cache - show offline page
          console.log("[SW] Network failed, no cache for:", pathname)

          // Try to serve root as fallback (app shell)
          const rootCache = await cache.match("/")
          if (rootCache) {
            return rootCache
          }

          // Last resort - offline page
          return getOfflineFallback()
        }
      })()
    )
    return
  }

  // Strategy 6: Other requests - Stale while revalidate
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
    })()
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

// Listen for messages from clients
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting()
  }

  // Allow clients to request cache updates
  if (event.data?.type === "CACHE_PAGES") {
    const pages = event.data.pages || CACHEABLE_ROUTES
    cachePages(pages)
  }

  // Check if OCR models are cached
  if (event.data?.type === "CHECK_OCR_MODELS_CACHED") {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(MODELS_CACHE)
        const results = await Promise.all(
          OCR_MODEL_FILES.map(async (modelPath) => {
            const response = await cache.match(modelPath)
            return { path: modelPath, cached: !!response }
          })
        )
        const allCached = results.every((r) => r.cached)
        event.source.postMessage({
          type: "OCR_MODELS_CACHE_STATUS",
          allCached,
          details: results,
        })
      })()
    )
  }

  // Manually trigger OCR models caching
  if (event.data?.type === "CACHE_OCR_MODELS") {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(MODELS_CACHE)
        const results = []

        for (const modelPath of OCR_MODEL_FILES) {
          try {
            // Check if already cached
            const existing = await cache.match(modelPath)
            if (existing) {
              results.push({ path: modelPath, success: true, cached: true })
              continue
            }

            // Fetch and cache
            const response = await fetch(modelPath, { credentials: "same-origin" })
            if (response.ok) {
              await cache.put(modelPath, response)
              results.push({ path: modelPath, success: true, cached: false })
            } else {
              results.push({ path: modelPath, success: false, error: `HTTP ${response.status}` })
            }
          } catch (e) {
            results.push({ path: modelPath, success: false, error: e.message })
          }
        }

        const allSuccess = results.every((r) => r.success)
        event.source.postMessage({
          type: "OCR_MODELS_CACHE_RESULT",
          success: allSuccess,
          details: results,
        })
      })()
    )
  }
})

// Function to cache pages (called after successful auth)
async function cachePages(pages) {
  const cache = await caches.open(STATIC_CACHE)

  for (const page of pages) {
    try {
      const response = await fetch(page, {
        credentials: "same-origin",
        headers: { Accept: "text/html" },
      })
      if (response.ok && !response.redirected) {
        await cache.put(page, response)
        console.log("[SW] Runtime cached:", page)
      }
    } catch (e) {
      console.warn("[SW] Failed to cache:", page, e)
    }
  }
}
