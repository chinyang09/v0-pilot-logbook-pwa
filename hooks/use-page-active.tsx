"use client"

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"

/**
 * Which keep-alive page is the one on screen.
 *
 * ── This is a STORE, not a value in context, and that is the point ──────────
 *
 * The obvious shape is `createContext<string>` holding the active route, with
 * each page deriving `activeRoute === myKey`. It works, and it re-renders
 * EVERY consumer on every navigation — because a context change re-renders all
 * of its consumers, whatever they were going to do with the value. Six
 * keep-alive pages are permanently mounted, so switching tabs re-rendered all
 * six (the dashboard's Recharts trees, the logbook's virtualiser, three
 * reference lists), of which at most two had an answer that actually changed:
 * the one being left and the one being entered.
 *
 * `useSyncExternalStore` moves the comparison INSIDE the subscription. The
 * snapshot is the boolean `isActive`, so React bails out for the four pages
 * whose answer is still `false` and only the two that flipped re-render. This
 * is the same shape as `useDBReady` and `useIsDesktop`, for the same reason.
 *
 * The context now carries the store, which never changes identity — so it is
 * not a re-render source at all.
 */
type ActiveRouteStore = {
  subscribe: (listener: () => void) => () => void
  /** The route key currently on screen. */
  get: () => string
  /** What the first client render saw, so hydration matches. */
  initial: string
}

const ActiveRouteContext = createContext<ActiveRouteStore | null>(null)

export function ActiveRouteProvider({
  activeRoute,
  children,
}: {
  activeRoute: string
  children: ReactNode
}) {
  // `useState` with a lazy initialiser, not a ref: this object IS needed for
  // rendering (it is the context value), and it is built once and never
  // replaced.
  const [box] = useState(() => {
    const listeners = new Set<() => void>()
    const self: {
      current: string
      listeners: Set<() => void>
      store: ActiveRouteStore
    } = {
      current: activeRoute,
      listeners,
      store: {
        subscribe: (listener: () => void) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        get: () => self.current,
        initial: activeRoute,
      } satisfies ActiveRouteStore,
    }
    return self
  })

  // Published on COMMIT, not during render: a store read during render must
  // return the value React last rendered with, or `useSyncExternalStore` tears
  // (some consumers see the new route, some the old, in the same pass). One
  // extra commit for the two pages that changed is cheaper than re-rendering
  // all six every time.
  useEffect(() => {
    if (box.current === activeRoute) return
    box.current = activeRoute
    box.listeners.forEach((listener) => listener())
  }, [activeRoute, box])

  return (
    <ActiveRouteContext.Provider value={box.store}>
      {children}
    </ActiveRouteContext.Provider>
  )
}

/**
 * Hook for keep-alive pages to detect when they become active again.
 *
 * @param routeKey - The route key this page is mounted under (e.g. "/logbook")
 * @param onActivated - Callback fired when the page transitions from inactive → active.
 *                       NOT fired on initial mount (only on re-activation).
 */
export function usePageActive(routeKey: string, onActivated?: () => void) {
  const store = useContext(ActiveRouteContext)

  // The snapshot is the BOOLEAN, so a navigation between two OTHER tabs is not
  // a state change here and React skips this page entirely.
  const isActive = useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    () => (store ? store.get() === routeKey : false),
    () => (store ? store.initial === routeKey : false),
  )

  const wasActiveRef = useRef(isActive)
  const isFirstMountRef = useRef(true)
  // Store onActivated in a ref so the effect does not need it as a dep.
  // This prevents callers that forget useCallback from causing an infinite loop.
  const onActivatedRef = useRef(onActivated)
  useEffect(() => {
    onActivatedRef.current = onActivated
  })

  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false
      wasActiveRef.current = isActive
      return
    }

    // Became active (was previously inactive)
    if (isActive && !wasActiveRef.current) {
      onActivatedRef.current?.()
    }

    wasActiveRef.current = isActive
  }, [isActive])

  return isActive
}

/** Used outside a provider (a page rendered on its own route). */
function noopSubscribe() {
  return () => {}
}
