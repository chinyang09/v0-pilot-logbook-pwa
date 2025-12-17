"use client"

import type React from "react"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronLeft,
  ChevronRight,
  Plane,
  PlaneTakeoff,
  PlaneLanding,
  User,
  ArrowLeftRight,
  Plus,
  Trash2,
} from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { TimePicker } from "@/components/time-picker"
import { DatePicker } from "@/components/date-picker"
import type { FlightLog, AdditionalCrew, Approach } from "@/lib/indexed-db"
import { updateFlight } from "@/lib/indexed-db"
import { useAirportDatabase } from "@/hooks/use-indexed-db"
import { getAirportByICAO } from "@/lib/airport-database"
import { addRecentlyUsedAirport, addRecentlyUsedAircraft } from "@/lib/user-preferences"
import {
  createEmptyFlightLog,
  calculateBlockTime,
  calculateFlightTime,
  calculateNightTimeFromFlight,
  calculateDayTime,
  calculateTakeoffsLandings,
  calculateRoleTimes,
  getApproachCategory, // Import getApproachCategory
} from "@/lib/flight-calculations"
import { formatTimeShort, utcToLocal, formatTimezoneOffset, getCurrentTimeUTC, isValidHHMM } from "@/lib/time-utils" // Import minutesToHHMM

const FORM_STORAGE_KEY = "flight-form-draft"

// Swipeable row component
function SwipeableRow({
  children,
  onClear,
}: {
  children: React.ReactNode
  onClear: () => void
}) {
  const [offset, setOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const startX = useRef(0)
  const currentOffset = useRef(0)

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX
    currentOffset.current = offset
    setIsDragging(true)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return
    const diff = startX.current - e.touches[0].clientX
    const newOffset = Math.max(0, Math.min(80, currentOffset.current + diff))
    setOffset(newOffset)
  }

  const handleTouchEnd = () => {
    setIsDragging(false)
    if (offset > 40) {
      setOffset(80)
    } else {
      setOffset(0)
    }
  }

  return (
    <div className="relative overflow-hidden">
      <div
        className="absolute right-0 top-0 bottom-0 w-20 bg-destructive flex items-center justify-center"
        onClick={() => {
          onClear()
          setOffset(0)
        }}
      >
        <span className="text-destructive-foreground text-sm font-medium">Clear</span>
      </div>
      <div
        className="relative bg-card transition-transform"
        style={{ transform: `translateX(-${offset}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  )
}

function SettingsRow({
  label,
  value,
  placeholder,
  onClick,
  showChevron = false,
  icon,
  children,
}: {
  label: string
  value?: string
  placeholder?: string
  onClick?: () => void
  showChevron?: boolean
  icon?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div
      className={`flex items-center justify-between py-3.5 px-4 border-b border-border last:border-b-0 ${onClick ? "cursor-pointer active:bg-muted/50" : ""}`}
      onClick={onClick}
    >
      <span className="text-foreground">{label}</span>
      <div className="flex items-center gap-2">
        {children || (
          <span className={value ? "text-foreground" : "text-muted-foreground"}>{value || placeholder || "-"}</span>
        )}
        {/* Icon appears next to value, before chevron */}
        {icon && <span className="text-muted-foreground">{icon}</span>}
        {showChevron && <ChevronRight className="h-5 w-5 text-muted-foreground/50" />}
      </div>
    </div>
  )
}

// Time row with UTC and Local display
function TimeRow({
  label,
  utcValue,
  timezoneOffset,
  onTap,
  onNow,
  showNow = true,
}: {
  label: string
  utcValue: string
  timezoneOffset: number
  onTap: () => void
  onNow?: () => void
  showNow?: boolean
}) {
  const localValue = utcToLocal(utcValue, timezoneOffset)
  const tzLabel = formatTimezoneOffset(timezoneOffset)
  const hasValue = isValidHHMM(utcValue)

  return (
    <div className="flex items-center justify-between py-3.5 px-4 border-b border-border last:border-b-0">
      <span className="text-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-end cursor-pointer" onClick={onTap}>
          <span className={`text-lg ${hasValue ? "text-foreground" : "text-muted-foreground"}`}>
            {hasValue ? utcValue : "--:--"}
          </span>
          <span className="text-xs text-muted-foreground">UTC</span>
        </div>
        <div className="flex flex-col items-end">
          {showNow && !hasValue ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs border-primary text-primary bg-transparent"
              onClick={(e) => {
                e.stopPropagation()
                onNow?.()
              }}
            >
              NOW
            </Button>
          ) : (
            <>
              <span className={`text-lg ${hasValue ? "text-foreground" : "text-muted-foreground"}`}>
                {hasValue ? localValue : "--:--"}
              </span>
              <span className="text-xs text-muted-foreground">{tzLabel}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Time display row for calculated values
function TimeDisplayRow({
  label,
  value,
  secondaryLabel,
  secondaryValue,
  onUse,
  useLabel,
  showUseButton = false,
}: {
  label: string
  value: string
  secondaryLabel?: string
  secondaryValue?: string
  onUse?: () => void
  useLabel?: string
  showUseButton?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-3.5 px-4 border-b border-border last:border-b-0">
      <span className="text-foreground">{label}</span>
      <div className="flex items-center gap-4">
        {secondaryLabel && secondaryValue ? (
          <>
            <span className="text-foreground">{formatTimeShort(value)}</span>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">{secondaryLabel}</span>
              <span className="text-foreground">{formatTimeShort(secondaryValue)}</span>
            </div>
          </>
        ) : showUseButton && onUse ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs border-primary text-primary bg-transparent"
            onClick={onUse}
          >
            {useLabel || "USE"}
          </Button>
        ) : (
          <span className="text-foreground">{formatTimeShort(value)}</span>
        )}
      </div>
    </div>
  )
}

// Number row for counts
function NumberRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="flex items-center justify-between py-3.5 px-4 border-b border-border last:border-b-0">
      <span className="text-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 rounded-full bg-transparent"
          onClick={() => onChange(Math.max(0, value - 1))}
        >
          -
        </Button>
        <span className="text-foreground w-8 text-center">{value}</span>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 rounded-full bg-transparent"
          onClick={() => onChange(value + 1)}
        >
          +
        </Button>
      </div>
    </div>
  )
}

// Toggle row
function ToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-3.5 px-4 border-b border-border last:border-b-0">
      <span className="text-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

interface FlightFormProps {
  onFlightAdded: (flight: FlightLog) => void
  onClose: () => void
  editingFlight?: FlightLog | null
  selectedAirportField?: string | null
  selectedAirportCode?: string | null
  selectedAircraftReg?: string | null
  selectedAircraftType?: string | null
  selectedCrewField?: string | null
  selectedCrewId?: string | null
  selectedCrewName?: string | null
}

export function FlightForm({
  onFlightAdded,
  onClose,
  editingFlight,
  selectedAirportField,
  selectedAirportCode,
  selectedAircraftReg,
  selectedAircraftType,
  selectedCrewField,
  selectedCrewId,
  selectedCrewName,
}: FlightFormProps) {
  const router = useRouter()
  const { airports } = useAirportDatabase()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeTimePicker, setActiveTimePicker] = useState<string | null>(null)

  const [datePickerOpen, setDatePickerOpen] = useState(false)

  const editingFlightInitializedRef = useRef<string | null>(null)

  const selectionsProcessedRef = useRef<{
    airport?: string
    aircraft?: string
    crew?: string
  }>({})

  // Initialize form data
  const [formData, setFormData] = useState<Partial<FlightLog>>(() => {
    if (typeof window !== "undefined") {
      const saved = sessionStorage.getItem(FORM_STORAGE_KEY)
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          // If we have editingFlight with same ID, merge saved data
          if (editingFlight && parsed.id === editingFlight.id) {
            editingFlightInitializedRef.current = editingFlight.id
            return { ...editingFlight, ...parsed }
          }
          return { ...createEmptyFlightLog(), ...parsed }
        } catch {
          // Ignore parse errors
        }
      }
    }
    if (editingFlight) {
      editingFlightInitializedRef.current = editingFlight.id
    }
    return editingFlight || createEmptyFlightLog()
  })

  // Track manual overrides state
  const [manualOverrides, setManualOverrides] = useState<FlightLog["manualOverrides"]>(
    editingFlight?.manualOverrides || {},
  )

  // Get airport data for timezone calculations
  const depAirport = useMemo(
    () => (formData.departureIcao ? getAirportByICAO(airports, formData.departureIcao) : null),
    [airports, formData.departureIcao],
  )
  const arrAirport = useMemo(
    () => (formData.arrivalIcao ? getAirportByICAO(airports, formData.arrivalIcao) : null),
    [airports, formData.arrivalIcao],
  )

  // Get timezone offsets
  const depTimezone = depAirport?.timezone || formData.departureTimezone || 0
  const arrTimezone = arrAirport?.timezone || formData.arrivalTimezone || 0

  useEffect(() => {
    if (!editingFlight) return

    // Only initialize if this is a new/different flight
    if (editingFlightInitializedRef.current === editingFlight.id) {
      return
    }

    editingFlightInitializedRef.current = editingFlight.id

    // Check sessionStorage for saved data
    const saved = sessionStorage.getItem(FORM_STORAGE_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        // If sessionStorage has data for this flight, merge it
        if (parsed.id === editingFlight.id) {
          setFormData({ ...editingFlight, ...parsed })
          setManualOverrides(parsed.manualOverrides || editingFlight.manualOverrides || {})
          return
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Otherwise, use editingFlight data
    setFormData(editingFlight)
    setManualOverrides(editingFlight.manualOverrides || {})
  }, [editingFlight])

  useEffect(() => {
    if (!selectedAirportField || !selectedAirportCode) return

    const selectionKey = `${selectedAirportField}:${selectedAirportCode}`
    if (selectionsProcessedRef.current.airport === selectionKey) return

    console.log("[v0] Processing airport selection:", selectedAirportField, selectedAirportCode)
    selectionsProcessedRef.current.airport = selectionKey

    setFormData((prev) => {
      const updated = { ...prev }
      if (selectedAirportField === "departureIcao") {
        updated.departureIcao = selectedAirportCode
        updated.departureIata = "" // Will be filled when airports load
        console.log("[v0] Set departureIcao to:", selectedAirportCode)
      } else if (selectedAirportField === "arrivalIcao") {
        updated.arrivalIcao = selectedAirportCode
        updated.arrivalIata = "" // Will be filled when airports load
        console.log("[v0] Set arrivalIcao to:", selectedAirportCode)
      }
      // Save to sessionStorage
      sessionStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(updated))
      return updated
    })

    addRecentlyUsedAirport(selectedAirportCode)

    // Clear URL params
    const url = new URL(window.location.href)
    url.searchParams.delete("field")
    url.searchParams.delete("airport")
    window.history.replaceState({}, "", url.toString())
  }, [selectedAirportField, selectedAirportCode])

  useEffect(() => {
    if (airports.length === 0) return

    setFormData((prev) => {
      const updated = { ...prev }
      let changed = false

      if (prev.departureIcao) {
        const airport = getAirportByICAO(airports, prev.departureIcao)
        if (airport && (!prev.departureIata || prev.departureTimezone === undefined)) {
          updated.departureIata = airport.iata || ""
          updated.departureTimezone = airport.timezone || 0
          changed = true
          console.log("[v0] Updated departure airport details:", airport.iata, airport.timezone)
        }
      }

      if (prev.arrivalIcao) {
        const airport = getAirportByICAO(airports, prev.arrivalIcao)
        if (airport && (!prev.arrivalIata || prev.arrivalTimezone === undefined)) {
          updated.arrivalIata = airport.iata || ""
          updated.arrivalTimezone = airport.timezone || 0
          changed = true
          console.log("[v0] Updated arrival airport details:", airport.iata, airport.timezone)
        }
      }

      if (changed) {
        sessionStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(updated))
      }
      return changed ? updated : prev
    })
  }, [airports, formData.departureIcao, formData.arrivalIcao])

  useEffect(() => {
    if (!selectedAircraftReg) return

    const selectionKey = `${selectedAircraftReg}:${selectedAircraftType}`
    if (selectionsProcessedRef.current.aircraft === selectionKey) return

    console.log("[v0] Processing aircraft selection:", selectedAircraftReg, selectedAircraftType)
    selectionsProcessedRef.current.aircraft = selectionKey

    setFormData((prev) => {
      const updated = {
        ...prev,
        aircraftReg: selectedAircraftReg,
        aircraftType: selectedAircraftType || prev.aircraftType,
      }
      sessionStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(updated))
      console.log("[v0] Set aircraftReg to:", selectedAircraftReg)
      return updated
    })

    addRecentlyUsedAircraft(selectedAircraftReg)

    // Clear URL params
    const url = new URL(window.location.href)
    url.searchParams.delete("field")
    url.searchParams.delete("aircraftReg")
    url.searchParams.delete("aircraftType")
    window.history.replaceState({}, "", url.toString())
  }, [selectedAircraftReg, selectedAircraftType])

  useEffect(() => {
    if (!selectedCrewField || !selectedCrewId) return

    const selectionKey = `${selectedCrewField}:${selectedCrewId}`
    if (selectionsProcessedRef.current.crew === selectionKey) return

    console.log("[v0] Processing crew selection:", selectedCrewField, selectedCrewId, selectedCrewName)
    selectionsProcessedRef.current.crew = selectionKey

    setFormData((prev) => {
      const updated = { ...prev }
      if (selectedCrewField === "picId") {
        updated.picId = selectedCrewId
        updated.picName = selectedCrewName || ""
        console.log("[v0] Set picId to:", selectedCrewId)
      } else if (selectedCrewField === "sicId") {
        updated.sicId = selectedCrewId
        updated.sicName = selectedCrewName || ""
        console.log("[v0] Set sicId to:", selectedCrewId)
      }
      sessionStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(updated))
      return updated
    })

    // Clear URL params
    const url = new URL(window.location.href)
    url.searchParams.delete("field")
    url.searchParams.delete("crewId")
    url.searchParams.delete("crewName")
    window.history.replaceState({}, "", url.toString())
  }, [selectedCrewField, selectedCrewId, selectedCrewName])

  // Calculate derived fields
  const calculatedFields = useMemo(() => {
    const blockTime =
      formData.outTime && formData.inTime && isValidHHMM(formData.outTime) && isValidHHMM(formData.inTime)
        ? calculateBlockTime(formData.outTime, formData.inTime)
        : "00:00"

    const flightTime =
      formData.offTime && formData.onTime && isValidHHMM(formData.offTime) && isValidHHMM(formData.onTime)
        ? calculateFlightTime(formData.offTime, formData.onTime)
        : "00:00"

    console.log("[v0] calculatedFields - inputs:", {
      date: formData.date,
      outTime: formData.outTime, // Changed from offTime
      inTime: formData.inTime, // Changed from onTime
      depAirport: depAirport ? { icao: depAirport.icao, lat: depAirport.latitude, lon: depAirport.longitude } : null,
      arrAirport: arrAirport ? { icao: arrAirport.icao, lat: arrAirport.latitude, lon: arrAirport.longitude } : null,
    })

    const nightTime =
      formData.date &&
      formData.outTime && // Changed from offTime
      formData.inTime && // Changed from onTime
      depAirport &&
      arrAirport &&
      isValidHHMM(formData.outTime) && // Changed from offTime
      isValidHHMM(formData.inTime) // Changed from onTime
        ? calculateNightTimeFromFlight(formData.date, formData.outTime, formData.inTime, depAirport, arrAirport)
        : "00:00"

    const dayTime = calculateDayTime(blockTime, nightTime)

    console.log("[v0] calculatedFields - times:", {
      blockTime,
      flightTime,
      nightTime,
      dayTime,
    })

    const toLdg =
      formData.date && formData.offTime && formData.onTime && depAirport && arrAirport
        ? calculateTakeoffsLandings(
            formData.date,
            formData.offTime,
            formData.onTime,
            depAirport,
            arrAirport,
            formData.pilotFlying ?? true,
          )
        : { dayTakeoffs: 0, dayLandings: 0, nightTakeoffs: 0, nightLandings: 0 }

    const roleTimes = calculateRoleTimes(blockTime, formData.pilotRole || "PIC")

    return {
      blockTime,
      flightTime,
      nightTime,
      dayTime,
      ...toLdg,
      ...roleTimes,
    }
  }, [
    formData.date,
    formData.outTime, // Changed from offTime
    formData.offTime,
    formData.onTime,
    formData.inTime, // Changed from onTime
    formData.pilotFlying,
    formData.pilotRole,
    depAirport,
    arrAirport,
  ])

  // Update form with calculated values (respecting manual overrides)
  useEffect(() => {
    setFormData((prev) => {
      const updates: Partial<FlightLog> = {
        blockTime: calculatedFields.blockTime,
        flightTime: calculatedFields.flightTime,
      }

      // Only update night/day if not manually overridden
      if (!manualOverrides.nightTime) {
        updates.nightTime = calculatedFields.nightTime
        updates.dayTime = calculatedFields.dayTime
      }

      // Only update T/O and landings if not manually overridden
      if (!manualOverrides.dayTakeoffs && !manualOverrides.nightTakeoffs) {
        updates.dayTakeoffs = calculatedFields.dayTakeoffs
        updates.nightTakeoffs = calculatedFields.nightTakeoffs
      }
      if (!manualOverrides.dayLandings && !manualOverrides.nightLandings) {
        updates.dayLandings = calculatedFields.dayLandings
        updates.nightLandings = calculatedFields.nightLandings
      }

      if (!manualOverrides.picTime) {
        updates.picTime = calculatedFields.picTime
      }
      if (!manualOverrides.sicTime) {
        updates.sicTime = calculatedFields.sicTime
      }
      if (!manualOverrides.picusTime) {
        updates.picusTime = calculatedFields.picusTime
      }
      if (!manualOverrides.dualTime) {
        updates.dualTime = calculatedFields.dualTime
      }
      if (!manualOverrides.instructorTime) {
        updates.instructorTime = calculatedFields.instructorTime
      }

      return { ...prev, ...updates }
    })
  }, [calculatedFields, manualOverrides])

  // Save to session storage on form data change
  useEffect(() => {
    if (formData && typeof window !== "undefined") {
      sessionStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(formData))
    }
  }, [formData])

  // Update field helper
  const updateField = useCallback(<K extends keyof FlightLog>(field: K, value: FlightLog[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }, [])

  // Mark manual override
  const markManualOverride = useCallback((field: keyof FlightLog["manualOverrides"], value: boolean) => {
    setManualOverrides((prev) => ({ ...prev, [field]: value }))
  }, [])

  // Clear a field
  const clearField = useCallback(
    (field: keyof FlightLog) => {
      if (
        field === "dayTakeoffs" ||
        field === "nightTakeoffs" ||
        field === "dayLandings" ||
        field === "nightLandings" ||
        field === "autolands" ||
        field === "holds"
      ) {
        updateField(field, 0)
      } else {
        updateField(field, "" as any)
      }
      // Clear manual override when clearing field
      if (field in (manualOverrides || {})) {
        markManualOverride(field as keyof FlightLog["manualOverrides"], false)
      }
    },
    [updateField, markManualOverride, manualOverrides],
  )

  // Open pickers
  const openAirportPicker = (field: "departureIcao" | "arrivalIcao") => {
    sessionStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(formData))
    router.push(`/airports?select=true&returnTo=/new-flight&field=${field}`)
  }

  const openAircraftPicker = () => {
    sessionStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(formData))
    router.push(`/aircraft?select=true&returnTo=/new-flight&field=aircraftReg`)
  }

  const openCrewPicker = (field: "picId" | "sicId") => {
    sessionStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(formData))
    const crewField = field === "picId" ? "pic" : "sic"
    router.push(`/crew?select=true&return=/new-flight&field=${crewField}`)
  }

  const swapCrew = useCallback(() => {
    setFormData((prev) => ({
      ...prev,
      picId: prev.sicId,
      picName: prev.sicName,
      sicId: prev.picId,
      sicName: prev.picName,
    }))
  }, [])

  // Handle time picker
  const handleTimeSelect = useCallback(
    (time: string) => {
      if (activeTimePicker) {
        updateField(activeTimePicker as keyof FlightLog, time)
        setActiveTimePicker(null)
      }
    },
    [activeTimePicker, updateField],
  )

  // Set NOW time
  const setNowTime = useCallback(
    (field: keyof FlightLog) => {
      const now = getCurrentTimeUTC()
      updateField(field, now)
    },
    [updateField],
  )

  // Handle submit
  const handleSubmit = async () => {
    if (isSubmitting) return
    setIsSubmitting(true)

    try {
      const flightData: FlightLog = {
        id: formData.id || editingFlight?.id || crypto.randomUUID(),
        isDraft: false, // No longer a draft when saved
        createdAt: editingFlight?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        syncStatus: "pending",
        date: formData.date || new Date().toISOString().split("T")[0],
        flightNumber: formData.flightNumber || "",
        aircraftReg: formData.aircraftReg || "",
        aircraftType: formData.aircraftType || "",
        departureIcao: formData.departureIcao || "",
        departureIata: formData.departureIata || "",
        arrivalIcao: formData.arrivalIcao || "",
        arrivalIata: formData.arrivalIata || "",
        departureTimezone: formData.departureTimezone || 0,
        arrivalTimezone: formData.arrivalTimezone || 0,
        scheduledOut: formData.scheduledOut || "",
        scheduledIn: formData.scheduledIn || "",
        outTime: formData.outTime || "",
        offTime: formData.offTime || "",
        onTime: formData.onTime || "",
        inTime: formData.inTime || "",
        blockTime: formData.blockTime || "00:00",
        flightTime: formData.flightTime || "00:00",
        nightTime: formData.nightTime || "00:00",
        dayTime: formData.dayTime || "00:00",
        picId: formData.picId || "",
        picName: formData.picName || "",
        sicId: formData.sicId || "",
        sicName: formData.sicName || "",
        additionalCrew: formData.additionalCrew || [],
        pilotFlying: formData.pilotFlying ?? true,
        pilotRole: formData.pilotRole || "PIC",
        picTime: formData.picTime || "00:00",
        sicTime: formData.sicTime || "00:00",
        picusTime: formData.picusTime || "00:00",
        dualTime: formData.dualTime || "00:00",
        instructorTime: formData.instructorTime || "00:00",
        dayTakeoffs: formData.dayTakeoffs || 0,
        dayLandings: formData.dayLandings || 0,
        nightTakeoffs: formData.nightTakeoffs || 0,
        nightLandings: formData.nightLandings || 0,
        autolands: formData.autolands || 0,
        remarks: formData.remarks || "",
        endorsements: formData.endorsements || "",
        manualOverrides,
        ifrTime: formData.ifrTime || "00:00",
        actualInstrumentTime: formData.actualInstrumentTime || "00:00",
        simulatedInstrumentTime: formData.simulatedInstrumentTime || "00:00",
        crossCountryTime: formData.crossCountryTime || "00:00",
        approaches: formData.approaches || [],
        holds: formData.holds || 0,
        ipcIcc: formData.ipcIcc || false,
      }

      await updateFlight(flightData.id, flightData)
      sessionStorage.removeItem(FORM_STORAGE_KEY)
      onFlightAdded(flightData)
    } catch (error) {
      console.error("Failed to save flight:", error)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Additional crew management
  const addAdditionalCrew = useCallback(() => {
    const newCrew: AdditionalCrew = {
      id: crypto.randomUUID(),
      name: "",
      role: "Observer",
    }
    setFormData((prev) => ({
      ...prev,
      additionalCrew: [...(prev.additionalCrew || []), newCrew],
    }))
  }, [])

  const updateAdditionalCrew = useCallback((id: string, updates: Partial<AdditionalCrew>) => {
    setFormData((prev) => ({
      ...prev,
      additionalCrew: (prev.additionalCrew || []).map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }))
  }, [])

  const removeAdditionalCrew = useCallback((id: string) => {
    setFormData((prev) => ({
      ...prev,
      additionalCrew: (prev.additionalCrew || []).filter((c) => c.id !== id),
    }))
  }, [])

  // Approaches management
  const addApproach = useCallback(() => {
    const newApproach: Approach = {
      id: `approach-${Date.now()}`,
      type: "ILS",
      category: "precision", // ILS is precision by default
      runway: "",
      airport: formData.arrivalIcao || "",
    }
    setFormData((prev) => ({
      ...prev,
      approaches: [...(prev.approaches || []), newApproach],
    }))
  }, [formData.arrivalIcao])

  const updateApproach = useCallback((id: string, updates: Partial<Approach>) => {
    setFormData((prev) => ({
      ...prev,
      approaches: (prev.approaches || []).map((a) => {
        if (a.id === id) {
          const updated = { ...a, ...updates }
          // Auto-set category when type changes
          if (updates.type && !updates.category) {
            updated.category = getApproachCategory(updates.type)
          }
          return updated
        }
        return a
      }),
    }))
  }, [])

  const removeApproach = useCallback((id: string) => {
    setFormData((prev) => ({
      ...prev,
      approaches: (prev.approaches || []).filter((a) => a.id !== id),
    }))
  }, [])

  // Get active time picker timezone
  const getTimePickerTimezone = useCallback(() => {
    if (!activeTimePicker) return 0
    // Out and Off use departure timezone, On and In use arrival timezone
    if (activeTimePicker === "outTime" || activeTimePicker === "offTime" || activeTimePicker === "scheduledOut") {
      return depTimezone
    }
    return arrTimezone
  }, [activeTimePicker, depTimezone, arrTimezone])

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Fixed Header */}
      <div className="sticky top-0 z-50 bg-card border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon" onClick={onClose}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold">{editingFlight && !formData.isDraft ? "Edit Flight" : "New Flight"}</h1>
          <Button onClick={handleSubmit} disabled={isSubmitting} size="sm" className="px-4">
            {isSubmitting ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {/* Form Content */}
      <div className="space-y-4 px-2 py-4">
        {/* FLIGHT Section */}
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <div className="px-4 py-2 bg-muted/30">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">FLIGHT</h2>
          </div>

          <SwipeableRow onClear={() => clearField("date")}>
            <SettingsRow
              label="Date"
              value={
                formData.date
                  ? new Date(formData.date + "T00:00:00").toLocaleDateString("en-GB", {
                      weekday: "short",
                      day: "2-digit",
                      month: "short",
                      year: "2-digit",
                    })
                  : undefined
              }
              onClick={() => setDatePickerOpen(true)}
            />
          </SwipeableRow>

          <SwipeableRow onClear={() => clearField("flightNumber")}>
            <SettingsRow
              label="Flight #"
              value={formData.flightNumber}
              onClick={() => {
                const num = prompt("Flight Number:", formData.flightNumber)
                if (num !== null) updateField("flightNumber", num)
              }}
            />
          </SwipeableRow>

          <SwipeableRow
            onClear={() => {
              updateField("aircraftReg", "")
              updateField("aircraftType", "")
            }}
          >
            <SettingsRow
              label="Aircraft"
              value={
                formData.aircraftReg
                  ? formData.aircraftType
                    ? `${formData.aircraftReg} (${formData.aircraftType})`
                    : formData.aircraftReg
                  : undefined
              }
              placeholder="Select"
              onClick={openAircraftPicker}
              showChevron
              icon={<Plane className="h-4 w-4" />}
            />
          </SwipeableRow>

          <SwipeableRow
            onClear={() => {
              updateField("departureIcao", "")
              updateField("departureIata", "")
            }}
          >
            <SettingsRow
              label="From"
              value={formData.departureIcao}
              placeholder="Select"
              onClick={() => openAirportPicker("departureIcao")}
              showChevron
              icon={<PlaneTakeoff className="h-4 w-4" />}
            />
          </SwipeableRow>

          <SwipeableRow
            onClear={() => {
              updateField("arrivalIcao", "")
              updateField("arrivalIata", "")
            }}
          >
            <SettingsRow
              label="To"
              value={formData.arrivalIcao}
              placeholder="Select"
              onClick={() => openAirportPicker("arrivalIcao")}
              showChevron
              icon={<PlaneLanding className="h-4 w-4" />}
            />
          </SwipeableRow>

          <SwipeableRow onClear={() => clearField("scheduledOut")}>
            <TimeRow
              label="Scheduled Out"
              utcValue={formData.scheduledOut || ""}
              timezoneOffset={depTimezone}
              onTap={() => setActiveTimePicker("scheduledOut")}
              onNow={() => setNowTime("scheduledOut")}
            />
          </SwipeableRow>

          <SwipeableRow onClear={() => clearField("scheduledIn")}>
            <TimeRow
              label="Scheduled In"
              utcValue={formData.scheduledIn || ""}
              timezoneOffset={arrTimezone}
              onTap={() => setActiveTimePicker("scheduledIn")}
              onNow={() => setNowTime("scheduledIn")}
            />
          </SwipeableRow>

          <SwipeableRow onClear={() => clearField("outTime")}>
            <TimeRow
              label="Out"
              utcValue={formData.outTime || ""}
              timezoneOffset={depTimezone}
              onTap={() => setActiveTimePicker("outTime")}
              onNow={() => setNowTime("outTime")}
            />
          </SwipeableRow>

          <SwipeableRow onClear={() => clearField("offTime")}>
            <TimeRow
              label="Off"
              utcValue={formData.offTime || ""}
              timezoneOffset={depTimezone}
              onTap={() => setActiveTimePicker("offTime")}
              onNow={() => setNowTime("offTime")}
            />
          </SwipeableRow>

          <SwipeableRow onClear={() => clearField("onTime")}>
            <TimeRow
              label="On"
              utcValue={formData.onTime || ""}
              timezoneOffset={arrTimezone}
              onTap={() => setActiveTimePicker("onTime")}
              onNow={() => setNowTime("onTime")}
            />
          </SwipeableRow>

          <SwipeableRow onClear={() => clearField("inTime")}>
            <TimeRow
              label="In"
              utcValue={formData.inTime || ""}
              timezoneOffset={arrTimezone}
              onTap={() => setActiveTimePicker("inTime")}
              onNow={() => setNowTime("inTime")}
            />
          </SwipeableRow>
        </div>

        {/* CREW Section */}
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <div className="px-4 py-2 bg-muted/30">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">CREW</h2>
          </div>

          <SwipeableRow
            onClear={() => {
              updateField("picId", "")
              updateField("picName", "")
            }}
          >
            <SettingsRow
              label="PIC / P1"
              value={formData.picName}
              placeholder="Select"
              onClick={() => openCrewPicker("picId")}
              showChevron
              icon={<User className="h-4 w-4" />}
            />
          </SwipeableRow>

          {/* Swap Button Row */}
          <div className="flex items-center justify-center py-2 border-b border-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={swapCrew}
              className="h-8 px-3 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeftRight className="h-3.5 w-3.5 mr-1" />
              Swap Crew
            </Button>
          </div>

          <SwipeableRow
            onClear={() => {
              updateField("sicId", "")
              updateField("sicName", "")
            }}
          >
            <SettingsRow
              label="SIC / P2"
              value={formData.sicName}
              placeholder="Select"
              onClick={() => openCrewPicker("sicId")}
              showChevron
              icon={<User className="h-4 w-4" />}
            />
          </SwipeableRow>

          {/* Additional Crew - placeholder for now */}
          <div className="flex items-center justify-center py-3 border-b border-border last:border-b-0">
            <Button variant="ghost" size="sm" className="h-8 px-3 text-xs text-primary">
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Crew
            </Button>
          </div>
        </div>

        {/* TIME Section */}
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <div className="px-4 py-2 bg-muted/30">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">TIME</h2>
          </div>

          <TimeDisplayRow label="Total Time" value={formData.blockTime || "00:00"} />

          <TimeDisplayRow
            label="Night"
            value={formData.nightTime || calculatedFields.nightTime || "00:00"}
            secondaryLabel="Day"
            secondaryValue={formData.dayTime || calculatedFields.dayTime || "00:00"}
          />

          <SwipeableRow
            onClear={() => {
              updateField("picusTime", "00:00")
              markManualOverride("picusTime", false)
            }}
          >
            <TimeDisplayRow
              label="P1u/s"
              value={formData.picusTime || "00:00"}
              showUseButton={formData.picusTime === "00:00" || !formData.picusTime}
              useLabel={`USE ${formatTimeShort(formData.blockTime || "00:00")}`}
              onUse={() => {
                // Don't mark as manual override - this allows recalculation
                updateField("picusTime", formData.blockTime || "00:00")
              }}
            />
          </SwipeableRow>

          <SwipeableRow
            onClear={() => {
              updateField("sicTime", "00:00")
              markManualOverride("sicTime", false)
            }}
          >
            <TimeDisplayRow
              label="SIC"
              value={formData.sicTime || "00:00"}
              showUseButton={formData.sicTime === "00:00" || !formData.sicTime}
              useLabel={`USE ${formatTimeShort(formData.blockTime || "00:00")}`}
              onUse={() => {
                updateField("sicTime", formData.blockTime || "00:00")
              }}
            />
          </SwipeableRow>

          <SwipeableRow
            onClear={() => {
              updateField("crossCountryTime", "00:00")
              markManualOverride("crossCountryTime", false)
            }}
          >
            <TimeDisplayRow
              label="XC"
              value={formData.crossCountryTime || "00:00"}
              showUseButton={formData.crossCountryTime === "00:00" || !formData.crossCountryTime}
              useLabel={`USE ${formatTimeShort(formData.blockTime || "00:00")}`}
              onUse={() => {
                updateField("crossCountryTime", formData.blockTime || "00:00")
              }}
            />
          </SwipeableRow>

          <SwipeableRow
            onClear={() => {
              updateField("actualInstrumentTime", "00:00")
              markManualOverride("actualInstrumentTime", false)
            }}
          >
            <TimeDisplayRow
              label="Actual Inst"
              value={formData.actualInstrumentTime || "00:00"}
              showUseButton={formData.actualInstrumentTime === "00:00" || !formData.actualInstrumentTime}
              useLabel={`USE ${formatTimeShort(formData.blockTime || "00:00")}`}
              onUse={() => {
                updateField("actualInstrumentTime", formData.blockTime || "00:00")
              }}
            />
          </SwipeableRow>

          <SwipeableRow
            onClear={() => {
              updateField("ifrTime", "00:00")
              markManualOverride("ifrTime", false)
            }}
          >
            <TimeDisplayRow
              label="IFR"
              value={formData.ifrTime || "00:00"}
              showUseButton={formData.ifrTime === "00:00" || !formData.ifrTime}
              useLabel={`USE ${formatTimeShort(formData.blockTime || "00:00")}`}
              onUse={() => {
                updateField("ifrTime", formData.blockTime || "00:00")
              }}
            />
          </SwipeableRow>

          <SwipeableRow
            onClear={() => {
              updateField("simulatedInstrumentTime", "00:00")
              markManualOverride("simulatedInstrumentTime", false)
            }}
          >
            <TimeDisplayRow
              label="Simulator"
              value={formData.simulatedInstrumentTime || "00:00"}
              showUseButton={formData.simulatedInstrumentTime === "00:00" || !formData.simulatedInstrumentTime}
              useLabel={`USE ${formatTimeShort(formData.blockTime || "00:00")}`}
              onUse={() => {
                updateField("simulatedInstrumentTime", formData.blockTime || "00:00")
              }}
            />
          </SwipeableRow>
        </div>

        {/* DUTY Section */}
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <div className="px-4 py-2 bg-muted/30">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">DUTY</h2>
          </div>

          <ToggleRow
            label="Pilot Flying"
            checked={formData.pilotFlying ?? true}
            onCheckedChange={(checked) => updateField("pilotFlying", checked)}
          />

          <SettingsRow label="Pilot Role">
            <select
              value={formData.pilotRole || "PIC"}
              onChange={(e) => updateField("pilotRole", e.target.value as FlightLog["pilotRole"])}
              className="bg-transparent text-foreground outline-none"
            >
              <option value="PIC">PIC</option>
              <option value="SIC">SIC</option>
              <option value="PICUS">PICUS</option>
              <option value="Dual">Dual</option>
              <option value="Instructor">Instructor</option>
              <option value="Examiner">Examiner</option>
            </select>
          </SettingsRow>
        </div>

        {/* LANDINGS Section */}
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <div className="px-4 py-2 bg-muted/30">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">LANDINGS</h2>
          </div>

          <NumberRow
            label="Day Takeoffs"
            value={formData.dayTakeoffs || 0}
            onChange={(val) => {
              updateField("dayTakeoffs", val)
              markManualOverride("dayTakeoffs", true)
            }}
          />

          <NumberRow
            label="Day Landings"
            value={formData.dayLandings || 0}
            onChange={(val) => {
              updateField("dayLandings", val)
              markManualOverride("dayLandings", true)
            }}
          />

          <NumberRow
            label="Night Takeoffs"
            value={formData.nightTakeoffs || 0}
            onChange={(val) => {
              updateField("nightTakeoffs", val)
              markManualOverride("nightTakeoffs", true)
            }}
          />

          <NumberRow
            label="Night Landings"
            value={formData.nightLandings || 0}
            onChange={(val) => {
              updateField("nightLandings", val)
              markManualOverride("nightLandings", true)
            }}
          />

          <NumberRow
            label="Autolands"
            value={formData.autolands || 0}
            onChange={(val) => updateField("autolands", val)}
          />
        </div>

        {/* APPROACHES Section */}
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <div className="px-4 py-2 bg-muted/30">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">APPROACHES</h2>
          </div>

          {(formData.approaches || []).map((approach, index) => (
            <div key={approach.id} className="flex items-center justify-between py-3 px-4 border-b border-border">
              <div className="flex items-center gap-2 flex-1">
                <select
                  value={approach.type}
                  onChange={(e) => updateApproach(approach.id, { type: e.target.value })}
                  className="bg-transparent text-foreground outline-none text-sm"
                >
                  <option value="ILS">ILS</option>
                  <option value="LOC">LOC</option>
                  <option value="VOR">VOR</option>
                  <option value="NDB">NDB</option>
                  <option value="RNAV">RNAV</option>
                  <option value="RNP">RNP</option>
                  <option value="GLS">GLS</option>
                  <option value="Visual">Visual</option>
                  <option value="Circling">Circling</option>
                </select>
                <span className="text-xs text-muted-foreground px-2 py-0.5 rounded bg-muted/50">
                  {approach.category === "precision" ? "Precision" : "Non-Precision"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={approach.runway || ""}
                  onChange={(e) => updateApproach(approach.id, { runway: e.target.value.toUpperCase() })}
                  placeholder="RWY"
                  className="bg-transparent text-foreground text-right outline-none w-16"
                />
                <button onClick={() => removeApproach(approach.id)} className="text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}

          <button
            onClick={addApproach}
            className="w-full py-3 px-4 flex items-center justify-center gap-2 text-primary"
          >
            <Plus className="h-4 w-4" />
            <span>Add Approach</span>
          </button>

          <NumberRow label="Holds" value={formData.holds || 0} onChange={(v) => updateField("holds", v)} />

          <ToggleRow
            label="IPC / ICC"
            checked={formData.ipcIcc || false}
            onCheckedChange={(checked) => updateField("ipcIcc", checked)}
          />
        </div>

        {/* REMARKS Section */}
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <div className="px-4 py-2 bg-muted/30">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">REMARKS</h2>
          </div>

          <SwipeableRow onClear={() => clearField("remarks")}>
            <SettingsRow
              label="Comment"
              value={formData.remarks}
              onClick={() => {
                const comment = prompt("Remarks:", formData.remarks)
                if (comment !== null) updateField("remarks", comment)
              }}
              showChevron
            />
          </SwipeableRow>
        </div>
      </div>

      {/* Time Picker Modal */}
      {activeTimePicker && (
        <TimePicker
          isOpen={!!activeTimePicker}
          initialTime={formData[activeTimePicker as keyof FlightLog] as string}
          onSelect={handleTimeSelect}
          onClose={() => setActiveTimePicker(null)}
          timezoneOffset={getTimePickerTimezone()}
        />
      )}

      {datePickerOpen && (
        <DatePicker
          isOpen={datePickerOpen}
          initialDate={formData.date}
          onSelect={(value) => {
            updateField("date", value)
          }}
          onClose={() => setDatePickerOpen(false)}
          label="Select Date"
        />
      )}
    </div>
  )
}
