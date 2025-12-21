"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  Plane,
  ChevronLeft,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  searchAircraft,
  initializeDatabase,
  type NormalizedAircraft,
  isAircraftDatabaseLoaded,
  normalizeAircraft,
  setProgressCallback,
  getAircraftByRegistration,
} from "@/lib/aircraft-database";
import { getUserPreferences, saveUserPreferences } from "@/lib/indexed-db";
import { useDebounce } from "@/hooks/use-debounce";

const ITEMS_PER_PAGE = 30;

export default function AircraftPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectMode = searchParams.get("select") === "true";
  const returnTo = searchParams.get("returnTo") || "/new-flight";
  const fieldName = searchParams.get("field") || "aircraftReg";

  const [searchQuery, setSearchQuery] = useState("");
  // Debounce logic
  const debouncedQuery = useDebounce(searchQuery, 300);

  const [filteredAircraft, setFilteredAircraft] = useState<
    NormalizedAircraft[]
  >([]);
  const [recentlyUsed, setRecentlyUsed] = useState<NormalizedAircraft[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({
    stage: "",
    percent: 0,
    count: 0,
  });
  const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE);

  const listRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Initialization Effect
  useEffect(() => {
    let mounted = true;

    setProgressCallback((progress) => {
      if (mounted) {
        setLoadingProgress({
          stage: progress.stage,
          percent: progress.percent,
          count: progress.count || 0,
        });
      }
    });

    async function loadDatabase() {
      setIsLoading(true);

      // Only check existence, do not load to memory
      if (isAircraftDatabaseLoaded()) {
        setLoadingProgress({ stage: "Ready", percent: 100, count: 0 });
      } else {
        setLoadingProgress({ stage: "Initializing...", percent: 0, count: 0 });
      }

      try {
        // Initialize DB if needed
        const success = await initializeDatabase();

        if (mounted && success) {
          setLoadingProgress({ stage: "Ready", percent: 100, count: 0 });

          // Load Recently Used from IDB
          const prefs = await getUserPreferences();
          const recentRegs = prefs?.recentlyUsedAircraft || [];
          const recentAc: NormalizedAircraft[] = [];

          // Fetch recent aircraft details individually (async)
          for (const reg of recentRegs) {
            const found = await getAircraftByRegistration(reg);
            if (found) {
              recentAc.push(found);
            }
          }
          setRecentlyUsed(recentAc);
        }
      } catch (error) {
        console.error("[Aircraft Page] Failed to load database:", error);
        setLoadingProgress({ stage: "Failed to load", percent: 0, count: 0 });
      } finally {
        if (mounted) setIsLoading(false);
        setProgressCallback(null);
      }
    }

    loadDatabase();
    return () => {
      mounted = false;
      setProgressCallback(null);
    };
  }, []);

  // Search Effect
  useEffect(() => {
    let active = true;

    async function doSearch() {
      if (debouncedQuery.length >= 2) {
        setIsSearching(true);
        try {
          // Async DB Search
          const results = await searchAircraft(debouncedQuery, 100);
          if (active) {
            setFilteredAircraft(results);
            setDisplayCount(ITEMS_PER_PAGE);
          }
        } catch (err) {
          console.error("Search failed", err);
        } finally {
          if (active) setIsSearching(false);
        }
      } else {
        if (active) setFilteredAircraft([]);
      }
    }

    doSearch();
    return () => {
      active = false;
    };
  }, [debouncedQuery]);

  // Infinite Scroll Observer
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setDisplayCount((prev) => prev + ITEMS_PER_PAGE);
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => observerRef.current?.disconnect();
  }, [filteredAircraft]);

  const handleSelectAircraft = useCallback(
    async (aircraft: NormalizedAircraft) => {
      if (aircraft.registration) {
        const prefs = await getUserPreferences();
        const recentRegs = prefs?.recentlyUsedAircraft || [];
        const filtered = recentRegs.filter(
          (r) => r.toUpperCase() !== aircraft.registration.toUpperCase()
        );
        const updated = [aircraft.registration, ...filtered].slice(0, 10);
        await saveUserPreferences({ recentlyUsedAircraft: updated });
      }

      if (selectMode) {
        const params = new URLSearchParams();
        params.set("field", fieldName);
        params.set("aircraftReg", aircraft.registration);
        params.set("aircraftType", aircraft.typecode);
        router.push(`${returnTo}?${params.toString()}`);
      } else {
        router.push(
          `/aircraft/${encodeURIComponent(
            aircraft.registration || aircraft.icao24
          )}`
        );
      }
    },
    [selectMode, returnTo, fieldName, router]
  );

  const displayedAircraft = filteredAircraft.slice(0, displayCount);
  const showRecentlyUsed = !searchQuery && recentlyUsed.length > 0;

  return (
    <div className="flex flex-col h-[100dvh] bg-background">
      <div className="flex-shrink-0 bg-card border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => router.back()}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search registration, type code, ICAO24..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-10"
              autoFocus
            />
            {isSearching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        </div>

        {/* Progress Bar (Only during initial import) */}
        {loadingProgress.stage && isLoading && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span className="flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                {loadingProgress.stage}
              </span>
              <span>{loadingProgress.percent}%</span>
            </div>
            <div className="h-1 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${loadingProgress.percent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground text-sm text-center">
              {loadingProgress.stage || "Loading aircraft database..."}
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {showRecentlyUsed && (
              <div className="mb-4">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-2 mb-2">
                  Recently Used
                </h3>
                <div className="space-y-1">
                  {recentlyUsed.map((aircraft) => (
                    <AircraftCard
                      key={`recent-${aircraft.registration || aircraft.icao24}`}
                      aircraft={aircraft}
                      onSelect={handleSelectAircraft}
                      isRecent
                    />
                  ))}
                </div>
              </div>
            )}

            {searchQuery.length >= 2 && (
              <>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-2">
                  {filteredAircraft.length > 0
                    ? `${filteredAircraft.length} results`
                    : "No results found"}
                </h3>
                <div className="space-y-1">
                  {displayedAircraft.map((aircraft, index) => (
                    <AircraftCard
                      key={`${
                        aircraft.registration || aircraft.icao24
                      }-${index}`}
                      aircraft={aircraft}
                      onSelect={handleSelectAircraft}
                    />
                  ))}
                </div>

                {displayCount < filteredAircraft.length && (
                  <div ref={loadMoreRef} className="py-4 text-center">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </div>
                )}
              </>
            )}

            {!searchQuery && !showRecentlyUsed && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Plane className="h-12 w-12 text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground">
                  Search for aircraft by registration or type code
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AircraftCard({
  aircraft,
  onSelect,
  isRecent = false,
}: {
  aircraft: NormalizedAircraft;
  onSelect: (aircraft: NormalizedAircraft) => void;
  isRecent?: boolean;
}) {
  return (
    <button
      onClick={() => onSelect(aircraft)}
      className={`w-full text-left p-3 rounded-lg transition-all active:scale-[0.98] ${
        isRecent
          ? "bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20"
          : "bg-card border border-border hover:border-primary/30"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-foreground">
              {aircraft.registration || aircraft.icao24}
            </span>
            {aircraft.typecode && (
              <span className="text-sm font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                {aircraft.typecode}
              </span>
            )}
          </div>

          <div className="text-sm text-muted-foreground mt-0.5">
            {aircraft.icao24 && (
              <span className="font-mono">{aircraft.icao24}</span>
            )}
            {aircraft.icao24 && aircraft.shortType && <span> • </span>}
            {aircraft.shortType && <span>Cat: {aircraft.shortType}</span>}
          </div>
        </div>

        <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
      </div>
    </button>
  );
}
