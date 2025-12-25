"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { SyncStatus } from "@/components/sync-status";
import { PageContainer } from "@/components/page-container";
import { useAirportDatabase } from "@/hooks/use-indexed-db";
import { searchAirports } from "@/lib/airport-database";
import {
  getRecentlyUsedAirports,
  addRecentlyUsedAirport,
  getAirportByIcao,
} from "@/lib/indexed-db";
import { Search, MapPin, ArrowLeft } from "lucide-react";
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
  const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE);
  const [recentAirports, setRecentAirports] = useState<typeof airports>([]);

  const observerTarget = useRef<HTMLDivElement>(null);

  // ... (Keep existing useEffects for loading airports and observer)
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
    if (!searchQuery.trim()) return airports.slice(0, displayCount);
    return searchAirports(airports, searchQuery, displayCount);
  }, [airports, searchQuery, displayCount]);

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

  const renderAirportCard = (
    airport: (typeof airports)[0],
    isRecent = false
  ) => (
    <button
      key={airport.icao}
      onClick={() => handleAirportSelect(airport.icao)}
      className={cn(
        "w-full text-left rounded-lg p-2 transition-all",
        isRecent
          ? "bg-gradient-to-br from-primary/20 to-primary/5 border-2 border-primary/40"
          : "bg-card border border-border"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span
              className={cn(
                "font-bold",
                isRecent ? "text-lg text-primary" : "text-base text-foreground"
              )}
            >
              {airport.icao}
            </span>
            {airport.iata && (
              <span className="text-sm text-muted-foreground">
                ({airport.iata})
              </span>
            )}
          </div>
          <div
            className={cn(
              "truncate",
              isRecent ? "text-base font-medium" : "text-sm font-medium"
            )}
          >
            {airport.name}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
            <MapPin className="h-3 w-3" />
            <span className="truncate">
              {airport.city}
              {airport.state && `, ${airport.state}`} - {airport.country}
            </span>
          </div>
        </div>
      </div>
    </button>
  );

  return (
    /* Change 1: relative container */
    <PageContainer
      header={
        <header className="flex-none bg-background/95 backdrop-blur-lg border-b border-border z-50">
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
      <div className="container mx-auto px-3 pt-3 pb-24">
        {" "}
        {/* Added pb-24 so content isn't hidden by nav when it IS visible */}
        <div className="sticky top-0 z-40 bg-background/95 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search airports..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-10"
            />
          </div>
        </div>
        <div className="space-y-3">
          {!searchQuery && recentAirports.length > 0 && (
            <div className="space-y-1.5">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase px-1">
                Recent
              </h2>
              {recentAirports.map((a) => renderAirportCard(a, true))}
              <div className="border-t border-border my-4" />
            </div>
          )}
          <div className="space-y-1">
            {filteredAirports.map((a) => renderAirportCard(a, false))}
          </div>
          <div ref={observerTarget} className="h-20" />
        </div>
      </div>
    </PageContainer>
  );
}
