"use client"

import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react"
import type React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Search, Plane, Loader2, Star, Plus, Globe } from "lucide-react"
import { useDebounce } from "@/hooks/use-debounce"
import { Input } from "@/components/ui/input"
import {
  getAircraftDatabase,
  searchAircraft,
  type AircraftData,
  type NormalizedAircraft,
  type AircraftRecord,
  normalizeAircraft,
  setProgressCallback,
  getUserPreferences,
  saveUserPreferences,
  toggleFavoriteAircraft,
  getFavoriteAircraft,
  updateFlight,
  addCustomAircraftToDatabase,
} from "@/lib/db"
import { syncService } from "@/lib/sync"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/page-container"
import { StandardPageHeader } from "@/components/standard-page-header"
import { FastScroll, generateAlphabetItemsFromList } from "@/components/ui/fast-scroll"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { AircraftDetailPanel } from "@/components/aircraft-detail-panel"
import { cn } from "@/lib/utils"

// Memoized aircraft card to prevent unnecessary re-renders during virtualization
interface AircraftCardProps {
  aircraft: NormalizedAircraft
  isRecent?: boolean
  isSelected?: boolean
  isFavorite?: boolean
  compact?: boolean
  onSelect: (aircraft: NormalizedAircraft) => void
  onToggleFavorite?: (e: React.MouseEvent, registration: string) => void
}

const AircraftCard = memo(function AircraftCard({
  aircraft,
  isRecent = false,
  isSelected = false,
  isFavorite = false,
  compact = false,
  onSelect,
  onToggleFavorite,
}: AircraftCardProps) {
  return (
    <div
      id={`aircraft-${aircraft.registration || aircraft.icao24}`}
      onClick={() => onSelect(aircraft)}
      role="button"
      tabIndex={0}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          onSelect(aircraft)
        }
      }}
      className={cn(
        "w-full text-left rounded-lg transition-all cursor-pointer active:scale-[0.98]",
        compact ? "py-1.5 pl-3 pr-6" : "py-2 pl-3 pr-6",
        isRecent
          ? "bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20"
          : "bg-card border border-border hover:bg-accent",
        isSelected && "bg-primary/20 border-primary"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">{aircraft.registration || aircraft.icao24}</span>
            {aircraft.typecode && (
              <span className="text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded">{aircraft.typecode}</span>
            )}
          </div>
          {!compact && (
            <div className="text-sm text-muted-foreground truncate mt-0.5">
              {aircraft.icao24 && <span className="font-mono">{aircraft.icao24}</span>}
              {aircraft.icao24 && aircraft.shortType && <span> · </span>}
              {aircraft.shortType && <span>{aircraft.shortType}</span>}
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 hover:bg-primary/20 relative z-10 flex-shrink-0"
          onClick={(e: React.MouseEvent) => {
            e.preventDefault()
            e.stopPropagation()
            if (onToggleFavorite && aircraft.registration) {
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
      </div>
    </div>
  )
})

export default function AircraftPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const selectMode = searchParams.get("select") === "true"
  const flightId = searchParams.get("flightId")
  const selectedFromUrl = searchParams.get("selected")
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

  // Handle selection from URL (when redirected from mobile detail view)
  useEffect(() => {
    if (selectedFromUrl && isDesktop) {
      setSelectedAircraftReg(selectedFromUrl)
      const url = new URL(window.location.href)
      url.searchParams.delete("selected")
      window.history.replaceState({}, "", url.toString())
    }
  }, [selectedFromUrl, isDesktop, setSelectedAircraftReg])

  const [searchQuery, setSearchQuery] = useState("")
  const debouncedSearchQuery = useDebounce(searchQuery, 150)
  const [allAircraft, setAllAircraft] = useState<AircraftData[]>([])
  const [recentlyUsed, setRecentlyUsed] = useState<NormalizedAircraft[]>([])
  const [favoriteRegs, setFavoriteRegs] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(true)
  const [loadingProgress, setLoadingProgress] = useState({
    stage: "",
    percent: 0,
    count: 0,
  })

  const [activeLetterKey, setActiveLetterKey] = useState<string | undefined>(undefined)
  const isFastScrollingRef = useRef(false)

  // FR24 online search state
  const [fr24Results, setFr24Results] = useState<AircraftRecord[]>([])
  const [isFr24Loading, setIsFr24Loading] = useState(false)

  useEffect(() => {
    let mounted = true
    setProgressCallback((progress) => {
      if (mounted) {
        setLoadingProgress({
          stage: progress.stage,
          percent: progress.percent,
          count: progress.count || 0,
        })
      }
    })

    async function loadDatabase() {
      setIsLoading(true)
      try {
        const aircraft = await getAircraftDatabase()
        if (mounted) {
          setAllAircraft(aircraft)
          const prefs = await getUserPreferences()
          const recentRegs = prefs?.recentlyUsedAircraft || []
          const recentAc: NormalizedAircraft[] = []
          for (const reg of recentRegs) {
            const found = aircraft.find((ac) => ac.reg?.toUpperCase() === reg.toUpperCase())
            if (found) recentAc.push(normalizeAircraft(found))
          }
          setRecentlyUsed(recentAc)
          const favRegs = prefs?.favoriteAircraft || []
          setFavoriteRegs(new Set(favRegs.map((r) => r.toUpperCase())))
        }
      } catch (error) {
        console.error("[Aircraft Page] Failed to load database:", error)
      } finally {
        if (mounted) setIsLoading(false)
        setProgressCallback(null)
      }
    }
    loadDatabase()
    return () => {
      mounted = false
      setProgressCallback(null)
    }
  }, [])

  // Normalize and sort aircraft with registrations alphabetically.
  // Only include aircraft that have an actual registration for the browse list;
  // the full dataset (~615k records) exceeds browser max scroll height (~33M px).
  // Aircraft without registrations (ICAO24-only) are still findable via search.
  const allSortedAircraft = useMemo(() => {
    if (allAircraft.length === 0) return []
    return allAircraft
      .filter((a) => a.reg)
      .map(normalizeAircraft)
      .sort((a, b) => a.registration.localeCompare(b.registration))
  }, [allAircraft])

  // Filtered aircraft for search mode
  const filteredAircraft = useMemo(() => {
    if (!debouncedSearchQuery.trim()) return allSortedAircraft
    const results = searchAircraft(allAircraft, debouncedSearchQuery, 500)
    return [...results].sort((a, b) => {
      const regA = a.registration || a.icao24
      const regB = b.registration || b.icao24
      return regA.localeCompare(regB)
    })
  }, [allAircraft, allSortedAircraft, debouncedSearchQuery])

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

  // Generate FastScroll alphabet items from the browse list
  const fastScrollItems = useMemo(() => {
    if (browseAircraft.length === 0) return []
    return generateAlphabetItemsFromList(
      browseAircraft.map((a) => a.registration),
      { numberPosition: "start" }
    )
  }, [browseAircraft])

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
    estimateSize: () => 40, // Compact single-line card (py-1.5 + content + pb-1 gap)
    overscan: 10,
    scrollMargin,
  })

  const virtualItems = rowVirtualizer.getVirtualItems()

  // Auto-select first aircraft when loading (desktop only, not in select mode)
  useEffect(() => {
    if (isDesktop && !selectMode && !isLoading && allSortedAircraft.length > 0 && !selectedAircraftReg) {
      const first = allSortedAircraft[0]
      setSelectedAircraftReg(first.registration || first.icao24)
    }
  }, [isDesktop, selectMode, isLoading, allSortedAircraft, selectedAircraftReg, setSelectedAircraftReg])

  // Update detail content when selection changes (desktop only)
  useEffect(() => {
    if (!isDesktop || selectMode) return

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

    if (selectedAircraftReg) {
      setDetailContent(
        <AircraftDetailPanel registration={selectedAircraftReg} />
      )
    } else if (allSortedAircraft.length > 0) {
      const first = allSortedAircraft[0]
      setSelectedAircraftReg(first.registration || first.icao24)
    }
  }, [isDesktop, selectMode, selectedAircraftReg, allSortedAircraft, isLoading, setDetailContent, setSelectedAircraftReg])

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

  // Scroll to selected aircraft from URL after data loads
  useEffect(() => {
    if (selectedFromUrl && isDesktop && !isLoading && allSortedAircraft.length > 0) {
      const index = allSortedAircraft.findIndex(
        (a) => (a.registration || a.icao24) === selectedFromUrl
      )
      if (index !== -1) {
        setTimeout(() => {
          rowVirtualizer.scrollToIndex(index, { align: "center", behavior: "auto" })
        }, 100)
      }
    }
  }, [selectedFromUrl, isDesktop, isLoading, allSortedAircraft, rowVirtualizer])

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

  const handleSelectAircraft = useCallback(
    async (aircraft: NormalizedAircraft) => {
      if (aircraft.registration) {
        const prefs = await getUserPreferences()
        const recentRegs = prefs?.recentlyUsedAircraft || []
        const filtered = recentRegs.filter((r) => r.toUpperCase() !== aircraft.registration.toUpperCase())
        const updated = [aircraft.registration, ...filtered].slice(0, 10)
        await saveUserPreferences({ recentlyUsedAircraft: updated })
      }
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
      } else if (isDesktop) {
        setSelectedAircraftReg(aircraft.registration || aircraft.icao24)
      } else {
        router.push(`/aircraft/${encodeURIComponent(aircraft.registration || aircraft.icao24)}`)
      }
    },
    [selectMode, flightId, router, isDesktop, setSelectedAircraftReg],
  )

  const handleSelectFr24 = useCallback(
    async (record: AircraftRecord) => {
      await addCustomAircraftToDatabase(record)

      // Update local state so the aircraft appears in the list immediately
      const newAircraftData: AircraftData = {
        icao24: record.icao24,
        reg: record.registration,
        icaotype: record.typecode || null,
        short_type: record.operator || null,
      }
      setAllAircraft((prev) => [...prev, newAircraftData])

      const normalized: NormalizedAircraft = {
        registration: record.registration,
        icao24: record.icao24,
        typecode: record.typecode,
        shortType: record.operator || "",
      }

      if (selectMode && flightId) {
        handleSelectAircraft(normalized)
      } else {
        // Clear search to reveal the newly added aircraft in the browse list
        setSearchQuery("")
        setFr24Results([])
        if (isDesktop) {
          setSelectedAircraftReg(normalized.registration || normalized.icao24)
        }
      }
    },
    [selectMode, flightId, isDesktop, handleSelectAircraft, setSelectedAircraftReg],
  )

  const addAircraftUrl = selectMode
    ? `/aircraft/new?select=true${flightId ? `&flightId=${flightId}` : ""}${searchQuery ? `&reg=${encodeURIComponent(searchQuery)}` : ""}`
    : `/aircraft/new${searchQuery ? `?reg=${encodeURIComponent(searchQuery)}` : ""}`

  const showFavorites = !debouncedSearchQuery && favoriteAircraft.length > 0
  const showRecentlyUsed = !debouncedSearchQuery && recentNonFavorites.length > 0
  const showFastScroll = fastScrollItems.length > 1 && !debouncedSearchQuery.trim()

  return (
    <PageContainer
      header={
        <>
          <StandardPageHeader
            title={selectMode ? "Select Aircraft" : "Aircraft"}
            showBack={selectMode}
            onBack={selectMode ? () => router.back() : undefined}
          />
          {loadingProgress.stage && isLoading && (
            <div className="bg-background/30 backdrop-blur-xl border-b border-border/50 px-3 pb-2">
              <div className="container mx-auto">
                <div className="h-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${loadingProgress.percent}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </>
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
        <div className="flex flex-col items-center justify-center h-full gap-3 p-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">{loadingProgress.stage || "Loading..."}</p>
        </div>
      ) : (
        <div>
          <div className="px-4 pt-4 pb-safe">
            {/* Sticky search bar - outside aboveVirtualRef so it stays visible during scroll */}
            <div className="sticky top-0 z-40 pb-3 bg-background/30 backdrop-blur-xl -mx-3 px-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Search registration, type code..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 h-10 bg-background/30 backdrop-blur-xl"
                  />
                </div>
                <Button
                  onClick={() => router.push(addAircraftUrl)}
                  size="icon"
                  className="h-10 w-10 flex-shrink-0"
                >
                  <Plus className="h-5 w-5" />
                </Button>
              </div>
            </div>

            {/* Non-virtualized content above the virtual list */}
            <div ref={aboveVirtualRef}>
              {!debouncedSearchQuery.trim() && (
                <div className={`space-y-3 `}>
                  {/* Favorites Section */}
                  {showFavorites && (
                    <div className="space-y-1.5">
                      <h2 className="text-xs font-semibold text-primary uppercase px-1 flex items-center gap-1">
                        <Star className="h-3 w-3 fill-primary" /> Favorites
                      </h2>
                      <div className="space-y-1">
                        {favoriteAircraft.map((aircraft) => (
                          <AircraftCard
                            key={`fav-${aircraft.registration}`}
                            aircraft={aircraft}
                            onSelect={handleSelectAircraft}
                            isFavorite
                            onToggleFavorite={handleToggleFavorite}
                            isSelected={!selectMode && selectedAircraftReg === (aircraft.registration || aircraft.icao24)}
                          />
                        ))}
                      </div>
                      <div className="border-t border-border/50 my-4" />
                    </div>
                  )}

                  {/* Recently Used Section (excluding favorites) */}
                  {showRecentlyUsed && (
                    <div className="space-y-1.5">
                      <h2 className="text-xs font-semibold text-muted-foreground uppercase px-1">Recently Used</h2>
                      <div className="space-y-1">
                        {recentNonFavorites.map((aircraft) => (
                          <AircraftCard
                            key={`recent-${aircraft.registration || aircraft.icao24}`}
                            aircraft={aircraft}
                            onSelect={handleSelectAircraft}
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
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase px-1">
                    {filteredAircraft.length} results
                  </h2>

                  {/* FR24 Online Results — shown when no local results */}
                  {filteredAircraft.length === 0 && isFr24Loading && (
                    <div className="flex items-center gap-2 py-4 justify-center">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span className="text-sm text-muted-foreground">Searching online...</span>
                    </div>
                  )}

                  {filteredAircraft.length === 0 && !isFr24Loading && fr24Results.length > 0 && (
                    <div className="space-y-1.5">
                      <h2 className="text-xs font-semibold text-muted-foreground uppercase px-1 flex items-center gap-1">
                        <Globe className="h-3 w-3" /> Online Results
                      </h2>
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
                            className="w-full text-left rounded-lg py-2 pl-3 pr-6 transition-all cursor-pointer active:scale-[0.98] bg-card border border-border hover:bg-accent"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground">{record.registration || record.icao24}</span>
                              {record.typecode && (
                                <span className="text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded">{record.typecode}</span>
                              )}
                              <Globe className="h-3 w-3 text-muted-foreground/50 ml-auto flex-shrink-0" />
                            </div>
                            {record.operator && (
                              <div className="text-sm text-muted-foreground truncate mt-0.5">{record.operator}</div>
                            )}
                          </div>
                        ))}
                      </div>
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
                        onClick={() => router.push(addAircraftUrl)}
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
                        <AircraftCard
                          aircraft={aircraft}
                          onSelect={handleSelectAircraft}
                          isFavorite={favoriteRegs.has(aircraft.registration.toUpperCase())}
                          onToggleFavorite={handleToggleFavorite}
                          isSelected={!selectMode && selectedAircraftReg === (aircraft.registration || aircraft.icao24)}
                          compact
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
    </PageContainer>
  )
}
