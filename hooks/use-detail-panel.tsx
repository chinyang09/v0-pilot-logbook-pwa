"use client"

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from "react"
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
  /**
   * True when the current route's selection was set explicitly this session
   * (user tapped an item / created one) rather than restored from
   * sessionStorage. The mobile overlay opens for explicit selections
   * immediately from state — it must NOT wait for the router.replace URL
   * round-trip, which can be slow or dropped on a phone (offline PWA, service
   * worker, backgrounding) while desktop renders straight from state.
   */
  selectionExplicit: boolean
  // Whether this is a page that supports detail panel
  hasDetailSupport: boolean
  // Register that current page supports detail panel
  setHasDetailSupport: (value: boolean) => void
  // Pin detail content so it survives one pathname change (for picker navigation)
  pinDetailContent: () => void
}

const DetailPanelContext = createContext<DetailPanelContextType | null>(null)

const SELECTION_STORAGE_KEY = "detail-panel-selections"

// Routes that use KeepAlivePages — their detail content survives navigation
// because the page stays mounted and will re-sync via the usePageActive callback.
const KEEPALIVE_ROUTES = ["/logbook", "/aircraft", "/airports", "/crew"]

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

  // Derive current base route (e.g. "/aircraft", "/airports") from pathname
  const currentBase = useMemo(
    () => "/" + (pathname?.split("/").filter(Boolean)[0] || ""),
    [pathname]
  )
  // Per-route selection map: each base route remembers its own last selection,
  // so switching keep-alive sections instantly re-derives the right selection
  // with no empty flash and no stale cross-route leak. Seeded synchronously from
  // sessionStorage (cleared on PWA close) plus any ?selected= in the current URL.
  // The lazy initializer runs per-environment: on the server sessionStorage is
  // empty ({}), on the client it reads the persisted selections.
  const [selections, setSelections] = useState<Record<string, string | null>>(() => {
    const stored = getStoredSelections()
    const urlSelected = searchParams.get("selected")
    return urlSelected ? { ...stored, [currentBase]: urlSelected } : stored
  })

  // Effective selectedId: derived during render from the current route's slot.
  const selectedId = selections[currentBase] ?? null

  // Which base routes had a selection set explicitly (via setSelectedId) this
  // session — memory-only, so restored selections never count as explicit.
  const [explicitBases, setExplicitBases] = useState<Record<string, boolean>>({})
  const selectionExplicit = !!explicitBases[currentBase] && selectedId !== null

  // Sync the current route's selection with external URL changes (back/forward,
  // deep links). Only acts when ?selected= is present — when it's absent we must
  // NOT clobber a sessionStorage-restored selection to null, otherwise the mobile
  // overlay rule (showMobileOverlay requires searchParams.has("selected")) and the
  // restored desktop detail would both break. The identity bail-out makes this
  // idempotent, so it never reverts our own setSelectedId update.
  useEffect(() => {
    const urlSelected = searchParams.get("selected")
    if (urlSelected === null) return
    setSelections(prev =>
      prev[currentBase] === urlSelected ? prev : { ...prev, [currentBase]: urlSelected }
    )
  }, [searchParams, currentBase])

  const setSelectedId = useCallback((id: string | null) => {
    setSelections(prev => ({ ...prev, [currentBase]: id }))
    setExplicitBases(prev =>
      prev[currentBase] === !!id ? prev : { ...prev, [currentBase]: !!id }
    )

    // Update URL
    const params = new URLSearchParams(searchParams.toString())
    if (id) {
      params.set("selected", id)
    } else {
      params.delete("selected")
    }

    const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname
    router.replace(newUrl || "/", { scroll: false })

    // Persist to sessionStorage (keyed by base route, matching the map)
    saveSelection(currentBase, id)
  }, [currentBase, pathname, router, searchParams])

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
        selectionExplicit,
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
  selectionExplicit: false,
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
