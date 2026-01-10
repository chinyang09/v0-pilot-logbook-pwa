"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Search, Plane, ArrowLeft, Loader2, ChevronRight } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  getAircraftDatabase,
  searchAircraft,
  type AircraftData,
  type NormalizedAircraft,
  normalizeAircraft,
  setProgressCallback,
} from "@/lib/reference/aircraft-database"
import { getUserPreferences, saveUserPreferences } from "@/lib/indexed-db"
import { PageContainer } from "@/components/page-container"
import { SyncStatus } from "@/components/sync-status"

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
    if (searchQuery.length >= 2) {
      const results = searchAircraft(allAircraft, searchQuery, 200)
      setFilteredAircraft(results)
      setDisplayCount(ITEMS_PER_PAGE)
    } else {
      setFilteredAircraft([])
    }
  }, [searchQuery, allAircraft])

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
        const params = new URLSearchParams()
        params.set("field", fieldName)
        params.set("aircraftReg", aircraft.registration)
        params.set("aircraftType", aircraft.typecode)
        router.push(`${returnTo}?${params.toString()}`)
      } else {
        router.push(`/aircraft/${encodeURIComponent(aircraft.registration || aircraft.icao24)}`)
      }
    },
    [selectMode, returnTo, fieldName, router],
  )

  const displayedAircraft = filteredAircraft.slice(0, displayCount)
  const showRecentlyUsed = !searchQuery && recentlyUsed.length > 0

  return (
    <PageContainer
      header={
        <header className="flex-none bg-background/30 backdrop-blur-xl border-b border-border/50 z-50">
          <div className="container mx-auto px-3">
            <div className="flex items-center justify-between h-12">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => router.back()} className="h-8 w-8 p-0">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
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
        <div className="container mx-auto px-3 pt-3 pb-safe">
          <div className="sticky top-0 z-40 bg-background/30 backdrop-blur-xl pb-3">
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

          <div className="space-y-3">
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

            {searchQuery.length >= 2 && (
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

            {!searchQuery && !showRecentlyUsed && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Plane className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-sm text-muted-foreground">Search for aircraft by registration or type</p>
              </div>
            )}
          </div>
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
