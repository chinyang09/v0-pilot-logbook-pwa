"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { SyncStatus } from "@/components/sync-status"
import { PageContainer } from "@/components/page-container"
import { useAirportDatabase } from "@/hooks/use-indexed-db"
import { searchAirports } from "@/lib/airport-database"
import { getRecentlyUsedAirports, addRecentlyUsedAirport, getAirportByIcao } from "@/lib/indexed-db"
import { Search, MapPin, ArrowLeft, ChevronRight } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const ITEMS_PER_PAGE = 50

export default function AirportsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fieldType = searchParams.get("field")
  const returnUrl = searchParams.get("return") || searchParams.get("returnTo") || "/new-flight"

  const { airports, isLoading } = useAirportDatabase()
  const [searchQuery, setSearchQuery] = useState("")
  const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE)
  const [recentAirports, setRecentAirports] = useState<typeof airports>([])

  const observerTarget = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const loadRecentAirports = async () => {
      const recentCodes = await getRecentlyUsedAirports()
      const airports = await Promise.all(recentCodes.map((code) => getAirportByIcao(code)))
      setRecentAirports(airports.filter(Boolean) as typeof recentAirports)
    }
    loadRecentAirports()
  }, [])

  const filteredAirports = useMemo(() => {
    if (!searchQuery.trim()) return airports.slice(0, displayCount)
    return searchAirports(airports, searchQuery, displayCount)
  }, [airports, searchQuery, displayCount])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoading) {
          setDisplayCount((prev) => Math.min(prev + ITEMS_PER_PAGE, airports.length))
        }
      },
      { threshold: 0.1 },
    )
    const target = observerTarget.current
    if (target) observer.observe(target)
    return () => {
      if (target) observer.unobserve(target)
    }
  }, [isLoading, airports.length])

  useEffect(() => {
    setDisplayCount(ITEMS_PER_PAGE)
  }, [searchQuery])

  const handleAirportSelect = async (icao: string) => {
    if (fieldType) {
      await addRecentlyUsedAirport(icao)
      const params = new URLSearchParams()
      params.set("field", fieldType)
      params.set("airport", icao)
      router.push(`${returnUrl}?${params.toString()}`)
    } else {
      router.push(`/airports/${icao}`)
    }
  }

  const renderAirportCard = (airport: (typeof airports)[0], isRecent = false) => (
    <button
      key={airport.icao}
      onClick={() => handleAirportSelect(airport.icao)}
      className={cn(
        "w-full text-left rounded-lg p-3 transition-all active:scale-[0.98]",
        isRecent
          ? "bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20"
          : "bg-card border border-border hover:bg-accent",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-foreground">{airport.icao}</span>
            {airport.iata && (
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{airport.iata}</span>
            )}
          </div>
          <div className="text-sm font-medium text-foreground truncate">{airport.name}</div>
          <div className="flex items-center gap-1 text-sm text-muted-foreground mt-0.5">
            <MapPin className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">
              {airport.city}
              {airport.state && `, ${airport.state}`} · {airport.country}
            </span>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
      </div>
    </button>
  )

  return (
    <PageContainer
      header={
        <header className="flex-none bg-background/95 backdrop-blur-lg border-b border-border z-50">
          <div className="container mx-auto px-3">
            <div className="flex items-center justify-between h-12">
              <div className="flex items-center gap-2">
                {fieldType && (
                  <Button variant="ghost" size="sm" onClick={() => router.back()} className="h-8 w-8 p-0">
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                )}
                <h1 className="text-lg font-semibold text-foreground">
                  {!fieldType ? "Airports" : fieldType.includes("departure") ? "Departure" : "Arrival"}
                </h1>
              </div>
              <SyncStatus />
            </div>
          </div>
        </header>
      }
    >
      <div className="container mx-auto px-3 pt-3 pb-safe">
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
              <h2 className="text-xs font-semibold text-muted-foreground uppercase px-1">Recent</h2>
              <div className="space-y-2">{recentAirports.map((a) => renderAirportCard(a, true))}</div>
              <div className="border-t border-border my-4" />
            </div>
          )}

          {searchQuery && (
            <h2 className="text-xs font-semibold text-muted-foreground uppercase px-1">
              {filteredAirports.length} results
            </h2>
          )}

          <div className="space-y-2">{filteredAirports.map((a) => renderAirportCard(a, false))}</div>

          <div ref={observerTarget} className="h-20" />
        </div>
      </div>
    </PageContainer>
  )
}
