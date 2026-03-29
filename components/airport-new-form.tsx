"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageContainer } from "@/components/page-container"
import { SettingsRow, ReadOnlyRow } from "@/components/ui/settings-row"
import { Loader2, AlertCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { addCustomAirport, getAirportByIcao, updateFlight } from "@/lib/db"
import { syncService } from "@/lib/sync"
import { submitAirportToServer } from "@/lib/submissions/submit"

export interface AirportNewFormProps {
  prefilledCode?: string
  fieldType?: string | null
  flightId?: string | null
  isDetailPanel?: boolean
  onSave?: (icao: string) => void
  onCancel?: () => void
  onViewExisting?: (icao: string) => void
}

export function AirportNewForm({
  prefilledCode = "",
  fieldType,
  flightId,
  isDetailPanel = false,
  onSave,
  onCancel,
  onViewExisting,
}: AirportNewFormProps) {
  const router = useRouter()

  const [isSaving, setIsSaving] = useState(false)
  const [icao, setIcao] = useState(
    prefilledCode.length === 4 ? prefilledCode.toUpperCase() : ""
  )
  const [iata, setIata] = useState(
    prefilledCode.length === 3 ? prefilledCode.toUpperCase() : ""
  )
  const [name, setName] = useState("")
  const [city, setCity] = useState("")
  const [country, setCountry] = useState("")
  const [latitude, setLatitude] = useState("")
  const [longitude, setLongitude] = useState("")
  const [elevation, setElevation] = useState("")
  const [timezone, setTimezone] = useState("")
  const [tzLoading, setTzLoading] = useState(false)
  const tzAbortRef = useRef<AbortController | null>(null)

  // FR24 airport search state
  const [fr24Data, setFr24Data] = useState<{
    icao: string
    iata: string
    name: string
    city: string
    country: string
    countryCode: string
    latitude: number
    longitude: number
    elevation: number
    timezone: string
  } | null>(null)
  const [isFr24Loading, setIsFr24Loading] = useState(false)
  const [fr24Searched, setFr24Searched] = useState(false)
  const [fr24Found, setFr24Found] = useState(false)

  // Duplicate detection state
  const [existingAirport, setExistingAirport] = useState<{
    icao: string
    name: string
  } | null>(null)
  const [isDuplicateChecking, setIsDuplicateChecking] = useState(false)

  const hasValidCode = icao.trim().length > 0 || iata.trim().length > 0

  // Auto-search FR24 + check duplicates when ICAO changes (debounced)
  useEffect(() => {
    const code = icao.trim().toUpperCase()
    if (code.length < 3) {
      setFr24Data(null)
      setFr24Searched(false)
      setFr24Found(false)
      setExistingAirport(null)
      return
    }

    // Reset state when ICAO changes
    setFr24Data(null)
    setFr24Searched(false)
    setFr24Found(false)
    setExistingAirport(null)

    const timer = setTimeout(async () => {
      // 1. Check for duplicates in local DB
      setIsDuplicateChecking(true)
      try {
        const existing = await getAirportByIcao(code)
        if (existing) {
          setExistingAirport({
            icao: existing.icao,
            name: existing.name || "",
          })
          setIsDuplicateChecking(false)
          setFr24Searched(true)
          setIsFr24Loading(false)
          return
        }
      } catch {
        // Ignore duplicate check errors
      } finally {
        setIsDuplicateChecking(false)
      }

      // 2. No duplicate found — search FR24 (only for 4-char ICAO codes)
      if (code.length >= 4) {
        setIsFr24Loading(true)
        try {
          const res = await fetch(
            `/api/search/airport?q=${encodeURIComponent(code)}`,
            { signal: AbortSignal.timeout(5000) }
          )
          if (res.ok) {
            const data = await res.json()
            if (data.result) {
              setFr24Data(data.result)
              setFr24Found(true)
              // Auto-populate all fields from FR24
              if (data.result.iata) setIata(data.result.iata)
              if (data.result.name) setName(data.result.name)
              if (data.result.city) setCity(data.result.city)
              if (data.result.country) setCountry(data.result.country)
              if (data.result.latitude) setLatitude(String(data.result.latitude))
              if (data.result.longitude) setLongitude(String(data.result.longitude))
              if (data.result.elevation) setElevation(String(data.result.elevation))
              if (data.result.timezone) setTimezone(data.result.timezone)
            } else {
              setFr24Data(null)
              setFr24Found(false)
            }
          } else {
            setFr24Data(null)
            setFr24Found(false)
          }
        } catch {
          setFr24Data(null)
          setFr24Found(false)
        } finally {
          setIsFr24Loading(false)
          setFr24Searched(true)
        }
      } else {
        setFr24Searched(true)
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [icao])

  // Auto-derive timezone from lat/lng via geo-tz API (only when FR24 didn't provide timezone)
  useEffect(() => {
    // Skip if FR24 already provided timezone
    if (fr24Found && fr24Data?.timezone) return

    const lat = parseFloat(latitude)
    const lng = parseFloat(longitude)
    if (isNaN(lat) || isNaN(lng)) return

    // Abort previous request
    tzAbortRef.current?.abort()
    const controller = new AbortController()
    tzAbortRef.current = controller

    setTzLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/timezone?lat=${lat}&lng=${lng}`,
          { signal: controller.signal }
        )
        if (!res.ok) throw new Error("Timezone lookup failed")
        const data = await res.json()
        if (data.tz) {
          setTimezone(data.tz)
        }
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          console.error("[NewAirport] Timezone lookup failed:", err)
        }
      } finally {
        if (!controller.signal.aborted) setTzLoading(false)
      }
    }, 500)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [latitude, longitude, fr24Found, fr24Data?.timezone])

  const handleSave = async () => {
    if (!hasValidCode || existingAirport) return

    setIsSaving(true)
    try {
      const icaoCode = icao.trim().toUpperCase() || iata.trim().toUpperCase()
      const lat = parseFloat(latitude) || 0
      const lng = parseFloat(longitude) || 0
      const elev = parseFloat(elevation) || 0

      const newAirport = await addCustomAirport({
        icao: icaoCode,
        iata: iata.trim().toUpperCase(),
        name: name.trim(),
        city: city.trim(),
        state: "",
        country: country.trim(),
        latitude: lat,
        longitude: lng,
        elevation: elev,
        tz: timezone.trim() || "UTC",
        isCustom: true,
      })

      // Fire-and-forget server submission for enrichment
      if (newAirport.submissionId) {
        submitAirportToServer({
          submissionId: newAirport.submissionId,
          icao: icaoCode,
          name: name.trim(),
          iata: iata.trim().toUpperCase(),
          city: city.trim(),
          country: country.trim(),
          timezone: timezone.trim(),
          latitude: lat,
          longitude: lng,
          elevation: elev,
        })
      }

      if (fieldType && flightId) {
        const updates: Record<string, string> = {}
        if (fieldType === "departureIcao") {
          updates.departureIcao = icaoCode
          updates.departureIata = iata.trim().toUpperCase()
        } else if (fieldType === "arrivalIcao") {
          updates.arrivalIcao = icaoCode
          updates.arrivalIata = iata.trim().toUpperCase()
        }
        await updateFlight(flightId, updates)
        syncService.notifyDataChange()
      }

      if (onSave) {
        onSave(icaoCode)
      } else {
        router.back()
      }
    } catch (error) {
      console.error("Failed to save airport:", error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    if (onCancel) {
      onCancel()
    } else {
      router.back()
    }
  }

  const handleViewExisting = () => {
    if (existingAirport && onViewExisting) {
      onViewExisting(existingAirport.icao)
    }
  }

  const isDuplicate = !!existingAirport
  const canSave = hasValidCode && !isDuplicate && !isSaving
  // Show manual fields only when FR24 didn't provide data
  const showManualFields = fr24Searched && !fr24Found && !existingAirport

  const formContent = (
    <div className="container mx-auto px-3 pt-4 pb-safe">
      {/* Main Info Card */}
      <div className="bg-card rounded-xl overflow-hidden mb-6 border border-border">
        <div className="px-4">
          <SettingsRow
            label="ICAO Code"
            value={icao}
            onChange={setIcao}
            placeholder="e.g. WSSL"
            uppercase
            required
          />

          {/* Duplicate detection banner */}
          {isDuplicateChecking && icao.trim().length >= 3 && (
            <div className="flex items-center gap-2 px-0 py-2.5 border-b border-border text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Checking database...
            </div>
          )}
          {existingAirport && (
            <div className="py-2.5 border-b border-border">
              <div className="flex items-center justify-between">
                <div className="text-xs">
                  <span className="text-amber-500 font-medium flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    Already exists:
                  </span>
                  <span className="text-foreground font-semibold ml-1">{existingAirport.icao}</span>
                  {existingAirport.name && (
                    <span className="text-muted-foreground"> — {existingAirport.name}</span>
                  )}
                </div>
                {onViewExisting && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleViewExisting}
                    className="text-primary h-6 px-2 text-xs font-semibold"
                  >
                    View
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* FR24 auto-search status */}
          {!existingAirport && isFr24Loading && icao.trim().length >= 4 && (
            <div className="flex items-center gap-2 px-0 py-2.5 border-b border-border text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Searching...
            </div>
          )}

          {/* FR24 match found — show summary */}
          {!existingAirport && !isFr24Loading && fr24Found && fr24Data && (
            <div className="py-2.5 border-b border-border">
              <div className="text-xs">
                <span className="text-primary font-medium">Found: </span>
                <span className="text-foreground font-semibold">{fr24Data.name}</span>
                {fr24Data.city && (
                  <span className="text-muted-foreground"> — {fr24Data.city}, {fr24Data.country}</span>
                )}
              </div>
            </div>
          )}

          {/* FR24 no results — editable fields below */}
          {!existingAirport && !isFr24Loading && !fr24Found && fr24Searched && icao.trim().length >= 4 && (
            <div className="py-2.5 border-b border-border text-xs text-muted-foreground">
              Not found online — enter details manually below.
            </div>
          )}

          {/* FR24 found — show read-only fields */}
          {fr24Found && fr24Data && (
            <>
              <ReadOnlyRow label="IATA Code" value={fr24Data.iata || "-"} />
              <ReadOnlyRow label="Name" value={fr24Data.name || "-"} />
              <ReadOnlyRow label="City" value={fr24Data.city || "-"} />
              <ReadOnlyRow label="Country" value={fr24Data.country || "-"} />
            </>
          )}

          {/* Manual fields — only visible when FR24 failed/offline */}
          {showManualFields && (
            <>
              <SettingsRow
                label="IATA Code"
                value={iata}
                onChange={setIata}
                placeholder="e.g. XSP"
                uppercase
              />
              <SettingsRow
                label="Name"
                value={name}
                onChange={setName}
                placeholder="Airport name"
              />
              <SettingsRow
                label="City"
                value={city}
                onChange={setCity}
                placeholder="City"
              />
              <SettingsRow
                label="Country"
                value={country}
                onChange={setCountry}
                placeholder="e.g. Singapore"
              />
            </>
          )}
        </div>
      </div>

      {/* Location Card — read-only when FR24 found, editable when FR24 failed */}
      {fr24Found && fr24Data && (
        <div className="bg-card rounded-xl overflow-hidden mb-6 border border-border">
          <div className="px-4">
            <ReadOnlyRow label="Latitude" value={fr24Data.latitude ? String(fr24Data.latitude) : "-"} />
            <ReadOnlyRow label="Longitude" value={fr24Data.longitude ? String(fr24Data.longitude) : "-"} />
            <ReadOnlyRow label="Elevation (ft)" value={fr24Data.elevation ? String(fr24Data.elevation) : "-"} />
            <ReadOnlyRow label="Timezone" value={fr24Data.timezone || "-"} />
          </div>
        </div>
      )}

      {showManualFields && (
        <div className="bg-card rounded-xl overflow-hidden mb-6 border border-border">
          <div className="px-4">
            <SettingsRow
              label="Latitude"
              value={latitude}
              onChange={setLatitude}
              placeholder="e.g. 1.3644"
              inputMode="decimal"
            />
            <SettingsRow
              label="Longitude"
              value={longitude}
              onChange={setLongitude}
              placeholder="e.g. 103.9915"
              inputMode="decimal"
            />
            <SettingsRow
              label="Elevation (ft)"
              value={elevation}
              onChange={setElevation}
              placeholder="e.g. 40"
              inputMode="numeric"
            />
            <div className="flex items-center justify-between py-3 border-b border-border last:border-b-0">
              <span className="text-foreground">Timezone</span>
              <div className="flex items-center gap-2">
                {tzLoading && (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                )}
                <Input
                  value={timezone}
                  readOnly
                  tabIndex={-1}
                  placeholder={
                    latitude && longitude
                      ? "Calculating..."
                      : "Enter coordinates above"
                  }
                  className="text-right border-0 bg-transparent h-auto p-0 w-auto max-w-[200px] text-muted-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0 cursor-default"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground px-4">
        {fr24Found
          ? "Airport details found and will be saved automatically."
          : "Enter the ICAO code. Additional details can be entered manually if not found online."
        }
      </p>
    </div>
  )

  const headerContent = (
    <header className="bg-background/30 backdrop-blur-xl border-b border-border/50 z-50">
      <div className="container mx-auto px-3">
        <div className="flex items-center justify-between h-12">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCancel}
            className="text-primary h-8 px-2"
          >
            Cancel
          </Button>
          <h1 className="text-lg font-semibold truncate px-2">
            New Airport
          </h1>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSave}
            disabled={!canSave}
            className="text-primary h-8 px-2 font-semibold"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Save"
            )}
          </Button>
        </div>
      </div>
    </header>
  )

  if (isDetailPanel) {
    return (
      <div className="h-full relative flex flex-col">
        {/* Header - absolute overlay for frosted glass (matches detail panel pattern) */}
        <div className="absolute top-0 left-0 right-0 z-50">
          {headerContent}
        </div>
        {/* Scrollable Content */}
        <div className="flex-1 overflow-auto pt-12">
          {formContent}
        </div>
      </div>
    )
  }

  return (
    <PageContainer header={headerContent}>
      {formContent}
    </PageContainer>
  )
}
