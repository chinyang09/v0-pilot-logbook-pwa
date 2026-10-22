"use client"

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
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
  //
  // A LAYOUT effect, so that extra commit lands before the browser paints.
  // As a passive effect the new page was painted first and only then told it
  // was active — so it registered its header buttons a frame or two later,
  // and every tab switch showed the new page under the OLD page's toolbar.
  // An update scheduled in a layout effect is flushed synchronously, which
  // still satisfies the rule above: the store changes after React rendered.
  useLayoutEffect(() => {
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

/**
 * The keep-alive page a component is rendered inside, or null outside one
 * (the shell, the detail panel, an ordinary route). Constant for a given
 * mount, so providing it never re-renders anything.
 */
const KeepAlivePageContext = createContext<string | null>(null)

export function KeepAlivePageScope({ routeKey, children }: { routeKey: string; children: ReactNode }) {
  return <KeepAlivePageContext.Provider value={routeKey}>{children}</KeepAlivePageContext.Provider>
}

/**
 * `value` while the page this component lives in is on screen; the value it
 * had when the page was LEFT, while the page is hidden behind another tab.
 *
 * Six pages stay mounted, and every one of them reads the same data hooks.
 * Adding a flight on the logbook therefore re-ran the hidden dashboard's whole
 * legality model — the FDP pipeline, the duty status, the 90-day recency —
 * inside the tap (~550ms of a ~2s add at a 4× throttle), for a page nobody
 * could see. Held here, the hidden page's memos see an unchanged input and
 * skip; the moment it is shown again it reads the live value and catches up
 * once (and `usePageActive`'s re-activation refresh revalidates it besides).
 *
 * Outside a keep-alive page — the detail panel, the shell, an ordinary route —
 * it is the identity: nothing there is ever hidden.
 *
 * Hold the RAW value (SWR's `data`, possibly undefined), never a `data ?? []`
 * default: a fresh array per render would never equal the held one, and the
 * render-phase update below would loop.
 */
export function useHeldWhileHidden<T>(value: T): T {
  const routeKey = useContext(KeepAlivePageContext)
  const store = useContext(ActiveRouteContext)
  const hidden = useSyncExternalStore(
    routeKey && store ? store.subscribe : noopSubscribe,
    () => (routeKey && store ? store.get() !== routeKey : false),
    () => (routeKey && store ? store.initial !== routeKey : false),
  )
  // State, updated DURING render (React's "storing information from previous
  // renders" pattern) rather than a ref written in render or an effect that
  // would hand the hidden page one render of the live value first.
  const [held, setHeld] = useState(value)
  if (!hidden && held !== value) setHeld(value)
  return hidden ? held : value
}
