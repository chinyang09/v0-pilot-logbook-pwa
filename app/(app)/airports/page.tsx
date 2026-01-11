"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { SyncStatus } from "@/components/sync-status";
import { PageContainer } from "@/components/page-container";
import { useDebounce } from "@/hooks/use-debounce";
import { useAirportDatabase } from "@/hooks/data";
import {
  searchAirports,
  toggleAirportFavorite,
  getRecentlyUsedAirports,
  addRecentlyUsedAirport,
  getAirportByIcao,
} from "@/lib/db";
import { Star, Search, MapPin, ArrowLeft, ChevronRight } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ITEMS_PER_PAGE = 50;

export default function AirportsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fieldType = searchParams.get("field");
  const returnUrl =
    searchParams.get("return") || searchParams.get("returnTo") || "/new-flight";

  const { airports, isLoading } = useAirportDatabase();
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 150);
  const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE);
  const [recentAirports, setRecentAirports] = useState<typeof airports>([]);

  const observerTarget = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadRecentAirports = async () => {
      const recentCodes = await getRecentlyUsedAirports();
      const airports = await Promise.all(
        recentCodes.map((code) => getAirportByIcao(code))
      );
      setRecentAirports(airports.filter(Boolean) as typeof recentAirports);
    };
    loadRecentAirports();
  }, []);

  const filteredAirports = useMemo(() => {
    let baseList = airports;

    // If searching, use search utility
    if (debouncedSearchQuery.trim()) {
      baseList = searchAirports(airports, debouncedSearchQuery, airports.length);
    }

    // Sort: Favorites first, then Alphabetical ICAO
    return baseList
      .sort((a, b) => {
        if (a.isFavorite && !b.isFavorite) return -1;
        if (!a.isFavorite && b.isFavorite) return 1;
        return a.icao.localeCompare(b.icao);
      })
      .slice(0, displayCount);
  }, [airports, debouncedSearchQuery, displayCount]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoading) {
          setDisplayCount((prev) =>
            Math.min(prev + ITEMS_PER_PAGE, airports.length)
          );
        }
      },
      { threshold: 0.1 }
    );
    const target = observerTarget.current;
    if (target) observer.observe(target);
    return () => {
      if (target) observer.unobserve(target);
    };
  }, [isLoading, airports.length]);

  useEffect(() => {
    setDisplayCount(ITEMS_PER_PAGE);
  }, [searchQuery]);

  const handleAirportSelect = async (icao: string) => {
    if (fieldType) {
      await addRecentlyUsedAirport(icao);
      const params = new URLSearchParams();
      params.set("field", fieldType);
      params.set("airport", icao);
      router.push(`${returnUrl}?${params.toString()}`);
    } else {
      router.push(`/airports/${icao}`);
    }
  };

  const handleToggleFavorite = async (e: React.MouseEvent, icao: string) => {
    e.preventDefault();
    e.stopPropagation(); // Stops the event from bubbling up to the outer <div>
    await toggleAirportFavorite(icao);
    // Optional: Trigger a state refresh here if not using SWR
  };

  const renderAirportCard = (
    airport: (typeof airports)[0],
    isRecent = false
  ) => (
    // Change <button> to <div>
    <div
      key={airport.icao}
      onClick={() => handleAirportSelect(airport.icao)}
      role="button" // Accessibility: Tells screen readers this is interactive
      tabIndex={0} // Accessibility: Makes it focusable via keyboard
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          handleAirportSelect(airport.icao);
        }
      }}
      className={cn(
        "w-full text-left rounded-lg p-3 transition-all cursor-pointer active:scale-[0.98]",
        isRecent
          ? "bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20"
          : "bg-card border border-border hover:bg-accent"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-foreground">
              {airport.icao}
            </span>
            {airport.iata && (
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {airport.iata}
              </span>
            )}
            {airport.isFavorite && (
              <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
            )}
          </div>
          <div className="text-sm font-medium text-foreground truncate">
            {airport.name}
          </div>
          <div className="flex items-center gap-1 text-sm text-muted-foreground mt-0.5">
            <MapPin className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">
              {airport.city}, {airport.country}
            </span>
          </div>
        </div>

        {/* The inner Button is now safe inside a <div> */}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 hover:bg-primary/20 relative z-10"
          onClick={(e) => handleToggleFavorite(e, airport.icao)}
        >
          <Star
            className={cn(
              "h-5 w-5",
              airport.isFavorite
                ? "fill-yellow-400 text-yellow-400"
                : "text-muted-foreground/40"
            )}
          />
        </Button>
      </div>
    </div>
  );

  return (
    <PageContainer
      header={
        <header className="flex-none bg-background/30 backdrop-blur-xl border-b border-border/50 z-50">
          <div className="container mx-auto px-3">
            <div className="flex items-center justify-between h-12">
              <div className="flex items-center gap-2">
                {fieldType && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => router.back()}
                    className="h-8 w-8 p-0"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                )}
                <h1 className="text-lg font-semibold text-foreground">
                  {!fieldType
                    ? "Airports"
                    : fieldType.includes("departure")
                    ? "Departure"
                    : "Arrival"}
                </h1>
              </div>
              <SyncStatus />
            </div>
          </div>
        </header>
      }
    >
      <div className="container  mx-auto px-3 pt-3 pb-safe">
        <div className="sticky top-0 z-40 pb-3">
          <div className="relative">
            <Input
              type="text"
              placeholder="Search airports..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-10 bg-background/30 backdrop-blur-xl"
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
        </div>

        <div className="space-y-3">
          {!debouncedSearchQuery && (
            <>
              {/* Favorites Section */}
              {airports.some((a) => a.isFavorite) && (
                <div className="space-y-1.5">
                  <h2 className="text-xs font-semibold text-primary uppercase px-1 flex items-center gap-1">
                    <Star className="h-3 w-3 fill-primary" /> Favorites
                  </h2>
                  <div className="space-y-2">
                    {airports
                      .filter((a) => a.isFavorite)
                      .map((a) => renderAirportCard(a, false))}
                  </div>
                  <div className="border-t border-border/50 my-4" />
                </div>
              )}

              {/* Recent Section */}
              {recentAirports.length > 0 && (
                <div className="space-y-1.5">
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase px-1">
                    Recent
                  </h2>
                  <div className="space-y-2">
                    {recentAirports.map((a) => renderAirportCard(a, true))}
                  </div>
                  <div className="border-t border-border my-4" />
                </div>
              )}
            </>
          )}

          {debouncedSearchQuery && (
            <h2 className="text-xs font-semibold text-muted-foreground uppercase px-1">
              {filteredAirports.length} results
            </h2>
          )}

          <div className="space-y-2">
            {filteredAirports.map((a) => renderAirportCard(a, false))}
          </div>

          <div ref={observerTarget} className="h-20" />
        </div>
      </div>
    </PageContainer>
  );
}
