"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { SyncStatus } from "@/components/sync-status"
import { BottomNavbar } from "@/components/bottom-navbar"
import { PWAInstallPrompt } from "@/components/pwa-install-prompt"
import { useAirportDatabase } from "@/hooks/use-indexed-db"
import { searchAirports } from "@/lib/airport-database"
import { getRecentlyUsedAirports, addRecentlyUsedAirport, getAirportByIcao } from "@/lib/indexed-db"
import { Search, Loader2, MapPin, Clock, ArrowLeft } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"

const ITEMS_PER_PAGE = 50

export default function AirportsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fieldType = searchParams.get("field") // 'departureIcao'/'arrivalIcao' or 'from'/'to'
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
    if (!searchQuery.trim()) {
      return airports.slice(0, displayCount)
    }
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
    if (target) {
      observer.observe(target)
    }

    return () => {
      if (target) {
        observer.unobserve(target)
      }
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
      className={`w-full text-left ${
        isRecent
          ? "bg-gradient-to-br from-primary/20 to-primary/5 border-2 border-primary/40"
          : "bg-card border border-border"
      } rounded-lg p-2 hover:bg-accent transition-all`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`font-bold ${isRecent ? "text-lg text-primary" : "text-base text-foreground"}`}>
              {airport.icao}
            </span>
            {airport.iata && (
              <span className={`${isRecent ? "text-sm" : "text-sm"} text-muted-foreground`}>({airport.iata})</span>
            )}
          </div>

          <div className={`${isRecent ? "text-base font-medium" : "text-sm font-medium"} text-foreground truncate`}>
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
  )

  const getTitle = () => {
    if (!fieldType) return "Airports"
    if (fieldType === "departureIcao" || fieldType === "from") return "Select Departure Airport"
    if (fieldType === "arrivalIcao" || fieldType === "to") return "Select Arrival Airport"
    return "Select Airport"
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-b border-border">
        <div className="container mx-auto px-3">
          <div className="flex items-center justify-between h-12">
            <div className="flex items-center gap-2">
              {fieldType && (
                <Button variant="ghost" size="sm" onClick={() => router.back()} className="h-8 w-8 p-0">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              )}
              <h1 className="text-lg font-semibold text-foreground">{getTitle()}</h1>
            </div>
            <SyncStatus />
          </div>
        </div>
      </div>

      <main className="container mx-auto px-3 pt-14 pb-20">
        <div className="sticky top-12 z-40 bg-background py-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search ICAO, IATA, name, city, or country..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-10"
            />
          </div>
        </div>

        {isLoading && displayCount === ITEMS_PER_PAGE && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading airports...</span>
          </div>
        )}

        {!isLoading && (
          <div className="space-y-3 mt-2">
            {!searchQuery && recentAirports.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2 px-1">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Recently Used</h2>
                </div>
                <div className="space-y-1.5">{recentAirports.map((airport) => renderAirportCard(airport, true))}</div>
                <div className="border-t border-border my-4" />
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
                  All Airports
                </h2>
              </div>
            )}

            <div className="space-y-1">{filteredAirports.map((airport) => renderAirportCard(airport, false))}</div>

            <div ref={observerTarget} className="h-4" />

            {filteredAirports.length === 0 && !isLoading && (
              <div className="text-center py-12">
                <p className="text-sm text-muted-foreground">
                  {searchQuery ? "No airports found matching your search" : "No airports available"}
                </p>
              </div>
            )}

            {filteredAirports.length > 0 && filteredAirports.length < airports.length && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="ml-2 text-xs text-muted-foreground">
                  Showing {filteredAirports.length} of {searchQuery ? "filtered" : airports.length} airports...
                </span>
              </div>
            )}
          </div>
        )}
      </main>

      <BottomNavbar />
      <PWAInstallPrompt />
    </div>
  )
}
