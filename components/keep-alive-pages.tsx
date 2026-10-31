"use client"

import { useState, useEffect, useRef, memo, Suspense, lazy, Component, type ReactNode, type ErrorInfo } from "react"
import { usePathname } from "next/navigation"
import { ActiveRouteProvider, KeepAlivePageScope } from "@/hooks/use-page-active"
import { PageLoading } from "@/components/ui/page-loading"
import { ErrorScreen } from "@/components/ui/error-screen"
import { type KeepAliveRouteKey } from "@/components/keep-alive-routes"

/**
 * Error boundary for lazy-loaded persistent pages.
 * Catches chunk load failures and render errors so they
 * don't crash the entire app.
 */
class PageErrorBoundary extends Component<
  { children: ReactNode },
  { error: unknown }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error: error ?? new Error("Unknown error") }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[v0] Page error boundary caught:", error, errorInfo)
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorScreen
          error={this.state.error}
          title="Page Failed to Load"
          message="This page encountered an error. Please reload the app."
        />
      )
    }
    return this.props.children
  }
}

/**
 * Lazy-imported page components — we manage their lifecycle directly,
 * bypassing Next.js's internal LayoutRouter which would unmount them
 * on navigation even if we cached the `children` prop.
 *
 * Keyed by the shared registry in `keep-alive-routes.ts` — the
 * `Record<KeepAliveRouteKey, …>` type makes adding/removing a route in one
 * file without the other a compile error (the two lists had drifted before).
 * Dashboard and roster are in the keep-alive set so every primary tab
 * switches instantly: the dashboard is the most-visited page (Recharts
 * remount was the dominant cost; its FDP data was already module-cached)
 * and the roster list is virtualized, so the retained DOM is bounded.
 */
type PageModule = { default: React.ComponentType }

const PAGE_IMPORTERS: Record<KeepAliveRouteKey, () => Promise<PageModule>> = {
  "/": () => import("@/app/(app)/page"),
  "/logbook": () => import("@/app/(app)/logbook/page"),
  "/aircraft": () => import("@/app/(app)/aircraft/page"),
  "/airports": () => import("@/app/(app)/airports/page"),
  "/crew": () => import("@/app/(app)/crew/page"),
  "/roster": () => import("@/app/(app)/roster/page"),
}

/**
 * Chunks already fetched, by route — filled by `preloadKeepAlivePages`.
 *
 * The FIRST visit to each tab used to show the Suspense spinner for ~300ms
 * while its chunk downloaded (measured on a production build: 11–18 frames of
 * spinner, the toolbar lagging behind). Fetching the chunks while the app is
 * idle fixes the download — but not on its own: `lazy` still suspends for a
 * frame on a promise that has ALREADY resolved, because a promise only ever
 * settles asynchronously. So once a chunk is here, the lazy factory hands
 * React a thenable that settles synchronously inside `then`, which React
 * resolves on the spot (`lazy` checks its status right after calling `then`)
 * and the page renders in the same commit as the navigation.
 */
const loadedPages = new Map<KeepAliveRouteKey, PageModule>()

function loadPage(key: KeepAliveRouteKey): Promise<PageModule> {
  return PAGE_IMPORTERS[key]().then((m) => {
    loadedPages.set(key, m)
    return m
  })
}

const PERSISTENT_PAGES = Object.fromEntries(
  (Object.keys(PAGE_IMPORTERS) as KeepAliveRouteKey[]).map((key) => [
    key,
    lazy(() => {
      const ready = loadedPages.get(key)
      if (!ready) return loadPage(key)
      const settled = { then: (resolve: (m: PageModule) => void) => resolve(ready) }
      return settled as unknown as Promise<PageModule>
    }),
  ]),
) as Record<KeepAliveRouteKey, React.LazyExoticComponent<React.ComponentType>>

/** Fetch every tab's chunk once the app has gone idle. Idempotent. */
let preloadScheduled = false
function preloadKeepAlivePages() {
  if (preloadScheduled || typeof window === "undefined") return
  preloadScheduled = true
  const run = () => {
    for (const key of Object.keys(PAGE_IMPORTERS) as KeepAliveRouteKey[]) {
      if (!loadedPages.has(key)) loadPage(key).catch(() => {})
    }
  }
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 4000 })
  else setTimeout(run, 2000)
}

/**
 * One kept-alive page, memoized on its route key — which never changes for a
 * given mount, so this subtree is only ever rendered by the page itself.
 *
 * Without the `memo` the surrounding stack recreated `<PageComponent />` on
 * every navigation, and a new element is a re-render however unchanged the
 * props are. All six retained pages therefore re-rendered on every tab switch,
 * for a route change that concerns two of them. (The wrapper `div` still
 * re-renders — its visibility/z-index DO change — but a div is not a page.)
 */
const KeepAlivePage = memo(function KeepAlivePage({
  routeKey,
}: {
  routeKey: KeepAliveRouteKey
}) {
  const PageComponent = PERSISTENT_PAGES[routeKey]
  return (
    <PageErrorBoundary>
      {/* Lets the data hooks hold their last value while this page is hidden
          behind another tab (`useHeldWhileHidden`). */}
      <KeepAlivePageScope routeKey={routeKey}>
        {/* Shared spinner instead of a blank pane while the lazy chunk loads on
            the first visit to this tab. */}
        <Suspense fallback={<PageLoading />}>
          <PageComponent />
        </Suspense>
      </KeepAlivePageScope>
    </PageErrorBoundary>
  )
})

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

  // Render list derived per-render: the first commit of a first visit already
  // includes the new route. Waiting for the `visited` effect produced one
  // commit where the route was persistent but not yet visited — neither the
  // page nor `children` rendered, flashing a blank frame on every first visit
  // to a tab.
  const renderKeys =
    isPersistent && !visited.has(routeKey) ? [...visited, routeKey] : [...visited]

  // Freeze hidden pages' box to the size they had when deactivated. Hidden
  // pages keep layout on purpose (visibility:hidden preserves scroll +
  // virtualizer measurements) — but with `inset-0` they also TRACKED the
  // container, so every split-panel drag frame fired ResizeObservers and
  // re-rendered up to six retained pages (drag jank). Pinning width/height
  // while hidden keeps their dimensions constant (no observer work); on
  // activation the box is released back to inset-0 and the page re-measures
  // once through its normal resize path.
  const stackRef = useRef<HTMLDivElement>(null)
  const pageElsRef = useRef(new Map<string, HTMLDivElement>())
  // The stack's size, kept by an observer. Reading the box in the effect below
  // forced a layout of the whole app on every tab switch (~160ms of it at a 4×
  // CPU throttle) right before the browser laid it out again for the frame —
  // an observer is told the size after a layout it was doing anyway.
  const stackSizeRef = useRef<{ width: number; height: number } | null>(null)
  useEffect(() => {
    const stack = stackRef.current
    if (!stack) return
    const ro = new ResizeObserver(([entry]) => {
      const box = entry.borderBoxSize?.[0]
      stackSizeRef.current = box
        ? { width: box.inlineSize, height: box.blockSize }
        : { width: entry.contentRect.width, height: entry.contentRect.height }
    })
    ro.observe(stack)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    const stack = stackRef.current
    if (!stack) return
    // Only a HIDDEN page needs the size, and on the first mount there is none —
    // so the box is not read at all then, rather than forcing a layout at boot.
    let size = stackSizeRef.current
    pageElsRef.current.forEach((el, key) => {
      if (key === routeKey) {
        el.style.width = ""
        el.style.height = ""
        el.style.right = "0"
        el.style.bottom = "0"
      } else {
        size ??= stack.getBoundingClientRect()
        el.style.right = "auto"
        el.style.bottom = "auto"
        el.style.width = `${size.width}px`
        el.style.height = `${size.height}px`
      }
    })
  }, [routeKey])

  useEffect(() => {
    preloadKeepAlivePages()
  }, [])

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
      <div ref={stackRef} className="flex-1 relative overflow-hidden">
        {/* Persistent pages: lazy-mounted on first visit, never unmounted */}
        {renderKeys.map(key => {
          const isActive = key === routeKey
          return (
            <div
              key={key}
              ref={(el) => {
                if (el) pageElsRef.current.set(key, el)
                else pageElsRef.current.delete(key)
              }}
              data-keepalive-hidden={!isActive ? "true" : undefined}
              className="absolute inset-0 flex flex-col bg-background"
              style={{
                visibility: isActive ? "visible" : "hidden",
                // The hidden page's subtree is SKIPPED — no style, layout or
                // paint — and its rendering state (scroll offsets included) is
                // kept for when it is shown. `visibility` alone is inherited, so
                // flipping it restyled BOTH pages' whole subtrees on every tab
                // switch: ~1,400 elements, 155–171ms at a 4× throttle, the
                // biggest single task of a switch. `visibility` stays as well,
                // for an engine without `content-visibility` — the page is
                // hidden either way, only the cost differs.
                contentVisibility: isActive ? "visible" : "hidden",
                pointerEvents: isActive ? "auto" : "none",
                zIndex: isActive ? 1 : 0,
              }}
            >
              <KeepAlivePage routeKey={key as KeepAliveRouteKey} />
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
