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

  // ── System back / Android's edge-swipe should UNDO THE LAST MOVE ──────────
  //
  // Opening a detail used to `router.replace`, which writes no history entry —
  // so a swipe-back from an open flight skipped straight past the logbook to
  // whatever came before it. Opening now PUSHES, and the `?selected=` param
  // going away again is what closes the detail. Together those make one back
  // gesture mean "close this and go back to the list".
  //
  // `pushedBase` remembers that WE own the current entry, so the in-app close
  // button can go back rather than replacing (which would leave a dead entry
  // that swallows the next back press). It is cleared on any route change, so
  // a stale ref can only ever fall back to the old replace behaviour.
  const pushedBaseRef = useRef<string | null>(null)
  const lastUrlSelectedRef = useRef<string | null>(searchParams.get("selected"))
  const lastBaseRef = useRef(currentBase)
  const backClearedRef = useRef(false)
  /**
   * True from the moment we route a selection until `searchParams` catches up.
   * The re-sync effect below runs on the state change from the SAME tap, before
   * the router has updated the params — so it saw "explicit selection, no
   * `?selected=` in the URL" and helpfully wrote one with `router.replace`,
   * landing on top of the `push` we had just issued and erasing the history
   * entry. That is why the back gesture still skipped the section.
   */
  const pendingUrlWriteRef = useRef(false)

  useEffect(() => {
    const urlSelected = searchParams.get("selected")
    const prev = lastUrlSelectedRef.current
    const prevBase = lastBaseRef.current
    lastUrlSelectedRef.current = urlSelected
    lastBaseRef.current = currentBase
    // The router has caught up with whatever we last wrote.
    pendingUrlWriteRef.current = false
    // Only a back WITHIN a section closes its detail. Leaving the section drops
    // `?selected=` too, and treating that as a close would wipe the section we
    // just arrived at — including its stored selection.
    if (prevBase !== currentBase) {
      pushedBaseRef.current = null
      return
    }
    if (urlSelected !== null || prev === null) return
    backClearedRef.current = true
    pushedBaseRef.current = null
    setSelections(p => (p[currentBase] == null ? p : { ...p, [currentBase]: null }))
    setExplicitBases(p => (p[currentBase] ? { ...p, [currentBase]: false } : p))
    saveSelection(currentBase, null)
  }, [searchParams, currentBase])

  const setSelectedId = useCallback((id: string | null, opts?: SetSelectedIdOptions) => {
    const explicit = opts?.explicit !== false
    backClearedRef.current = false

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
      // "Is a detail OPEN?" is the URL, not the stored selection. A section
      // remembers its last selection in state + sessionStorage even while the
      // detail is closed, so keying off that made the very first tap after a
      // reload look like "switching items" — it replaced, wrote no history
      // entry, and the back gesture sailed straight past the section. The
      // `?selected=` param is written for every explicit open, so its presence
      // is exactly "we already own a pushed entry here".
      const detailIsOpen = searchParams.has("selected")
      pendingUrlWriteRef.current = true
      if (id && !detailIsOpen) {
        // Opening a detail is a move, so it gets a history entry to undo.
        pushedBaseRef.current = currentBase
        router.push(newUrl || "/", { scroll: false })
      } else if (!id && pushedBaseRef.current === currentBase) {
        // Closing it in-app: go back rather than replace, so the entry we
        // pushed is consumed instead of lingering as a dead back press.
        pushedBaseRef.current = null
        router.back()
      } else {
        // Switching between items isn't a new move — it would pile up an entry
        // per tap and turn back into a tour of everything you looked at.
        router.replace(newUrl || "/", { scroll: false })
      }
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
    // A back gesture just took `?selected=` away. This effect runs in the same
    // commit as the one that clears the selection, so it still sees the old
    // state — without this guard it would put the param straight back and the
    // detail would refuse to close.
    if (backClearedRef.current) return
    // A selection we just routed hasn't reached `searchParams` yet — writing
    // the param again here would replace the entry that write pushed.
    if (pendingUrlWriteRef.current) return
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

  // Memoized: this provider wraps the whole shell, so a fresh value object per
  // render re-rendered every keep-alive page on any state change here.
  const value = useMemo(
    () => ({
      detailContent,
      setDetailContent,
      selectedId,
      setSelectedId,
      selectionExplicit,
    }),
    [detailContent, selectedId, setSelectedId, selectionExplicit],
  )

  return (
    <DetailPanelContext.Provider value={value}>
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
