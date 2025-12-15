"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Search, Plane, ChevronLeft, Loader2, ChevronRight } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  getAircraftDatabase,
  searchAircraft,
  type AircraftData,
  type NormalizedAircraft,
  isAircraftDatabaseLoaded,
} from "@/lib/aircraft-database"
import { getUserPreferences, saveUserPreferences } from "@/lib/indexed-db"

const ITEMS_PER_PAGE = 30

export default function AircraftPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const selectMode = searchParams.get("select") === "true"
  const returnTo = searchParams.get("returnTo") || "/new-flight"
  const fieldName = searchParams.get("field") || "aircraftReg"

  const [searchQuery, setSearchQuery] = useState("")
  const [allAircraft, setAllAircraft] = useState<AircraftData[]>([])
  const [filteredAircraft, setFilteredAircraft] = useState<NormalizedAircraft[]>([])
  const [recentlyUsed, setRecentlyUsed] = useState<NormalizedAircraft[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadingProgress, setLoadingProgress] = useState("")
  const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE)

  const listRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)

  // Load aircraft database
  useEffect(() => {
    let mounted = true

    async function loadDatabase() {
      setIsLoading(true)

      if (isAircraftDatabaseLoaded()) {
        setLoadingProgress("Loading from cache...")
      } else {
        setLoadingProgress("Downloading aircraft database (14MB)...")
      }

      try {
        const aircraft = await getAircraftDatabase()
        if (mounted) {
          setAllAircraft(aircraft)
          setLoadingProgress("")

          // Load recently used aircraft
          const prefs = await getUserPreferences()
          const recentRegs = prefs?.recentlyUsedAircraft || []
          const recentAc: NormalizedAircraft[] = []

          for (const reg of recentRegs) {
            const found = aircraft.find((ac) => ac.registration?.toUpperCase() === reg.toUpperCase())
            if (found) {
              recentAc.push({
                registration: found.registration || "",
                icao24: found.icao24 || "",
                manufacturer: found.manufacturername || "",
                model: found.model || "",
                typecode: found.typecode || "",
                operator: found.operator || "",
                owner: found.owner || "",
                serial: found.serialnumber || "",
                built: found.built || "",
                status: found.status || "",
                category: found.categoryDescription || "",
              })
            }
          }
          setRecentlyUsed(recentAc)
        }
      } catch (error) {
        console.error("[Aircraft Page] Failed to load database:", error)
        setLoadingProgress("Failed to load aircraft database")
      } finally {
        if (mounted) setIsLoading(false)
      }
    }

    loadDatabase()
    return () => {
      mounted = false
    }
  }, [])

  // Search aircraft
  useEffect(() => {
    if (searchQuery.length >= 2) {
      const results = searchAircraft(allAircraft, searchQuery, 200)
      setFilteredAircraft(results)
      setDisplayCount(ITEMS_PER_PAGE)
    } else {
      setFilteredAircraft([])
    }
  }, [searchQuery, allAircraft])

  // Infinite scroll observer
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect()
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setDisplayCount((prev) => prev + ITEMS_PER_PAGE)
        }
      },
      { threshold: 0.1 },
    )

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current)
    }

    return () => observerRef.current?.disconnect()
  }, [filteredAircraft])

  // Handle aircraft selection
  const handleSelectAircraft = useCallback(
    async (aircraft: NormalizedAircraft) => {
      // Save to recently used
      const prefs = await getUserPreferences()
      const recentRegs = prefs?.recentlyUsedAircraft || []
      const filtered = recentRegs.filter((r) => r.toUpperCase() !== aircraft.registration.toUpperCase())
      const updated = [aircraft.registration, ...filtered].slice(0, 10)
      await saveUserPreferences({ recentlyUsedAircraft: updated })

      if (selectMode) {
        // Navigate back to flight form with selected aircraft
        const params = new URLSearchParams()
        params.set("field", fieldName)
        params.set("aircraftReg", aircraft.registration)
        params.set("aircraftType", aircraft.typecode || aircraft.model)
        router.push(`${returnTo}?${params.toString()}`)
      } else {
        // Navigate to aircraft detail page
        router.push(`/aircraft/${encodeURIComponent(aircraft.registration)}`)
      }
    },
    [selectMode, returnTo, fieldName, router],
  )

  const displayedAircraft = filteredAircraft.slice(0, displayCount)
  const showRecentlyUsed = !searchQuery && recentlyUsed.length > 0

  return (
    <div className="flex flex-col h-[100dvh] bg-background">
      {/* Header */}
      <div className="flex-shrink-0 bg-card border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => router.back()}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search registration, type, model..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-10"
              autoFocus
            />
          </div>
        </div>
        {loadingProgress && (
          <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{loadingProgress}</span>
          </div>
        )}
      </div>

      {/* Aircraft List */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground text-sm text-center">
              {loadingProgress || "Loading aircraft database..."}
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {/* Recently Used Section */}
            {showRecentlyUsed && (
              <div className="mb-4">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-2 mb-2">
                  Recently Used
                </h3>
                <div className="space-y-1">
                  {recentlyUsed.map((aircraft) => (
                    <AircraftCard
                      key={`recent-${aircraft.registration}`}
                      aircraft={aircraft}
                      onSelect={handleSelectAircraft}
                      isRecent
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Search Results */}
            {searchQuery.length >= 2 && (
              <>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-2">
                  {filteredAircraft.length > 0 ? `${filteredAircraft.length} results` : "No results found"}
                </h3>
                <div className="space-y-1">
                  {displayedAircraft.map((aircraft, index) => (
                    <AircraftCard
                      key={`${aircraft.registration}-${index}`}
                      aircraft={aircraft}
                      onSelect={handleSelectAircraft}
                    />
                  ))}
                </div>

                {/* Load more trigger */}
                {displayCount < filteredAircraft.length && (
                  <div ref={loadMoreRef} className="py-4 text-center">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </div>
                )}
              </>
            )}

            {/* Empty state */}
            {!searchQuery && !showRecentlyUsed && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Plane className="h-12 w-12 text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground">Search for aircraft by registration, type code, or model</p>
                <p className="text-sm text-muted-foreground/70 mt-1">
                  Database contains {allAircraft.length.toLocaleString()} aircraft
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Aircraft Card Component
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
      onClick={() => onSelect(aircraft)}
      className={`w-full text-left p-3 rounded-lg transition-all active:scale-[0.98] ${
        isRecent
          ? "bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20"
          : "bg-card border border-border hover:border-primary/30"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Registration and Type */}
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-foreground">{aircraft.registration}</span>
            {aircraft.typecode && (
              <span className="text-sm font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                {aircraft.typecode}
              </span>
            )}
          </div>

          {/* Model and Manufacturer */}
          <div className="text-sm text-muted-foreground mt-0.5 truncate">
            {aircraft.model && <span>{aircraft.model}</span>}
            {aircraft.model && aircraft.manufacturer && <span> • </span>}
            {aircraft.manufacturer && <span>{aircraft.manufacturer}</span>}
          </div>

          {/* Operator */}
          {aircraft.operator && (
            <div className="text-xs text-muted-foreground/70 mt-0.5 truncate">{aircraft.operator}</div>
          )}
        </div>

        <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-1" />
      </div>
    </button>
  )
}
