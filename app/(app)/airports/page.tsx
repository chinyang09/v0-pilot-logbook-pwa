"use client";

import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";
import type React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/page-container";
import { useAirportDatabase, useFlights } from "@/hooks/data";
import { StandardPageHeader } from "@/components/standard-page-header";
import {
  searchAirports,
  hasExactAirportCodeMatch,
  toggleAirportFavorite,
  getAirportByIcao,
  updateFlight,
  addCustomAirport,
  type Airport,
} from "@/lib/db";
import { syncService } from "@/lib/sync";
import { submitAirportToServer } from "@/lib/submissions/submit";
import { Star, Search, Plus, MapPin, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FastScroll, generateAlphabetItemsFromList } from "@/components/ui/fast-scroll";
import { useDetailPanel } from "@/hooks/use-detail-panel";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { AirportDetailPanel } from "@/components/airport-detail-panel";
import { AirportNewForm } from "@/components/airport-new-form";
import { useDebounce } from "@/hooks/use-debounce";
import { usePageActive } from "@/hooks/use-page-active";

// Memoized airport card to prevent unnecessary re-renders during virtualization
interface AirportCardProps {
  airport: Airport;
  isRecent?: boolean;
  isSelected?: boolean;
  onSelect: (icao: string) => void;
  onToggleFavorite: (e: React.MouseEvent, icao: string) => void;
}

const AirportCard = memo(function AirportCard({
  airport,
  isRecent = false,
  isSelected = false,
  onSelect,
  onToggleFavorite,
}: AirportCardProps) {
  return (
    <div
      id={`airport-${airport.icao}`}
      onClick={() => onSelect(airport.icao)}
      role="button"
      tabIndex={0}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          onSelect(airport.icao);
        }
      }}
      className={cn(
        "w-full text-left rounded-lg py-2 pl-3 pr-6 transition-all cursor-pointer",
        isRecent
          ? "bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20"
          : "bg-card border border-border hover:bg-accent",
        isSelected && "bg-primary/20 border-primary"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">{airport.icao}</span>
            <span className="text-sm text-foreground truncate">{airport.name}</span>
          </div>
          <div className="text-sm text-muted-foreground truncate mt-0.5">
            {airport.city}, {airport.country}
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 hover:bg-primary/20 relative z-10 flex-shrink-0"
          onClick={(e: React.MouseEvent) => onToggleFavorite(e, airport.icao)}
        >
          <Star
            className={cn(
              "h-4 w-4",
              airport.isFavorite
                ? "fill-yellow-400 text-yellow-400"
                : "text-muted-foreground/40"
            )}
          />
        </Button>
      </div>
    </div>
  );
});

export default function AirportsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fieldType = searchParams.get("field");
  const flightId = searchParams.get("flightId");
  const isDesktop = useIsDesktop();

  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const scrollContainerCallbackRef = useCallback((el: HTMLElement | null) => {
    scrollContainerRef.current = el;
  }, []);

  const { airports, isLoading, mutate: mutateAirports } = useAirportDatabase();
  const { flights } = useFlights();
  const [activeLetterKey, setActiveLetterKey] = useState<string | undefined>(undefined);
  const isFastScrollingRef = useRef(false);

  // Search state (replacing useSearchableList)
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 150);

  // FR24 online search state
  interface Fr24AirportResult {
    icao: string;
    iata: string;
    name: string;
    city: string;
    country: string;
    countryCode: string;
    latitude: number;
    longitude: number;
    elevation: number;
    timezone: string;
  }
  const [fr24Result, setFr24Result] = useState<Fr24AirportResult | null>(null);
  const [isFr24Loading, setIsFr24Loading] = useState(false);

  // Detail panel integration
  const {
    selectedId: selectedAirportIcao,
    setSelectedId: setSelectedAirportIcao,
    setDetailContent,
  } = useDetailPanel();

  // Only sync detail panel when this page is active — prevents hidden pages from
  // overwriting the active page's detail content when shared selectedId changes.
  const isActive = usePageActive("/airports")

  // Sort all airports: favorites first, then alphabetical by ICAO
  const allSortedAirports = useMemo(() => {
    return [...airports].sort((a, b) => {
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      return a.icao.localeCompare(b.icao);
    });
  }, [airports]);

  // Validate that selectedAirportIcao maps to a real airport in our store.
  // This prevents stale cross-route selectedId values (e.g. an aircraft registration
  // left over from the /aircraft page) from being passed to AirportDetailPanel.
  const selectedAirport = useMemo(
    () => allSortedAirports.find(a => a.icao === selectedAirportIcao) || null,
    [selectedAirportIcao, allSortedAirports]
  );

  // Filtered airports for search mode — preserves score order from searchAirports
  const filteredAirports = useMemo(() => {
    if (!debouncedSearchQuery.trim()) return allSortedAirports;
    return searchAirports(airports, debouncedSearchQuery, airports.length);
  }, [airports, allSortedAirports, debouncedSearchQuery]);

  // Whether there's an exact ICAO/IATA code match in local DB (drives FR24 trigger)
  const hasExactMatch = useMemo(() => {
    if (!debouncedSearchQuery.trim()) return false;
    return hasExactAirportCodeMatch(airports, debouncedSearchQuery);
  }, [airports, debouncedSearchQuery]);

  // FR24 online search: fires when no exact ICAO/IATA match in local DB and query is >= 4 chars
  // This ensures fuzzy name matches (e.g. "WARR" matching "Warren" city) don't prevent FR24 lookup
  useEffect(() => {
    const query = debouncedSearchQuery.trim().toUpperCase();
    if (!query || query.length < 4 || hasExactMatch) {
      setFr24Result(null);
      setIsFr24Loading(false);
      return;
    }

    let cancelled = false;
    setIsFr24Loading(true);

    const searchFr24 = async () => {
      try {
        const res = await fetch(`/api/search/airport?q=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error("FR24 airport search failed");
        const data = await res.json();
        if (!cancelled) {
          setFr24Result(data.result || null);
        }
      } catch {
        if (!cancelled) setFr24Result(null);
      } finally {
        if (!cancelled) setIsFr24Loading(false);
      }
    };

    searchFr24();
    return () => { cancelled = true; };
  }, [debouncedSearchQuery, hasExactMatch]);

  // Derive recently used airports from flights (most recent first)
  const recentAirports = useMemo(() => {
    if (flights.length === 0 || airports.length === 0) return [];
    const seen = new Set<string>();
    const recentIcaoList: string[] = [];
    for (const flight of flights) {
      for (const icao of [flight.departureIcao, flight.arrivalIcao]) {
        if (icao && !seen.has(icao.toUpperCase())) {
          seen.add(icao.toUpperCase());
          recentIcaoList.push(icao.toUpperCase());
          if (recentIcaoList.length >= 10) break;
        }
      }
      if (recentIcaoList.length >= 10) break;
    }
    return recentIcaoList
      .map((icao) => airports.find((a) => a.icao.toUpperCase() === icao))
      .filter((a): a is Airport => !!a && !a.isFavorite);
  }, [flights, airports]);

  // Set of recent ICAO codes for fast lookup
  const recentIcaos = useMemo(() => {
    return new Set(recentAirports.map((a) => a.icao));
  }, [recentAirports]);

  // Browse list excludes both favorites and recently used (shown in their own sections above)
  const browseAirports = useMemo(() => {
    return allSortedAirports.filter((a) => !a.isFavorite && !recentIcaos.has(a.icao));
  }, [allSortedAirports, recentIcaos]);

  // The list to virtualize: when searching show all results, otherwise the browse list
  const displayAirports = debouncedSearchQuery.trim() ? filteredAirports : browseAirports;

  // Generate FastScroll alphabet items from the browse list
  const fastScrollItems = useMemo(() => {
    return generateAlphabetItemsFromList(browseAirports.map((a) => a.icao), {
      numberPosition: "start",
    });
  }, [browseAirports]);

  // Pre-compute letter -> virtual list index mapping for fast scroll
  const letterIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    browseAirports.forEach((airport, index) => {
      const firstChar = airport.icao[0]?.toUpperCase();
      const letter = /[A-Z]/.test(firstChar || "") ? firstChar! : "#";
      if (!map.has(letter)) {
        map.set(letter, index);
      }
    });
    return map;
  }, [browseAirports]);

  // Measure scroll margin: height of non-virtualized content above the virtual list
  const aboveVirtualRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  useEffect(() => {
    const el = aboveVirtualRef.current;
    const scrollEl = scrollContainerRef.current;
    if (!el || !scrollEl) {
      setScrollMargin(0);
      return;
    }

    const updateMargin = () => {
      // Measure the distance from scroll container top to the virtual list start
      const scrollRect = scrollEl.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const margin = (elRect.bottom - scrollRect.top) + scrollEl.scrollTop;
      setScrollMargin(margin);
    };

    updateMargin();
    const observer = new ResizeObserver(updateMargin);
    observer.observe(el);
    return () => observer.disconnect();
  }, [debouncedSearchQuery, airports, recentAirports]);

  // Virtual list
  const rowVirtualizer = useVirtualizer({
    count: displayAirports.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 60, // Compact airport card height (py-2 + 2 lines + pb-1 gap)
    overscan: 10,
    scrollMargin,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  // Sync detail panel content — re-runs whenever selection, data, or active state changes
  const syncDetailPanel = useCallback(() => {
    if (!isActive) return;
    if (fieldType) return;

    if (isLoading) {
      setDetailContent(
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      );
      return;
    }

    if (allSortedAirports.length === 0) {
      setDetailContent(
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
          <p>No airports found</p>
        </div>
      );
      return;
    }

    if (selectedAirport) {
      setDetailContent(<AirportDetailPanel icao={selectedAirport.icao} onBack={() => setSelectedAirportIcao(null)} />);
    } else {
      setDetailContent(null);
    }
  }, [isActive, fieldType, selectedAirport, allSortedAirports, isLoading, setDetailContent, setSelectedAirportIcao]);

  // Update detail content when selection, data, or active state changes
  useEffect(() => {
    syncDetailPanel();
  }, [syncDetailPanel]);

  // Track active letter from virtualizer scroll position (replaces expensive DOM query)
  useEffect(() => {
    if (debouncedSearchQuery.trim()) return;

    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    let ticking = false;
    const handleScroll = () => {
      if (ticking || isFastScrollingRef.current) return;

      ticking = true;
      requestAnimationFrame(() => {
        const items = rowVirtualizer.getVirtualItems();
        if (items.length > 0) {
          const scrollOffset = rowVirtualizer.scrollOffset ?? 0;
          // Find first visible item (skip overscan items above viewport)
          let topItem = items[0];
          for (const item of items) {
            if (item.start + scrollMargin >= scrollOffset) {
              topItem = item;
              break;
            }
          }
          const airport = displayAirports[topItem.index];
          if (airport && !airport.isFavorite) {
            const firstChar = airport.icao[0]?.toUpperCase();
            if (firstChar && /[A-Z]/.test(firstChar)) {
              setActiveLetterKey(firstChar);
            } else {
              setActiveLetterKey("#");
            }
          }
        }
        ticking = false;
      });
    };

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [displayAirports, debouncedSearchQuery, rowVirtualizer, scrollMargin]);

  // Handle FastScroll selection - uses scrollToIndex instead of loadAll + scrollIntoView
  const handleFastScrollSelect = useCallback((letter: string) => {
    const index = letterIndexMap.get(letter);
    if (index !== undefined) {
      isFastScrollingRef.current = true;
      setActiveLetterKey(letter);
      rowVirtualizer.scrollToIndex(index, {
        align: "start",
        behavior: "auto",
      });
      setTimeout(() => {
        isFastScrollingRef.current = false;
      }, 150);
    }
  }, [letterIndexMap, rowVirtualizer]);


  const handleAirportSelect = useCallback(async (icao: string) => {
    if (fieldType && flightId) {
      const updates: Partial<{ departureIcao: string; departureIata: string; arrivalIcao: string; arrivalIata: string }> = {};
      if (fieldType === "departureIcao") {
        updates.departureIcao = icao;
        updates.departureIata = "";
      } else if (fieldType === "arrivalIcao") {
        updates.arrivalIcao = icao;
        updates.arrivalIata = "";
      }
      try {
        await updateFlight(flightId, updates);
        syncService.notifyDataChange();
      } catch (error) {
        console.error("Failed to update flight with airport:", error);
      }
      router.back();
    } else {
      setSelectedAirportIcao(icao);
    }
  }, [fieldType, flightId, router, setSelectedAirportIcao]);

  const handleToggleFavorite = useCallback(async (e: React.MouseEvent, icao: string) => {
    e.preventDefault();
    e.stopPropagation();
    await toggleAirportFavorite(icao);
    // Optimistically update local state so UI reflects the change immediately
    mutateAirports((prev) =>
      prev.map((a) =>
        a.icao === icao ? { ...a, isFavorite: !a.isFavorite } : a
      )
    );
  }, [mutateAirports]);

  const handleSelectFr24Airport = useCallback(
    async (result: Fr24AirportResult) => {
      // Save to local DB
      const newAirport = await addCustomAirport({
        icao: result.icao,
        iata: result.iata,
        name: result.name,
        city: result.city,
        state: "",
        country: result.country,
        latitude: result.latitude,
        longitude: result.longitude,
        elevation: result.elevation,
        tz: result.timezone || "UTC",
        isCustom: true,
      });

      // Fire-and-forget server submission
      if (newAirport.submissionId) {
        submitAirportToServer({
          submissionId: newAirport.submissionId,
          icao: result.icao,
          name: result.name,
          iata: result.iata,
          city: result.city,
          country: result.country,
          timezone: result.timezone,
          latitude: result.latitude,
          longitude: result.longitude,
          elevation: result.elevation,
        });
      }

      // Optimistically add to local state (sync, like aircraft page does)
      mutateAirports((prev) => [...prev, newAirport]);
      setFr24Result(null);

      if (fieldType && flightId) {
        const updates: Partial<{ departureIcao: string; departureIata: string; arrivalIcao: string; arrivalIata: string }> = {};
        if (fieldType === "departureIcao") {
          updates.departureIcao = result.icao;
          updates.departureIata = result.iata;
        } else if (fieldType === "arrivalIcao") {
          updates.arrivalIcao = result.icao;
          updates.arrivalIata = result.iata;
        }
        try {
          await updateFlight(flightId, updates);
          syncService.notifyDataChange();
        } catch (error) {
          console.error("Failed to update flight with airport:", error);
        }
        router.back();
      } else {
        setSelectedAirportIcao(result.icao);
      }
    },
    [fieldType, flightId, router, mutateAirports, setSelectedAirportIcao],
  );

  const addAirportUrl = fieldType && flightId
    ? `/airports/new?field=${fieldType}&flightId=${flightId}${searchQuery ? `&code=${encodeURIComponent(searchQuery)}` : ""}`
    : `/airports/new${searchQuery ? `?code=${encodeURIComponent(searchQuery)}` : ""}`;

  const handleAddClick = useCallback(() => {
    if (isDesktop && !fieldType) {
      setDetailContent(
        <AirportNewForm
          prefilledCode={searchQuery}
          isDetailPanel
          onSave={async (icao) => {
            const airport = await getAirportByIcao(icao);
            if (airport) {
              mutateAirports((prev) => [...prev, airport]);
            }
            setSelectedAirportIcao(icao);
          }}
          onCancel={() => {
            if (selectedAirportIcao) {
              setDetailContent(<AirportDetailPanel icao={selectedAirportIcao} onBack={() => setSelectedAirportIcao(null)} />);
            } else {
              setDetailContent(null);
            }
          }}
          onViewExisting={(icao) => {
            setSelectedAirportIcao(icao);
          }}
        />
      );
    } else {
      router.push(addAirportUrl);
    }
  }, [isDesktop, fieldType, searchQuery, router, addAirportUrl, selectedAirportIcao, mutateAirports, setDetailContent, setSelectedAirportIcao]);

  const showFastScroll = fastScrollItems.length > 1 && !debouncedSearchQuery.trim();

  const pageTitle = !fieldType
    ? "Airports"
    : fieldType.includes("departure")
    ? "Departure"
    : "Arrival";

  return (
    <PageContainer
      header={
        <StandardPageHeader
          title={pageTitle}
          showBack={!!fieldType}
          onBack={fieldType ? () => router.back() : undefined}
        />
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
      <div>
        <div className="px-4 pt-4 pb-safe">
          {/* Sticky search bar - outside aboveVirtualRef so it stays visible during scroll */}
          <div className="sticky top-0 z-40 pb-3 bg-background/30 backdrop-blur-xl -mx-3 px-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search airports..."
                  value={searchQuery}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                  className="pl-10 h-10 bg-background/30 backdrop-blur-xl"
                />
              </div>
              <Button
                onClick={handleAddClick}
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
                {airports.some((a: Airport) => a.isFavorite) && (
                  <div className="space-y-1.5">
                    <h2 className="text-xs font-semibold text-primary uppercase px-1 flex items-center gap-1">
                      <Star className="h-3 w-3 fill-primary" /> Favorites
                    </h2>
                    <div className="space-y-1">
                      {airports
                        .filter((a: Airport) => a.isFavorite)
                        .map((a: Airport) => (
                          <AirportCard
                            key={a.icao}
                            airport={a}
                            isSelected={!fieldType && selectedAirportIcao === a.icao}
                            onSelect={handleAirportSelect}
                            onToggleFavorite={handleToggleFavorite}
                          />
                        ))}
                    </div>
                    <div className="border-t border-border/50 my-4" />
                  </div>
                )}

                {/* Recent Section (excluding favorites, which are shown above) */}
                {recentAirports.length > 0 && (
                  <div className="space-y-1.5">
                    <h2 className="text-xs font-semibold text-muted-foreground uppercase px-1">
                      Recent
                    </h2>
                    <div className="space-y-1">
                      {recentAirports.map((a: Airport) => (
                          <AirportCard
                            key={a.icao}
                            airport={a}
                            isRecent
                            isSelected={!fieldType && selectedAirportIcao === a.icao}
                            onSelect={handleAirportSelect}
                            onToggleFavorite={handleToggleFavorite}
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
                {/* FR24 result — shown at top when no exact ICAO/IATA match in local DB */}
                {!hasExactMatch && isFr24Loading && (
                  <div className="flex items-center gap-2 py-4 justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">Searching...</span>
                  </div>
                )}

                {!hasExactMatch && !isFr24Loading && fr24Result && (
                  <div className="space-y-1">
                    <div
                      onClick={() => handleSelectFr24Airport(fr24Result)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e: React.KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") handleSelectFr24Airport(fr24Result);
                      }}
                      className="w-full text-left rounded-lg py-2 pl-3 pr-6 transition-all cursor-pointer bg-card border border-border hover:bg-accent"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{fr24Result.icao}</span>
                        <span className="text-sm text-foreground truncate">{fr24Result.name}</span>
                      </div>
                      {fr24Result.city && (
                        <div className="text-sm text-muted-foreground truncate mt-0.5">
                          {fr24Result.city}, {fr24Result.country}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Empty state — no local or online results */}
                {filteredAirports.length === 0 && !isFr24Loading && !fr24Result && (
                  <div className="flex flex-col items-center gap-3 py-8">
                    <MapPin className="h-8 w-8 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">No airports found</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleAddClick}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add Airport
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Virtualized airport list */}
          <div>
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {virtualItems.map((virtualRow) => {
                const airport = displayAirports[virtualRow.index];
                if (!airport) return null;
                return (
                  <div
                    key={airport.icao}
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
                      <AirportCard
                        airport={airport}
                        isSelected={!fieldType && selectedAirportIcao === airport.icao}
                        onSelect={handleAirportSelect}
                        onToggleFavorite={handleToggleFavorite}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
