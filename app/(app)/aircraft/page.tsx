"use client"

import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react"
import type React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Plane, Loader2, Star, Plus, Trash2, ChevronRight } from "lucide-react"
import { useDebounce } from "@/hooks/use-debounce"
import {
  searchAircraftFromDB,
  type NormalizedAircraft,
  type AircraftRecord,
  getUserPreferences,
  toggleFavoriteAircraft,
  updateFlight,
  addCustomAircraftToDatabase,
  deleteAircraftFromDatabase,
} from "@/lib/db"
import { useReferenceAircraft, useFlights } from "@/hooks/data"
import { getAircraftType } from "@/lib/db/stores/reference/aircraft-types.store"
import { syncService } from "@/lib/sync"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/page-container"
import { SearchablePageHeader } from "@/components/searchable-page-header"
import { FastScroll, generateAlphabetItemsFromList } from "@/components/ui/fast-scroll"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { AircraftDetailPanel } from "@/components/aircraft-detail-panel"
import { AircraftNewForm } from "@/components/aircraft-new-form"
import { cn } from "@/lib/utils"
import { submitAircraftToServer } from "@/lib/submissions/submit"
import { SwipeableCard } from "@/components/swipeable-card"
import { useDeleteConfirmation } from "@/components/delete-confirmation-dialog"
import { usePageActive } from "@/hooks/use-page-active"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { GlassSearchButton } from "@/components/glass-search-button"
import { GlassContainer } from "@/components/ui/glass-container"

// Memoized swipeable aircraft card (matches crew card pattern)
interface AircraftCardProps {
  aircraft: NormalizedAircraft
  isRecent?: boolean
  isSelected?: boolean
  isFavorite?: boolean
  onSelect: (aircraft: NormalizedAircraft) => void
  onToggleFavorite?: (e: React.MouseEvent, registration: string) => void
  onDelete: () => void
}

const SwipeableAircraftCard = memo(function SwipeableAircraftCard({
  aircraft,
  isRecent = false,
  isSelected = false,
  isFavorite = false,
  onSelect,
  onToggleFavorite,
  onDelete,
}: AircraftCardProps) {
  return (
    <SwipeableCard
      id={`aircraft-${aircraft.registration || aircraft.icao24}`}
      onClick={() => onSelect(aircraft)}
      actions={[
        {
          icon: <Trash2 className="h-5 w-5" />,
          onClick: onDelete,
          variant: "destructive",
        },
      ]}
    >
      <button
        className={cn(
          "w-full text-left bg-card border border-border rounded-lg py-2 pl-3 pr-6 transition-all hover:bg-accent",
          isRecent &&
            "bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20 hover:bg-transparent",
          isSelected && "bg-primary/20 border-primary hover:bg-primary/20"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">{aircraft.registration || aircraft.icao24}</span>
              {aircraft.typecode && (
                <span className="text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded">{aircraft.typecode}</span>
              )}
              {aircraft.shortDescription && (
                <span className="text-xs text-muted-foreground font-mono">{aircraft.shortDescription}</span>
              )}
            </div>
            <div className="text-sm text-muted-foreground truncate mt-0.5">
              {[
                aircraft.wtc && `WTC:${aircraft.wtc}`,
                aircraft.wtg && `WTG:${aircraft.wtg}`,
                aircraft.operator,
              ].filter(Boolean).join(" · ") || "\u00A0"}
            </div>
          </div>
          {onToggleFavorite ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 hover:bg-primary/20 relative z-10 flex-shrink-0"
              onClick={(e: React.MouseEvent) => {
                e.preventDefault()
                e.stopPropagation()
                if (aircraft.registration) {
                  onToggleFavorite(e, aircraft.registration)
                }
              }}
            >
              <Star
                className={cn(
                  "h-4 w-4",
                  isFavorite
                    ? "fill-yellow-400 text-yellow-400"
                    : "text-muted-foreground/40"
                )}
              />
            </Button>
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          )}
        </div>
      </button>
    </SwipeableCard>
  )
})

export default function AircraftPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const selectMode = searchParams.get("select") === "true"
  const flightId = searchParams.get("flightId")
  const isDesktop = useIsDesktop()

  const scrollContainerRef = useRef<HTMLElement | null>(null)
  const scrollContainerCallbackRef = useCallback((el: HTMLElement | null) => {
    scrollContainerRef.current = el
  }, [])

  // Detail panel integration
  const {
    selectedId: selectedAircraftReg,
    setSelectedId: setSelectedAircraftReg,
    setDetailContent,
  } = useDetailPanel()

  const [searchQuery, setSearchQuery] = useState("")
  const [desktopSearchOpen, setDesktopSearchOpen] = useState(false)
  const debouncedSearchQuery = useDebounce(searchQuery, 150)

  // SWR hook for reference aircraft (same pattern as useFlights in logbook)
  const { aircraft: allAircraft, isLoading, refresh: refreshAircraft } = useReferenceAircraft()
  const { flights } = useFlights()

  const [favoriteRegs, setFavoriteRegs] = useState<Set<string>>(new Set())
  const { confirmDelete, handleDelete, DeleteDialog } = useDeleteConfirmation<NormalizedAircraft>()

  const [activeLetterKey, setActiveLetterKey] = useState<string | undefined>(undefined)
  const isFastScrollingRef = useRef(false)

  // FR24 online search state
  const [fr24Results, setFr24Results] = useState<AircraftRecord[]>([])
  const [isFr24Loading, setIsFr24Loading] = useState(false)

  // Counter to re-trigger local search after adding aircraft
  const [searchVersion, setSearchVersion] = useState(0)

  // Load preferences (favorites only) on mount
  useEffect(() => {
    getUserPreferences().then((prefs) => {
      const favs = prefs?.favoriteAircraft || []
      setFavoriteRegs(new Set(favs.map((r) => r.toUpperCase())))
    })
  }, [])

  // Derive recently used from actual flights (most recent first) — stable, no jump on click
  const recentlyUsed = useMemo(() => {
    if (flights.length === 0 || allAircraft.length === 0) return []
    const seen = new Set<string>()
    const recentRegs: string[] = []
    for (const flight of flights) {
      if (flight.aircraftReg && !seen.has(flight.aircraftReg.toUpperCase())) {
        seen.add(flight.aircraftReg.toUpperCase())
        recentRegs.push(flight.aircraftReg.toUpperCase())
        if (recentRegs.length >= 10) break
      }
    }
    const recent: NormalizedAircraft[] = []
    for (const reg of recentRegs) {
      const found = allAircraft.find((ac) => ac.registration?.toUpperCase() === reg)
      if (found) recent.push(found)
    }
    return recent
  }, [flights, allAircraft])

  // Sort aircraft with registrations alphabetically
  const allSortedAircraft = useMemo(() => {
    if (allAircraft.length === 0) return []
    return [...allAircraft]
      .filter((a) => a.registration)
      .sort((a, b) => a.registration.localeCompare(b.registration))
  }, [allAircraft])

  // Filtered aircraft for search mode (async via IndexedDB search)
  const [searchResults, setSearchResults] = useState<NormalizedAircraft[]>([])
  useEffect(() => {
    if (!debouncedSearchQuery.trim()) {
      setSearchResults([])
      return
    }
    let cancelled = false
    searchAircraftFromDB(debouncedSearchQuery, 500).then((results) => {
      if (!cancelled) {
        setSearchResults(
          [...results].sort((a, b) => {
            const regA = a.registration || a.icao24
            const regB = b.registration || b.icao24
            return regA.localeCompare(regB)
          })
        )
      }
    })
    return () => { cancelled = true }
  }, [debouncedSearchQuery, searchVersion])

  const filteredAircraft = debouncedSearchQuery.trim() ? searchResults : allSortedAircraft

  // FR24 online search: fires when local results are empty and query is non-empty
  useEffect(() => {
    if (!debouncedSearchQuery.trim() || filteredAircraft.length > 0) {
      setFr24Results([])
      setIsFr24Loading(false)
      return
    }

    let cancelled = false
    setIsFr24Loading(true)

    const searchFr24 = async () => {
      try {
        const res = await fetch(`/api/search/aircraft?q=${encodeURIComponent(debouncedSearchQuery)}`)
        if (!res.ok) throw new Error("FR24 search failed")
        const data = await res.json()
        if (!cancelled) {
          setFr24Results(data.results || [])
        }
      } catch {
        if (!cancelled) setFr24Results([])
      } finally {
        if (!cancelled) setIsFr24Loading(false)
      }
    }

    searchFr24()
    return () => { cancelled = true }
  }, [debouncedSearchQuery, filteredAircraft.length])

  // Favorite aircraft from the sorted list
  const favoriteAircraft = useMemo(() => {
    if (favoriteRegs.size === 0) return []
    return allSortedAircraft.filter((a) => favoriteRegs.has(a.registration.toUpperCase()))
  }, [allSortedAircraft, favoriteRegs])

  // Set of recently used registrations for fast lookup
  const recentRegistrations = useMemo(() => {
    return new Set(recentlyUsed.map((a) => a.registration.toUpperCase()))
  }, [recentlyUsed])

  // Recently used excluding favorites (shown in their own section)
  const recentNonFavorites = useMemo(() => {
    if (favoriteRegs.size === 0) return recentlyUsed
    return recentlyUsed.filter((a) => !favoriteRegs.has(a.registration.toUpperCase()))
  }, [recentlyUsed, favoriteRegs])

  // Browse list excludes favorites and recently used (they're shown in their own sections above)
  const browseAircraft = useMemo(() => {
    return allSortedAircraft.filter((a) => {
      const regUpper = a.registration.toUpperCase()
      return !favoriteRegs.has(regUpper) && !recentRegistrations.has(regUpper)
    })
  }, [allSortedAircraft, favoriteRegs, recentRegistrations])

  // The list to virtualize: search results or browse list (excluding recently used)
  const displayAircraft = debouncedSearchQuery.trim() ? filteredAircraft : browseAircraft

  // Generate FastScroll alphabet items from the full sorted list (including favorites/recently used)
  const fastScrollItems = useMemo(() => {
    if (allSortedAircraft.length === 0) return []
    return generateAlphabetItemsFromList(
      allSortedAircraft.map((a) => a.registration),
      { numberPosition: "start" }
    )
  }, [allSortedAircraft])

  // Pre-compute letter -> virtual list index mapping for fast scroll
  const letterIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    browseAircraft.forEach((aircraft, index) => {
      const firstChar = aircraft.registration[0]?.toUpperCase()
      const letter = firstChar && /[A-Z]/.test(firstChar) ? firstChar : "#"
      if (!map.has(letter)) {
        map.set(letter, index)
      }
    })
    return map
  }, [browseAircraft])

  // Measure scroll margin: height of non-virtualized content above the virtual list
  const aboveVirtualRef = useRef<HTMLDivElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)

  useEffect(() => {
    const el = aboveVirtualRef.current
    const scrollEl = scrollContainerRef.current
    if (!el || !scrollEl) {
      setScrollMargin(0)
      return
    }

    const updateMargin = () => {
      const scrollRect = scrollEl.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      const margin = (elRect.bottom - scrollRect.top) + scrollEl.scrollTop
      setScrollMargin(margin)
    }

    updateMargin()
    const observer = new ResizeObserver(updateMargin)
    observer.observe(el)
    return () => observer.disconnect()
  }, [debouncedSearchQuery, allAircraft, recentlyUsed])

  // Virtual list
  const rowVirtualizer = useVirtualizer({
    count: displayAircraft.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 60,
    overscan: 10,
    scrollMargin,
  })

  const virtualItems = rowVirtualizer.getVirtualItems()

  // Find selected aircraft from SWR data for the detail panel
  const selectedAircraft = useMemo(() => {
    if (!selectedAircraftReg) return null
    const regUpper = selectedAircraftReg.toUpperCase()
    return allAircraft.find((a) =>
      a.registration.toUpperCase() === regUpper ||
      a.registration.toUpperCase().replace(/-/g, "") === regUpper.replace(/-/g, "")
    ) || null
  }, [selectedAircraftReg, allAircraft])

  // Only sync detail panel when this page is active — prevents hidden pages from
  // overwriting the active page's detail content when shared selectedId changes.
  const isActive = usePageActive("/aircraft")

  // Sync detail panel content — extracted so usePageActive can re-trigger it
  const syncDetailPanel = useCallback(() => {
    if (!isActive) return
    if (selectMode) return

    if (isLoading) {
      setDetailContent(
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      )
      return
    }

    if (allSortedAircraft.length === 0) {
      setDetailContent(
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
          <Plane className="h-12 w-12 mb-4" />
          <p>No aircraft found</p>
        </div>
      )
      return
    }

    if (selectedAircraft) {
      setDetailContent(
        <AircraftDetailPanel
          aircraft={selectedAircraft}
          onUpdated={refreshAircraft}
          onBack={() => setSelectedAircraftReg(null)}
        />
      )
    } else {
      setDetailContent(null)
    }
  }, [isActive, selectMode, selectedAircraft, allSortedAircraft, isLoading, setDetailContent, setSelectedAircraftReg, refreshAircraft])

  // Update detail content when selection, data, or active state changes
  useEffect(() => {
    syncDetailPanel()
  }, [syncDetailPanel])

  // Track active letter from virtualizer scroll position
  useEffect(() => {
    if (debouncedSearchQuery.trim()) return

    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    let ticking = false
    const handleScroll = () => {
      if (ticking || isFastScrollingRef.current) return

      ticking = true
      requestAnimationFrame(() => {
        const items = rowVirtualizer.getVirtualItems()
        if (items.length > 0) {
          const scrollOffset = rowVirtualizer.scrollOffset ?? 0
          // Find first visible item (skip overscan items above viewport)
          let topItem = items[0]
          for (const item of items) {
            if (item.start + scrollMargin >= scrollOffset) {
              topItem = item
              break
            }
          }
          const aircraft = displayAircraft[topItem.index]
          if (aircraft) {
            const firstChar = (aircraft.registration || aircraft.icao24)?.[0]?.toUpperCase()
            if (firstChar && /[A-Z]/.test(firstChar)) {
              setActiveLetterKey(firstChar)
            } else {
              setActiveLetterKey("#")
            }
          }
        }
        ticking = false
      })
    }

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true })
    handleScroll()

    return () => scrollContainer.removeEventListener("scroll", handleScroll)
  }, [displayAircraft, debouncedSearchQuery, rowVirtualizer, scrollMargin])

  // Handle FastScroll selection - uses scrollToIndex
  const handleFastScrollSelect = useCallback((letter: string) => {
    const index = letterIndexMap.get(letter)
    if (index !== undefined) {
      isFastScrollingRef.current = true
      setActiveLetterKey(letter)
      rowVirtualizer.scrollToIndex(index, {
        align: "start",
        behavior: "auto",
      })
      setTimeout(() => {
        isFastScrollingRef.current = false
      }, 150)
    }
  }, [letterIndexMap, rowVirtualizer])



  const handleToggleFavorite = useCallback(async (e: React.MouseEvent, registration: string) => {
    e.preventDefault()
    e.stopPropagation()
    const isNowFavorite = await toggleFavoriteAircraft(registration)
    setFavoriteRegs((prev) => {
      const next = new Set(prev)
      const regUpper = registration.toUpperCase()
      if (isNowFavorite) {
        next.add(regUpper)
      } else {
        next.delete(regUpper)
      }
      return next
    })
  }, [])

  const performDelete = async (aircraft: NormalizedAircraft) => {
    if (aircraft.registration) {
      await deleteAircraftFromDatabase(aircraft.registration)
      await refreshAircraft()
    }
  }

  const handleSelectAircraft = useCallback(
    async (aircraft: NormalizedAircraft) => {
      if (selectMode && flightId) {
        try {
          await updateFlight(flightId, {
            aircraftReg: aircraft.registration,
            aircraftType: aircraft.typecode,
          })
          syncService.notifyDataChange()
        } catch (error) {
          console.error("Failed to update flight with aircraft:", error)
        }
        router.back()
      } else {
        setSelectedAircraftReg(aircraft.registration || aircraft.icao24)
      }
    },
    [selectMode, flightId, router, setSelectedAircraftReg],
  )

  const handleSelectFr24 = useCallback(
    async (record: AircraftRecord) => {
      // Enrich with ICAO type data from Dexie before storing
      let enrichedRecord = { ...record }
      if (record.typecode) {
        const typeInfo = await getAircraftType(record.typecode)
        if (typeInfo) {
          enrichedRecord = {
            ...enrichedRecord,
            shortDescription: typeInfo.description,
            wtc: typeInfo.wtc,
            wtg: typeInfo.wtg,
            manufacturerCode: typeInfo.manufacturer,
          }
        }
      }

      const submissionId = await addCustomAircraftToDatabase(enrichedRecord)

      // Fire-and-forget server submission for shared enrichment
      submitAircraftToServer({
        submissionId,
        registration: record.registration,
        typecode: record.typecode,
        icao24: record.icao24,
        operator: record.operator,
      })

      // Refresh SWR cache so the new aircraft appears in the list
      await refreshAircraft()

      const reg = record.registration?.toUpperCase() || record.icao24 || ""

      if (selectMode && flightId) {
        const normalized = allAircraft.find((a) => a.registration.toUpperCase() === reg) ||
          { registration: record.registration || "", icao24: record.icao24 || "", typecode: record.typecode || "", shortDescription: enrichedRecord.shortDescription || "", wtc: enrichedRecord.wtc || "", wtg: enrichedRecord.wtg || "", manufacturerCode: enrichedRecord.manufacturerCode || "", operator: record.operator || "" }
        handleSelectAircraft(normalized)
      } else {
        // Keep search bar filled, clear FR24 results, re-trigger local search
        setFr24Results([])
        setSearchVersion((v) => v + 1)
        setSelectedAircraftReg(reg)
      }
    },
    [selectMode, flightId, handleSelectAircraft, setSelectedAircraftReg, refreshAircraft, allAircraft],
  )

  const addAircraftUrl = selectMode
    ? `/aircraft/new?select=true${flightId ? `&flightId=${flightId}` : ""}${searchQuery ? `&reg=${encodeURIComponent(searchQuery)}` : ""}`
    : `/aircraft/new${searchQuery ? `?reg=${encodeURIComponent(searchQuery)}` : ""}`

  const handleAddClick = useCallback(() => {
    if (isDesktop && !selectMode) {
      setDetailContent(
        <AircraftNewForm
          prefilledReg={searchQuery}
          isDetailPanel
          onSave={async (registration) => {
            // Refresh SWR cache so the new aircraft appears in the list
            await refreshAircraft()
            setSelectedAircraftReg(registration)
          }}
          onCancel={() => {
            if (selectedAircraft) {
              setDetailContent(
                <AircraftDetailPanel aircraft={selectedAircraft} onUpdated={refreshAircraft} onBack={() => setSelectedAircraftReg(null)} />
              )
            } else {
              setDetailContent(null)
            }
          }}
          onViewExisting={(registration) => {
            setSelectedAircraftReg(registration)
          }}
        />
      )
    } else {
      router.push(addAircraftUrl)
    }
  }, [isDesktop, selectMode, searchQuery, router, addAircraftUrl, selectedAircraft, setDetailContent, setSelectedAircraftReg, refreshAircraft])

  const showFavorites = !debouncedSearchQuery && favoriteAircraft.length > 0
  const showRecentlyUsed = !debouncedSearchQuery && recentNonFavorites.length > 0
  const showFastScroll = fastScrollItems.length > 1 && !debouncedSearchQuery.trim()

  // Desktop floating glass bar actions — expandable search + glass add button
  const aircraftActions = useMemo(() => (
    <>
      <GlassSearchButton
        isOpen={desktopSearchOpen}
        onToggle={() => setDesktopSearchOpen(prev => !prev)}
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search aircraft..."
      />
      <GlassContainer cornerRadius={22}>
        <Button variant="ghost" size="icon" onClick={handleAddClick} className="h-10 w-10">
          <Plus className="h-4 w-4" />
        </Button>
      </GlassContainer>
    </>
  ), [handleAddClick, searchQuery, desktopSearchOpen])

  useRegisterMainActions(aircraftActions, isActive)

  return (
    <PageContainer
      header={
        isDesktop ? undefined : (
          <SearchablePageHeader
            title={selectMode ? "Select Aircraft" : "Aircraft"}
            showBack={selectMode}
            onBack={selectMode ? () => router.back() : undefined}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onAdd={handleAddClick}
            searchPlaceholder="Search registration, type code..."
          />
        )
      }
      rightContent={
        showFastScroll ? (
          <FastScroll
            items={fastScrollItems}
            activeKey={activeLetterKey}
            onSelect={handleFastScrollSelect}
            indicatorPosition="left"
          />
        ) : null
      }
      mainRef={scrollContainerCallbackRef}
    >
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 p-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
      ) : (
        <div>
          <div className="px-4 pt-4 pb-safe">
            {/* Non-virtualized content above the virtual list */}
            <div ref={aboveVirtualRef}>
              {!debouncedSearchQuery.trim() && (
                <div className="space-y-3">
                  {/* Favorites Section */}
                  {showFavorites && (
                    <div className="space-y-1.5">
                      <h2 className="text-xs font-semibold text-primary uppercase px-1 flex items-center gap-1">
                        <Star className="h-3 w-3 fill-primary" /> Favorites
                      </h2>
                      <div className="space-y-1">
                        {favoriteAircraft.map((aircraft) => (
                          <SwipeableAircraftCard
                            key={`fav-${aircraft.registration}`}
                            aircraft={aircraft}
                            onSelect={handleSelectAircraft}
                            onDelete={() => confirmDelete(aircraft)}
                            isFavorite
                            onToggleFavorite={handleToggleFavorite}
                            isSelected={!selectMode && selectedAircraftReg === (aircraft.registration || aircraft.icao24)}
                          />
                        ))}
                      </div>
                      <div className="border-t border-border/50 my-4" />
                    </div>
                  )}

                  {/* Recent Section (excluding favorites) */}
                  {showRecentlyUsed && (
                    <div className="space-y-1.5">
                      <h2 className="text-xs font-semibold text-muted-foreground uppercase px-1">Recent</h2>
                      <div className="space-y-1">
                        {recentNonFavorites.map((aircraft) => (
                          <SwipeableAircraftCard
                            key={`recent-${aircraft.registration || aircraft.icao24}`}
                            aircraft={aircraft}
                            onSelect={handleSelectAircraft}
                            onDelete={() => confirmDelete(aircraft)}
                            isRecent
                            isFavorite={favoriteRegs.has(aircraft.registration.toUpperCase())}
                            onToggleFavorite={handleToggleFavorite}
                            isSelected={!selectMode && selectedAircraftReg === (aircraft.registration || aircraft.icao24)}
                          />
                        ))}
                      </div>
                      <div className="border-t border-border my-4" />
                    </div>
                  )}
                </div>
              )}

              {debouncedSearchQuery.trim() && (
                <div className="space-y-3">
                  {/* FR24 fallback — shown when no local results */}
                  {filteredAircraft.length === 0 && isFr24Loading && (
                    <div className="flex items-center gap-2 py-4 justify-center">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span className="text-sm text-muted-foreground">Searching...</span>
                    </div>
                  )}

                  {filteredAircraft.length === 0 && !isFr24Loading && fr24Results.length > 0 && (
                    <div className="space-y-1">
                      {fr24Results.map((record) => (
                        <div
                          key={record.registration || record.icao24}
                          onClick={() => handleSelectFr24(record)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e: React.KeyboardEvent) => {
                            if (e.key === "Enter" || e.key === " ") handleSelectFr24(record)
                          }}
                          className="w-full text-left rounded-lg py-2 pl-3 pr-6 transition-all cursor-pointer bg-card border border-border hover:bg-accent"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground">{record.registration || record.icao24}</span>
                            {record.typecode && (
                              <span className="text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded">{record.typecode}</span>
                            )}
                          </div>
                          {record.operator && (
                            <div className="text-sm text-muted-foreground truncate mt-0.5">{record.operator}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Empty state — no local or online results */}
                  {filteredAircraft.length === 0 && !isFr24Loading && fr24Results.length === 0 && (
                    <div className="flex flex-col items-center gap-3 py-8">
                      <Plane className="h-8 w-8 text-muted-foreground/50" />
                      <p className="text-sm text-muted-foreground">No aircraft found</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleAddClick}
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Add Aircraft
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Virtualized aircraft list */}
            <div>
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  width: "100%",
                  position: "relative",
                }}
              >
                {virtualItems.map((virtualRow) => {
                  const aircraft = displayAircraft[virtualRow.index]
                  if (!aircraft) return null
                  return (
                    <div
                      key={`${aircraft.registration || aircraft.icao24}-${virtualRow.index}`}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)`,
                      }}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                    >
                      <div className="pb-1">
                        <SwipeableAircraftCard
                          aircraft={aircraft}
                          onSelect={handleSelectAircraft}
                          onDelete={() => confirmDelete(aircraft)}
                          isFavorite={favoriteRegs.has(aircraft.registration.toUpperCase())}
                          onToggleFavorite={handleToggleFavorite}
                          isSelected={!selectMode && selectedAircraftReg === (aircraft.registration || aircraft.icao24)}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      <DeleteDialog
        title="Delete Aircraft"
        description="Are you sure you want to remove this aircraft from your database? This action cannot be undone."
        onConfirm={() => handleDelete(performDelete)}
      />
    </PageContainer>
  )
}
