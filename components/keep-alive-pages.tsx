"use client"

import { useState, useEffect, useRef, Suspense, lazy, Component, type ReactNode, type ErrorInfo } from "react"
import { usePathname } from "next/navigation"
import { ActiveRouteProvider } from "@/hooks/use-page-active"
import { PageLoading } from "@/components/ui/page-loading"

/**
 * Error boundary for lazy-loaded persistent pages.
 * Catches chunk load failures and render errors so they
 * don't crash the entire app.
 */
class PageErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[v0] Page error boundary caught:", error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-1 items-center justify-center bg-background px-4">
          <div className="text-center max-w-sm">
            <h2 className="text-lg font-semibold text-foreground mb-1">
              Page failed to load
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              This page encountered an error. Please reload the app.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              Reload App
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

/**
 * Lazy-imported page components — we manage their lifecycle directly,
 * bypassing Next.js's internal LayoutRouter which would unmount them
 * on navigation even if we cached the `children` prop.
 */
const PERSISTENT_PAGES: Record<string, React.LazyExoticComponent<React.ComponentType>> = {
  "/": lazy(() => import("@/app/(app)/page")),
  "/logbook": lazy(() => import("@/app/(app)/logbook/page")),
  "/aircraft": lazy(() => import("@/app/(app)/aircraft/page")),
  "/airports": lazy(() => import("@/app/(app)/airports/page")),
  "/crew": lazy(() => import("@/app/(app)/crew/page")),
  // Dashboard and roster joined the keep-alive set so every primary tab
  // switches instantly: the dashboard is the most-visited page (Recharts
  // remount was the dominant cost; its FDP data was already module-cached)
  // and the roster list is virtualized, so the retained DOM is bounded.
  "/roster": lazy(() => import("@/app/(app)/roster/page")),
}

/**
 * Normalise pathname → route key.
 *
 * Only EXACT top-level matches map to a persistent page. Sub-routes
 * (/aircraft/new, /crew/[id], /airports/[icao], …) must keep their own key —
 * collapsing them to the first segment made `isPersistent` true, so
 * KeepAlivePages rendered the kept-alive LIST page and never rendered
 * `children`: the URL changed but the screen didn't. That silently swallowed
 * every mobile [+] navigation (router.push("/aircraft/new") etc.) and all
 * entity-detail deep links.
 */
function routeKeyFromPathname(pathname: string | null): string {
  if (!pathname) return "/"
  const path = pathname.split("?")[0]
  const segments = path.split("/").filter(Boolean)
  if (segments.length === 0) return "/"
  if (segments.length === 1) return `/${segments[0]}`
  return path
}

/**
 * KeepAlivePages — renders heavy pages via lazy imports and keeps them
 * mounted across navigations using visibility:hidden + absolute positioning.
 *
 * Why not cache Next.js `children`?
 * Next.js wraps pages in internal LayoutRouter components that detect
 * navigation and unmount their contents — so caching the element tree
 * from `children` doesn't prevent remounting.
 *
 * Why visibility:hidden instead of display:none?
 * display:none removes elements from layout, resetting scrollTop to 0
 * and breaking virtualizer measurements. visibility:hidden keeps elements
 * in the layout tree, preserving scroll positions and container dimensions.
 */
export function KeepAlivePages({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const routeKey = routeKeyFromPathname(pathname)
  const isPersistent = routeKey in PERSISTENT_PAGES

  // Track which persistent routes have been visited (mount on first visit)
  const [visited, setVisited] = useState<Set<string>>(() =>
    isPersistent ? new Set([routeKey]) : new Set()
  )

  useEffect(() => {
    if (routeKey in PERSISTENT_PAGES && !visited.has(routeKey)) {
      setVisited(prev => new Set(prev).add(routeKey))
    }
  }, [routeKey, visited])

  // Focus management: blur elements inside hidden pages on route change
  const prevRouteRef = useRef(routeKey)
  useEffect(() => {
    if (routeKey !== prevRouteRef.current) {
      const active = document.activeElement as HTMLElement | null
      if (active && active !== document.body) {
        const hidden = active.closest('[data-keepalive-hidden="true"]')
        if (hidden) active.blur()
      }
      prevRouteRef.current = routeKey
    }
  }, [routeKey])

  return (
    <ActiveRouteProvider activeRoute={routeKey}>
      {/* Stacking container — persistent pages are absolutely positioned inside */}
      <div className="flex-1 relative overflow-hidden">
        {/* Persistent pages: lazy-mounted on first visit, never unmounted */}
        {Array.from(visited).map(key => {
          const PageComponent = PERSISTENT_PAGES[key]
          const isActive = key === routeKey
          return (
            <div
              key={key}
              data-keepalive-hidden={!isActive ? "true" : undefined}
              className="absolute inset-0 flex flex-col bg-background"
              style={{
                visibility: isActive ? "visible" : "hidden",
                pointerEvents: isActive ? "auto" : "none",
                zIndex: isActive ? 1 : 0,
              }}
            >
              <PageErrorBoundary>
                {/* Shared spinner instead of a blank pane while the lazy chunk
                    loads on the first visit to this tab. */}
                <Suspense fallback={<PageLoading />}>
                  <PageComponent />
                </Suspense>
              </PageErrorBoundary>
            </div>
          )
        })}

        {/* Non-persistent routes: render Next.js children normally */}
        {!isPersistent && (
          <div className="absolute inset-0 flex flex-col bg-background" style={{ zIndex: 1 }}>
            {children}
          </div>
        )}
      </div>
    </ActiveRouteProvider>
  )
}
