"use client"

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react"

/**
 * Context that provides the currently active route key to all pages.
 * Pages compare their own route against this to know if they're visible.
 */
const ActiveRouteContext = createContext<string | null>(null)

export function ActiveRouteProvider({
  activeRoute,
  children,
}: {
  activeRoute: string
  children: ReactNode
}) {
  return (
    <ActiveRouteContext.Provider value={activeRoute}>
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
  const activeRoute = useContext(ActiveRouteContext)
  const isActive = activeRoute === routeKey

  const wasActiveRef = useRef(isActive)
  const isFirstMountRef = useRef(true)

  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false
      wasActiveRef.current = isActive
      return
    }

    // Became active (was previously inactive)
    if (isActive && !wasActiveRef.current) {
      onActivated?.()
    }

    wasActiveRef.current = isActive
  }, [isActive, onActivated])

  return isActive
}
