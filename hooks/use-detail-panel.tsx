"use client"

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useIsDesktop } from "@/hooks/use-is-desktop"

interface DetailPanelContextType {
  // The currently rendered detail content
  detailContent: ReactNode | null
  // Set the detail content to render
  setDetailContent: (content: ReactNode | null) => void
  // The selected item ID (stored in URL as ?selected=...)
  selectedId: string | null
  // Set the selected item (updates URL)
  setSelectedId: (id: string | null) => void
  // Whether this is a page that supports detail panel
  hasDetailSupport: boolean
  // Register that current page supports detail panel
  setHasDetailSupport: (value: boolean) => void
  // Pin detail content so it survives one pathname change (for picker navigation)
  pinDetailContent: () => void
}

const DetailPanelContext = createContext<DetailPanelContextType | null>(null)

const SELECTION_STORAGE_KEY = "detail-panel-selections"

// Get stored selections from sessionStorage
function getStoredSelections(): Record<string, string> {
  if (typeof window === "undefined") return {}
  try {
    const stored = sessionStorage.getItem(SELECTION_STORAGE_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

// Save selection to sessionStorage
function saveSelection(path: string, id: string | null) {
  if (typeof window === "undefined") return
  try {
    const selections = getStoredSelections()
    if (id) {
      selections[path] = id
    } else {
      delete selections[path]
    }
    sessionStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(selections))
  } catch {
    // Ignore storage errors
  }
}

interface DetailPanelProviderProps {
  children: ReactNode
}

export function DetailPanelProvider({ children }: DetailPanelProviderProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [detailContent, setDetailContent] = useState<ReactNode | null>(null)
  const [hasDetailSupport, setHasDetailSupport] = useState(false)

  // One-shot pin: when true, the next pathname change won't clear detailContent
  const pinnedRef = useRef(false)
  const pinDetailContent = useCallback(() => {
    pinnedRef.current = true
  }, [])

  // Get selected ID from URL or sessionStorage
  const selectedIdFromUrl = searchParams.get("selected")
  const [selectedId, setSelectedIdState] = useState<string | null>(selectedIdFromUrl)

  // Track when we're updating URL to avoid sync race condition
  const pendingUpdateRef = useRef<string | null | undefined>(undefined)

  // Sync selectedId with URL params (only when URL changes externally).
  // Uses a functional setState so `selectedId` does NOT need to be in deps —
  // removing it prevents an extra re-run after our own setSelectedIdState call.
  useEffect(() => {
    const urlSelected = searchParams.get("selected")
    // Skip sync if we have a pending update that matches (our own update)
    if (pendingUpdateRef.current !== undefined) {
      if (pendingUpdateRef.current === urlSelected) {
        // URL caught up with our update, clear pending
        pendingUpdateRef.current = undefined
      }
      // Skip syncing while we have a pending update
      return
    }
    // Functional update: React bails out (no re-render) if the value is unchanged,
    // so calling this even when urlSelected === selectedId is safe and avoids
    // needing selectedId in the dep array.
    setSelectedIdState(prev => (prev === urlSelected ? prev : urlSelected))
  }, [searchParams])

  // Track previous pathname so we only clear pendingUpdateRef on real page changes,
  // not on every searchParams update (which would break race-condition protection).
  const prevPathnameForPendingRef = useRef(pathname)

  // On pathname change, restore selection from sessionStorage if not in URL
  useEffect(() => {
    // Clear pending update only when the actual page changes, not on every URL update.
    // If we cleared on every searchParams change, every setSelectedId → router.replace
    // would destroy the pending guard before the URL-sync effect above can use it.
    if (prevPathnameForPendingRef.current !== pathname) {
      prevPathnameForPendingRef.current = pathname
      pendingUpdateRef.current = undefined
    }

    const urlSelected = searchParams.get("selected")
    if (!urlSelected) {
      const stored = getStoredSelections()
      const basePath = pathname?.split("?")[0] || ""
      if (stored[basePath]) {
        setSelectedIdState(stored[basePath])
        // Don't auto-update URL here - let the page decide
      }
    }
  }, [pathname, searchParams])

  const setSelectedId = useCallback((id: string | null) => {
    // Mark that we're updating to this value (prevents sync effect from reverting)
    pendingUpdateRef.current = id
    setSelectedIdState(id)

    // Update URL
    const params = new URLSearchParams(searchParams.toString())
    if (id) {
      params.set("selected", id)
    } else {
      params.delete("selected")
    }

    const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname
    router.replace(newUrl || "/", { scroll: false })

    // Save to sessionStorage
    if (pathname) {
      const basePath = pathname.split("?")[0]
      saveSelection(basePath, id)
    }
  }, [pathname, router, searchParams])

  // Routes that use KeepAlivePages — their detail content survives navigation
  // because the page stays mounted and will re-sync via usePageActive callback.
  const KEEPALIVE_ROUTES = ["/logbook", "/aircraft", "/airports", "/crew"]

  // Reset state when pathname changes (different page)
  // If pinned, skip one reset so detail content survives picker navigation.
  // If navigating BETWEEN keep-alive routes, don't clear — the activated page
  // will re-set its detail content via its own usePageActive callback.
  const prevPathnameRef = useRef(pathname)
  useEffect(() => {
    if (pinnedRef.current) {
      pinnedRef.current = false
      prevPathnameRef.current = pathname
      return
    }

    const prevBase = "/" + (prevPathnameRef.current?.split("/").filter(Boolean)[0] || "")
    const currBase = "/" + (pathname?.split("/").filter(Boolean)[0] || "")
    prevPathnameRef.current = pathname

    // If navigating between two keep-alive routes, let the activated page
    // re-sync detail content — don't clear it (prevents flash).
    if (KEEPALIVE_ROUTES.includes(prevBase) && KEEPALIVE_ROUTES.includes(currBase)) {
      return
    }

    setDetailContent(null)
    setHasDetailSupport(false)
  }, [pathname])

  return (
    <DetailPanelContext.Provider
      value={{
        detailContent,
        setDetailContent,
        selectedId,
        setSelectedId,
        hasDetailSupport,
        setHasDetailSupport,
        pinDetailContent,
      }}
    >
      {children}
    </DetailPanelContext.Provider>
  )
}

// Default no-op values for when used outside provider (e.g., SSR, mobile)
const defaultValue: DetailPanelContextType = {
  detailContent: null,
  setDetailContent: () => {},
  selectedId: null,
  setSelectedId: () => {},
  hasDetailSupport: false,
  setHasDetailSupport: () => {},
  pinDetailContent: () => {},
}

export function useDetailPanel() {
  const context = useContext(DetailPanelContext)
  // Return default value when used outside provider (e.g., SSR or mobile layout)
  return context ?? defaultValue
}

// Hook for pages to register their detail support and auto-select first item
export function useDetailPanelPage<T extends { id: string }>(options: {
  items: T[]
  isLoading: boolean
  renderDetail: (item: T) => ReactNode
  emptyMessage?: string
}) {
  const { items, isLoading, renderDetail, emptyMessage = "No entries" } = options
  const { selectedId, setSelectedId, setDetailContent, setHasDetailSupport } = useDetailPanel()
  const isDesktop = useIsDesktop()

  // Register that this page supports detail panel
  useEffect(() => {
    setHasDetailSupport(true)
    return () => setHasDetailSupport(false)
  }, [setHasDetailSupport])

  // Auto-select first item if nothing selected and items loaded
  // Desktop only — on mobile, auto-select would trigger the detail overlay
  useEffect(() => {
    if (!isDesktop) return
    if (!isLoading && items.length > 0 && !selectedId) {
      setSelectedId(items[0].id)
    }
  }, [isDesktop, isLoading, items, selectedId, setSelectedId])

  // Update detail content when selection changes
  useEffect(() => {
    if (isLoading) {
      setDetailContent(
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      )
      return
    }

    if (items.length === 0) {
      setDetailContent(
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
          <p>{emptyMessage}</p>
        </div>
      )
      return
    }

    const selectedItem = items.find(item => item.id === selectedId)
    if (selectedItem) {
      setDetailContent(renderDetail(selectedItem))
    } else if (isDesktop && items.length > 0) {
      // Selection not found, select first item (desktop only)
      setSelectedId(items[0].id)
    }
  }, [isDesktop, selectedId, items, isLoading, renderDetail, setDetailContent, setSelectedId, emptyMessage])

  return {
    selectedId,
    setSelectedId,
    selectedItem: items.find(item => item.id === selectedId) || null,
  }
}
