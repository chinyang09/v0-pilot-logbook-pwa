"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Search, Plane, ArrowLeft, Loader2, ChevronRight } from "lucide-react"
import { useDebounce } from "@/hooks/use-debounce"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  getAircraftDatabase,
  searchAircraft,
  type AircraftData,
  type NormalizedAircraft,
  normalizeAircraft,
  setProgressCallback,
  getUserPreferences,
  saveUserPreferences,
} from "@/lib/db"
import { PageContainer } from "@/components/page-container"
import { SyncStatus } from "@/components/sync-status"
import { FastScroll, generateAlphabetItemsFromList } from "@/components/ui/fast-scroll"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { useSidebar } from "@/hooks/use-sidebar-context"
import { AircraftDetailPanel } from "@/components/aircraft-detail-panel"

const ITEMS_PER_PAGE = 30

export default function AircraftPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const selectMode = searchParams.get("select") === "true"
  const returnTo = searchParams.get("returnTo") || "/new-flight"
  const fieldName = searchParams.get("field") || "aircraftReg"
  const isDesktop = useIsDesktop()
  const { isOpen: sidebarOpen } = useSidebar()

  // Add left padding on desktop when sidebar is closed to avoid toggle button overlap
  const needsTogglePadding = isDesktop && !sidebarOpen

  // Detail panel integration
  const {
    selectedId: selectedAircraftReg,
    setSelectedId: setSelectedAircraftReg,
    setDetailContent,
  } = useDetailPanel()

  const [searchQuery, setSearchQuery] = useState("")
  const debouncedSearchQuery = useDebounce(searchQuery, 150)
  const [allAircraft, setAllAircraft] = useState<AircraftData[]>([])
  const [filteredAircraft, setFilteredAircraft] = useState<NormalizedAircraft[]>([])
  const [recentlyUsed, setRecentlyUsed] = useState<NormalizedAircraft[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadingProgress, setLoadingProgress] = useState({
    stage: "",
    percent: 0,
    count: 0,
  })
  const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE)

  const observerRef = useRef<IntersectionObserver | null>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    if (debouncedSearchQuery.length >= 2) {
      const results = searchAircraft(allAircraft, debouncedSearchQuery, 200)
      setFilteredAircraft(results)
      setDisplayCount(ITEMS_PER_PAGE)
    } else {
      setFilteredAircraft([])
    }
  }, [debouncedSearchQuery, allAircraft])

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

    if (selectedAircraftReg) {
      // Don't use key prop to avoid component remounting and flickering
      setDetailContent(
        <AircraftDetailPanel registration={selectedAircraftReg} />
      )
    } else {
      setDetailContent(
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
          <Plane className="h-12 w-12 mb-4" />
          <p>Search for aircraft to view details</p>
        </div>
      )
    }
  }, [isDesktop, selectMode, selectedAircraftReg, isLoading, setDetailContent])

  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect()
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setDisplayCount((prev) => prev + ITEMS_PER_PAGE)
        }
      },
      { threshold: 0.1 },
    )
    if (loadMoreRef.current) observerRef.current.observe(loadMoreRef.current)
    return () => observerRef.current?.disconnect()
  }, [filteredAircraft])

  const handleSelectAircraft = useCallback(
    async (aircraft: NormalizedAircraft) => {
      if (aircraft.registration) {
        const prefs = await getUserPreferences()
        const recentRegs = prefs?.recentlyUsedAircraft || []
        const filtered = recentRegs.filter((r) => r.toUpperCase() !== aircraft.registration.toUpperCase())
        const updated = [aircraft.registration, ...filtered].slice(0, 10)
        await saveUserPreferences({ recentlyUsedAircraft: updated })
      }
      if (selectMode) {
        // Select mode - always navigate back with selected aircraft
        const params = new URLSearchParams()
        params.set("field", fieldName)
        params.set("aircraftReg", aircraft.registration)
        params.set("aircraftType", aircraft.typecode)
        router.push(`${returnTo}?${params.toString()}`)
      } else if (isDesktop) {
        // Desktop - show in detail panel
        setSelectedAircraftReg(aircraft.registration || aircraft.icao24)
      } else {
        // Mobile - navigate to detail page
        router.push(`/aircraft/${encodeURIComponent(aircraft.registration || aircraft.icao24)}`)
      }
    },
    [selectMode, returnTo, fieldName, router, isDesktop, setSelectedAircraftReg],
  )

  const displayedAircraft = filteredAircraft.slice(0, displayCount)
  const showRecentlyUsed = !debouncedSearchQuery && recentlyUsed.length > 0

  // Generate FastScroll items from search results
  // Use numberPosition: "start" since registrations starting with numbers come first alphabetically
  const fastScrollItems = useMemo(() => {
    if (filteredAircraft.length === 0) return [];
    return generateAlphabetItemsFromList(
      filteredAircraft.map((a) => a.registration || a.icao24 || ""),
      { numberPosition: "start" }
    );
  }, [filteredAircraft]);

  const [activeLetterKey, setActiveLetterKey] = useState<string | undefined>(undefined);
  const isFastScrollingRef = useRef(false);

  // Track visible aircraft and update activeLetterKey on scroll using throttled scroll listener
  useEffect(() => {
    if (debouncedSearchQuery.length < 2) return;

    // Find the scrollable main container (PageContainer uses main with overflow-y-auto)
    const scrollContainer = document.querySelector('main.overflow-y-auto');
    if (!scrollContainer) return;

    let ticking = false;
    const handleScroll = () => {
      if (ticking || isFastScrollingRef.current) return;

      ticking = true;
      requestAnimationFrame(() => {
        // Find the first visible aircraft by sampling elements
        const viewportTop = 120; // Account for header/search bar
        const cards = document.querySelectorAll('[id^="aircraft-"]');

        for (const card of cards) {
          const rect = card.getBoundingClientRect();
          // Check if card is in the visible viewport area
          if (rect.top >= viewportTop - 50 && rect.top < window.innerHeight / 2) {
            const id = card.id.replace("aircraft-", "");
            const aircraft = filteredAircraft.find(
              (a) => (a.registration || a.icao24) === id
            );
            if (aircraft) {
              const reg = aircraft.registration || aircraft.icao24 || "";
              const firstChar = reg[0]?.toUpperCase();
              if (firstChar && /[A-Z]/.test(firstChar)) {
                setActiveLetterKey(firstChar);
              } else {
                setActiveLetterKey("#");
              }
              break;
            }
          }
        }
        ticking = false;
      });
    };

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    // Initial check
    handleScroll();

    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [filteredAircraft, debouncedSearchQuery]);

  // Handle FastScroll selection
  const handleFastScrollSelect = useCallback((letter: string) => {
    isFastScrollingRef.current = true;
    setActiveLetterKey(letter);

    // Find first aircraft starting with this letter
    const targetAircraft = filteredAircraft.find((a) => {
      const reg = a.registration || a.icao24 || "";
      const firstChar = reg[0]?.toUpperCase();
      if (letter === "#") {
        return !/[A-Z]/.test(firstChar || "");
      }
      return firstChar === letter;
    });

    if (targetAircraft) {
      // Make sure we've loaded enough items to show this aircraft
      const index = filteredAircraft.findIndex(
        (a) => (a.registration || a.icao24) === (targetAircraft.registration || targetAircraft.icao24)
      );
      if (index >= displayCount) {
        setDisplayCount(index + ITEMS_PER_PAGE);
      }

      // Scroll to the element with instant behavior for snappy feedback
      setTimeout(() => {
        const element = document.getElementById(
          `aircraft-${targetAircraft.registration || targetAircraft.icao24}`
        );
        if (element) {
          element.scrollIntoView({ behavior: "instant", block: "start" });
        }
        // Reset fast scrolling flag after scroll completes
        setTimeout(() => {
          isFastScrollingRef.current = false;
        }, 100);
      }, 50);
    } else {
      isFastScrollingRef.current = false;
    }
  }, [filteredAircraft, displayCount]);

  return (
    <PageContainer
      header={
        <header className="flex-none bg-background/30 backdrop-blur-xl border-b border-border/50 z-50">
          <div className="container mx-auto px-3">
            <div className={`flex items-center justify-between h-12 ${needsTogglePadding ? "pl-10" : ""}`}>
              <div className="flex items-center gap-2">
                {selectMode && (
                  <Button variant="ghost" size="sm" onClick={() => router.back()} className="h-8 w-8 p-0">
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                )}
                <h1 className="text-lg font-semibold text-foreground">{selectMode ? "Select Aircraft" : "Aircraft"}</h1>
              </div>
              <SyncStatus />
            </div>
            {loadingProgress.stage && isLoading && (
              <div className="pb-2">
                <div className="h-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${loadingProgress.percent}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </header>
      }
    >
      {isLoading ? (
        <div className="flex flex-col items-center justify-center h-full gap-3 p-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">{loadingProgress.stage || "Loading..."}</p>
        </div>
      ) : (
        <div className="relative">
          <div className="container mx-auto px-3 pt-3 pb-safe">
            <div className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl pb-3 -mx-3 px-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search registration, type code..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 h-10"
                  autoFocus
                />
              </div>
            </div>

            <div className={`space-y-3 ${debouncedSearchQuery.length >= 2 && fastScrollItems.length > 1 ? "pr-8" : ""}`}>
              {showRecentlyUsed && (
                <div className="space-y-1.5">
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase px-1">Recently Used</h2>
                  <div className="space-y-2">
                    {recentlyUsed.map((aircraft) => (
                      <AircraftCard
                        key={`recent-${aircraft.registration || aircraft.icao24}`}
                        aircraft={aircraft}
                        onSelect={handleSelectAircraft}
                        isRecent
                      />
                    ))}
                  </div>
                  <div className="border-t border-border my-4" />
                </div>
              )}

              {debouncedSearchQuery.length >= 2 && (
                <div className="space-y-1.5">
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase px-1">
                    {filteredAircraft.length} results
                  </h2>
                  <div className="space-y-2">
                    {displayedAircraft.map((aircraft, index) => (
                      <AircraftCard
                        key={`${aircraft.registration || aircraft.icao24}-${index}`}
                        aircraft={aircraft}
                        onSelect={handleSelectAircraft}
                      />
                    ))}
                  </div>
                  {displayCount < filteredAircraft.length && (
                    <div ref={loadMoreRef} className="py-8">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                    </div>
                  )}
                </div>
              )}

              {!debouncedSearchQuery && !showRecentlyUsed && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Plane className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-sm text-muted-foreground">Search for aircraft by registration or type</p>
                </div>
              )}
            </div>
          </div>

          {/* FastScroll - absolute positioned within container */}
          {debouncedSearchQuery.length >= 2 && fastScrollItems.length > 1 && (
            <div className="absolute right-0 top-0 bottom-0 z-40 flex items-center pointer-events-none">
              <div className="pointer-events-auto pr-1">
                <FastScroll
                  items={fastScrollItems}
                  activeKey={activeLetterKey}
                  onSelect={handleFastScrollSelect}
                  indicatorPosition="left"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </PageContainer>
  )
}

function AircraftCard({
  aircraft,
  onSelect,
  isRecent = false,
}: {
  aircraft: NormalizedAircraft
  onSelect: (aircraft: NormalizedAircraft) => void
  isRecent?: boolean
}) {
  return (
    <button
      id={`aircraft-${aircraft.registration || aircraft.icao24}`}
      onClick={() => onSelect(aircraft)}
      className={`w-full text-left p-3 rounded-lg transition-all active:scale-[0.98] ${
        isRecent
          ? "bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20"
          : "bg-card border border-border hover:bg-accent"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-foreground">{aircraft.registration || aircraft.icao24}</span>
            {aircraft.typecode && (
              <span className="text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded">{aircraft.typecode}</span>
            )}
          </div>
          <div className="text-sm text-muted-foreground">
            {aircraft.icao24 && <span className="font-mono">{aircraft.icao24}</span>}
            {aircraft.icao24 && aircraft.shortType && <span> · </span>}
            {aircraft.shortType && <span>Cat: {aircraft.shortType}</span>}
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
      </div>
    </button>
  )
}
