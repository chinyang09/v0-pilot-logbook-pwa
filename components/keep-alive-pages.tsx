"use client"

import { useRef, useEffect, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import { ActiveRouteProvider } from "@/hooks/use-page-active"

/**
 * Routes whose page components stay mounted across navigation.
 * These have virtualized lists, expensive IndexedDB queries, or complex
 * state that would flash/reset on remount.
 *
 * All other routes (currencies, settings, new-flight, etc.) unmount normally.
 */
const PERSISTENT_ROUTES = new Set([
  "/logbook",
  "/aircraft",
  "/airports",
  "/crew",
])

/**
 * Normalise pathname → route key.
 * "/logbook" stays "/logbook", "/aircraft/new?select=true" → "/aircraft/new" (not persistent).
 * Only exact matches of top-level persistent routes are kept alive.
 */
function routeKeyFromPathname(pathname: string | null): string {
  if (!pathname) return "/"
  // Strip query string if present in pathname (shouldn't be, but safety)
  const clean = pathname.split("?")[0]
  // Match top-level route: "/logbook", "/aircraft", etc.
  // Sub-routes like "/aircraft/new" or "/flights/abc123" are NOT persistent.
  const segments = clean.split("/").filter(Boolean)
  return segments.length > 0 ? `/${segments[0]}` : "/"
}

interface CachedPage {
  element: ReactNode
}

/**
 * KeepAlivePages — intercepts the Next.js App Router `{children}` slot
 * and keeps heavy pages mounted with `display: none` when inactive.
 *
 * On first visit to a persistent route, the page component is mounted.
 * On subsequent navigations away, it's hidden (not unmounted).
 * On return, it becomes visible instantly — all state preserved.
 *
 * Non-persistent routes render normally and unmount on navigation.
 */
export function KeepAlivePages({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const routeKey = routeKeyFromPathname(pathname)
  const isPersistent = PERSISTENT_ROUTES.has(routeKey)

  // Stable Map of cached persistent pages (survives re-renders)
  const cacheRef = useRef<Map<string, CachedPage>>(new Map())

  // Always update the cache with latest children for the current persistent route
  if (isPersistent) {
    cacheRef.current.set(routeKey, { element: children })
  }

  // Focus management: when switching to a keep-alive page, blur any
  // focused element that might be inside a now-hidden page
  const prevRouteRef = useRef(routeKey)
  useEffect(() => {
    if (routeKey !== prevRouteRef.current) {
      const active = document.activeElement as HTMLElement | null
      if (active && active !== document.body) {
        // Check if the focused element is inside a hidden page container
        const hiddenContainer = active.closest('[data-keepalive-hidden="true"]')
        if (hiddenContainer) {
          active.blur()
        }
      }
      prevRouteRef.current = routeKey
    }
  }, [routeKey])

  return (
    <ActiveRouteProvider activeRoute={routeKey}>
      {/* Render all cached persistent pages */}
      {Array.from(cacheRef.current.entries()).map(([key, cached]) => {
        const isActive = key === routeKey
        return (
          <div
            key={key}
            data-keepalive-hidden={!isActive ? "true" : undefined}
            style={{
              display: isActive ? "contents" : "none",
            }}
          >
            {cached.element}
          </div>
        )
      })}

      {/* Non-persistent routes render normally (will unmount on navigation) */}
      {!isPersistent && (
        <div style={{ display: "contents" }}>
          {children}
        </div>
      )}
    </ActiveRouteProvider>
  )
}
