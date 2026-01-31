"use client"

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

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

  // Get selected ID from URL or sessionStorage
  const selectedIdFromUrl = searchParams.get("selected")
  const [selectedId, setSelectedIdState] = useState<string | null>(selectedIdFromUrl)

  // Track when we're updating URL to avoid sync race condition
  const pendingUpdateRef = useRef<string | null | undefined>(undefined)

  // Sync selectedId with URL params (only when URL changes externally)
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
    if (urlSelected !== selectedId) {
      setSelectedIdState(urlSelected)
    }
  }, [searchParams, selectedId])

  // On pathname change, restore selection from sessionStorage if not in URL
  useEffect(() => {
    // Clear pending update on pathname change
    pendingUpdateRef.current = undefined

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

  // Reset state when pathname changes (different page)
  useEffect(() => {
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

  // Register that this page supports detail panel
  useEffect(() => {
    setHasDetailSupport(true)
    return () => setHasDetailSupport(false)
  }, [setHasDetailSupport])

  // Auto-select first item if nothing selected and items loaded
  useEffect(() => {
    if (!isLoading && items.length > 0 && !selectedId) {
      setSelectedId(items[0].id)
    }
  }, [isLoading, items, selectedId, setSelectedId])

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
    } else if (items.length > 0) {
      // Selection not found, select first item
      setSelectedId(items[0].id)
    }
  }, [selectedId, items, isLoading, renderDetail, setDetailContent, setSelectedId, emptyMessage])

  return {
    selectedId,
    setSelectedId,
    selectedItem: items.find(item => item.id === selectedId) || null,
  }
}
