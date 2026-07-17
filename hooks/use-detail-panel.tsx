"use client"

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { KEEPALIVE_DETAIL_ROUTES } from "@/components/keep-alive-routes"

interface SetSelectedIdOptions {
  /**
   * Pass `false` for PROGRAMMATIC selections (e.g. "auto-select the first
   * section so the desktop panel isn't empty"). A non-explicit selection is
   * stored in state + sessionStorage only — it does NOT mark the route as
   * explicitly selected and does NOT write `?selected=` to the URL. Both of
   * those signals open the full-screen mobile detail overlay when the
   * viewport crosses below the split breakpoint (iPad Split View, window
   * resize), which must only ever happen for selections the user actually
   * made. Defaults to true (user taps).
   */
  explicit?: boolean
}

interface DetailPanelContextType {
  // The currently rendered detail content
  detailContent: ReactNode | null
  // Set the detail content to render
  setDetailContent: (content: ReactNode | null) => void
  // The selected item ID (stored in URL as ?selected=... for explicit selections)
  selectedId: string | null
  // Set the selected item (updates URL unless opts.explicit === false)
  setSelectedId: (id: string | null, opts?: SetSelectedIdOptions) => void
  /**
   * True when the current route's selection was set explicitly this session
   * (user tapped an item / created one) rather than restored from
   * sessionStorage or auto-selected. The mobile overlay opens for explicit
   * selections immediately from state — it must NOT wait for the
   * router.replace URL round-trip, which can be slow or dropped on a phone
   * (offline PWA, service worker, backgrounding) while desktop renders
   * straight from state.
   */
  selectionExplicit: boolean
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

  const setSelectedId = useCallback((id: string | null, opts?: SetSelectedIdOptions) => {
    const explicit = opts?.explicit !== false

    setSelections(prev => ({ ...prev, [currentBase]: id }))
    const nextExplicit = explicit && !!id
    setExplicitBases(prev =>
      prev[currentBase] === nextExplicit ? prev : { ...prev, [currentBase]: nextExplicit }
    )

    // Update URL — explicit selections only. A programmatic default writing
    // ?selected= would re-open the mobile overlay on a desktop→mobile resize.
    if (explicit) {
      const params = new URLSearchParams(searchParams.toString())
      if (id) {
        params.set("selected", id)
      } else {
        params.delete("selected")
      }

      const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname
      router.replace(newUrl || "/", { scroll: false })
    }

    // Persist to sessionStorage (keyed by base route, matching the map).
    // Transient sentinel selections ("__new__" — the mobile create overlay)
    // are session-only UI state and must not be restored on reload.
    if (!id?.startsWith("__")) {
      saveSelection(currentBase, id)
    }
  }, [currentBase, pathname, router, searchParams])

  // Re-sync ?selected= into the URL when returning to a keep-alive tab whose
  // EXPLICIT selection survived in state (tab navigation links carry no query,
  // so a copied URL used to lose the selection). Explicit-only on the exact
  // base pathname: restored/auto selections must stay out of the URL (see
  // SetSelectedIdOptions), and sub-routes (/aircraft/new) keep their own URL.
  useEffect(() => {
    if (pathname !== currentBase) return
    if (!KEEPALIVE_DETAIL_ROUTES.includes(currentBase)) return
    if (searchParams.has("selected")) return
    const sel = selections[currentBase]
    if (!sel || sel.startsWith("__") || !explicitBases[currentBase]) return
    const params = new URLSearchParams(searchParams.toString())
    params.set("selected", sel)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [pathname, currentBase, searchParams, selections, explicitBases, router])

  // Reset detail content when the base route changes — EXCEPT between two
  // keep-alive routes that own detail content (the activated page re-sets its
  // own panel via its usePageActive callback; clearing would flash). Routes
  // derive from the shared registry in keep-alive-routes.ts, so pages added
  // to the keep-alive set can't silently miss this list again.
  const prevPathnameRef = useRef(pathname)
  useEffect(() => {
    const prevBase = "/" + (prevPathnameRef.current?.split("/").filter(Boolean)[0] || "")
    const currBase = "/" + (pathname?.split("/").filter(Boolean)[0] || "")
    prevPathnameRef.current = pathname

    if (KEEPALIVE_DETAIL_ROUTES.includes(prevBase) && KEEPALIVE_DETAIL_ROUTES.includes(currBase)) {
      return
    }

    setDetailContent(null)
  }, [pathname])

  return (
    <DetailPanelContext.Provider
      value={{
        detailContent,
        setDetailContent,
        selectedId,
        setSelectedId,
        selectionExplicit,
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
}

export function useDetailPanel() {
  const context = useContext(DetailPanelContext)
  // Return default value when used outside provider (e.g., SSR or mobile layout)
  return context ?? defaultValue
}
