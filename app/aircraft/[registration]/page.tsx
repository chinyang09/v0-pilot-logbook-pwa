"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { ChevronLeft, Plane, Loader2, Calendar, Building2, Hash, Tag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getAircraftDatabase, getAircraftByRegistration, type NormalizedAircraft } from "@/lib/aircraft-database"

export default function AircraftDetailPage() {
  const params = useParams()
  const router = useRouter()
  const registration = decodeURIComponent(params.registration as string)

  const [aircraft, setAircraft] = useState<NormalizedAircraft | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadAircraft() {
      setIsLoading(true)
      try {
        const database = await getAircraftDatabase()
        const found = getAircraftByRegistration(database, registration)
        setAircraft(found || null)
      } catch (error) {
        console.error("[Aircraft Detail] Failed to load:", error)
      } finally {
        setIsLoading(false)
      }
    }

    loadAircraft()
  }, [registration])

  if (isLoading) {
    return (
      <div className="flex flex-col h-[100dvh] bg-background">
        <div className="flex items-center justify-center flex-1">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    )
  }

  if (!aircraft) {
    return (
      <div className="flex flex-col h-[100dvh] bg-background">
        <div className="flex-shrink-0 bg-card border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => router.back()}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-lg font-semibold">Aircraft Not Found</h1>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-muted-foreground">Could not find aircraft with registration: {registration}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-background">
      {/* Header */}
      <div className="flex-shrink-0 bg-card border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => router.back()}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-lg font-bold">{aircraft.registration}</h1>
            {aircraft.typecode && <p className="text-sm text-muted-foreground">{aircraft.typecode}</p>}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Main Info Card */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Plane className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">{aircraft.registration}</h2>
              {aircraft.typecode && (
                <span className="text-sm font-medium text-primary bg-primary/10 px-2 py-0.5 rounded">
                  {aircraft.typecode}
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <InfoItem label="Model" value={aircraft.model} />
            <InfoItem label="Manufacturer" value={aircraft.manufacturer} />
            <InfoItem label="Category" value={aircraft.category} />
            <InfoItem label="Serial Number" value={aircraft.serial} />
          </div>
        </div>

        {/* Operator Info */}
        {(aircraft.operator || aircraft.owner) && (
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
              Operator Information
            </h3>
            <div className="space-y-3">
              {aircraft.operator && (
                <div className="flex items-start gap-3">
                  <Building2 className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-muted-foreground">Operator</p>
                    <p className="font-medium">{aircraft.operator}</p>
                  </div>
                </div>
              )}
              {aircraft.owner && (
                <div className="flex items-start gap-3">
                  <Tag className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-muted-foreground">Owner</p>
                    <p className="font-medium">{aircraft.owner}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Technical Info */}
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Technical Details</h3>
          <div className="space-y-3">
            {aircraft.icao24 && (
              <div className="flex items-start gap-3">
                <Hash className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground">ICAO24 (Mode S)</p>
                  <p className="font-mono font-medium">{aircraft.icao24.toUpperCase()}</p>
                </div>
              </div>
            )}
            {aircraft.built && (
              <div className="flex items-start gap-3">
                <Calendar className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground">Year Built</p>
                  <p className="font-medium">{aircraft.built}</p>
                </div>
              </div>
            )}
            {aircraft.status && (
              <div className="flex items-start gap-3">
                <Tag className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <p className="font-medium">{aircraft.status}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium text-sm">{value}</p>
    </div>
  )
}
