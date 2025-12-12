"use client"

import type React from "react"
import { useState, useEffect, useMemo, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  addFlight,
  updateFlight,
  type FlightLog,
  type Aircraft,
  type Airport,
  type Personnel,
  getAllAircraft,
  getAllAirports,
  getAllPersonnel,
} from "@/lib/indexed-db"
import { calculateTimesFromOOOI, calculateNightTime } from "@/lib/night-time-calculator"
import { formatHHMMDisplay } from "@/lib/time-utils"
import { syncService } from "@/lib/sync-service"
import { Save, X, ArrowLeftRight, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface FlightFormProps {
  onFlightAdded: (flight: FlightLog) => void
  onClose?: () => void
  editingFlight?: FlightLog | null
}

type PilotRole = "PIC" | "FO" | "P1US" | "STUDENT" | "INSTRUCTOR"

interface SwipeableRowProps {
  label: string
  children: React.ReactNode
  onClear?: () => void
  showClear?: boolean
}

function SwipeableRow({ label, children, onClear, showClear = true }: SwipeableRowProps) {
  const [swiped, setSwiped] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const startX = useRef(0)
  const startY = useRef(0)
  const currentX = useRef(0)

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    setIsDragging(false)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    const deltaX = startX.current - e.touches[0].clientX
    const deltaY = Math.abs(startY.current - e.touches[0].clientY)

    // Only swipe if horizontal movement > vertical movement
    if (Math.abs(deltaX) > 10 && Math.abs(deltaX) > deltaY) {
      setIsDragging(true)
      currentX.current = e.touches[0].clientX
    }
  }

  const handleTouchEnd = () => {
    if (!isDragging) {
      // If not dragging, treat as tap to close if already swiped
      if (swiped) {
        setSwiped(false)
      }
      return
    }

    const diff = startX.current - currentX.current
    if (diff > 50) {
      setSwiped(true)
    } else if (diff < -50) {
      setSwiped(false)
    }
    setIsDragging(false)
  }

  return (
    <div className="relative overflow-hidden">
      {showClear && onClear && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onClear()
            setSwiped(false)
          }}
          className="absolute right-0 top-0 bottom-0 w-20 bg-destructive hover:bg-destructive/90 text-destructive-foreground flex items-center justify-center z-0 rounded-lg"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
      <div
        className={cn(
          "flex items-center gap-2 py-1.5 px-1 transition-transform duration-200 bg-card relative z-10",
          swiped && "-translate-x-20",
        )}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <span className="text-sm text-muted-foreground w-20 flex-shrink-0 text-left">{label}</span>
        <div className="flex-1 flex justify-end">{children}</div>
      </div>
    </div>
  )
}

function SectionHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="bg-secondary/50 px-3 py-2 -mx-3 mt-4 first:mt-0 flex items-center justify-between">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  )
}

export function FlightForm({ onFlightAdded, onClose, editingFlight }: FlightFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [aircraft, setAircraft] = useState<Aircraft[]>([])
  const [airports, setAirports] = useState<Airport[]>([])
  const [personnel, setPersonnel] = useState<Personnel[]>([])

  const [formData, setFormData] = useState({
    date: new Date().toISOString().split("T")[0],
    flightNumber: "",
    aircraftId: "",
    departureIcao: "",
    arrivalIcao: "",
    outTime: "",
    offTime: "",
    onTime: "",
    inTime: "",
    isPilotFlying: false, // Changed from pilotRole to isPilotFlying toggle
    picCrewId: "",
    sicCrewId: "",
    observerCrewId: "",
    ifrTime: "",
    actualInstrumentTime: "",
    simulatedInstrumentTime: "",
    crossCountryTime: "",
    dayTakeoffs: "0",
    dayLandings: "0",
    nightTakeoffs: "0",
    nightLandings: "0",
    autolands: "0",
    approach1: "",
    approach2: "",
    holds: "0",
    remarks: "",
    ipcIcc: false,
  })

  const [calculatedTimes, setCalculatedTimes] = useState({
    blockTime: "00:00",
    flightTime: "00:00",
    nightTime: "00:00",
    p1Time: "00:00",
    p2Time: "00:00",
    p1usTime: "00:00",
    dualTime: "00:00",
    instructorTime: "00:00",
  })

  // Load reference data
  useEffect(() => {
    const loadData = async () => {
      const [aircraftData, airportData, personnelData] = await Promise.all([
        getAllAircraft(),
        getAllAirports(),
        getAllPersonnel(),
      ])
      setAircraft(aircraftData)
      setAirports(airportData)
      setPersonnel(personnelData)
    }
    loadData()
  }, [])

  useEffect(() => {
    if (editingFlight) {
      const crewIds = editingFlight.crewIds || []

      setFormData({
        date: editingFlight.date,
        flightNumber: editingFlight.flightNumber || "",
        aircraftId: editingFlight.aircraftId || "",
        departureIcao: editingFlight.departureIcao || "",
        arrivalIcao: editingFlight.arrivalIcao || "",
        outTime: editingFlight.outTime || "",
        offTime: editingFlight.offTime || "",
        onTime: editingFlight.onTime || "",
        inTime: editingFlight.inTime || "",
        // Removed pilotRole, added isPilotFlying based on its original value
        isPilotFlying:
          (editingFlight as any).pilotRole === "PIC" || (editingFlight as any).pilotRole === "INSTRUCTOR" || false,
        picCrewId: crewIds[0] || "",
        sicCrewId: crewIds[1] || "",
        observerCrewId: crewIds[2] || "",
        ifrTime: editingFlight.ifrTime || "",
        actualInstrumentTime: editingFlight.actualInstrumentTime || "",
        simulatedInstrumentTime: editingFlight.simulatedInstrumentTime || "",
        crossCountryTime: (editingFlight as any).crossCountryTime || "",
        dayTakeoffs: String((editingFlight as any).dayTakeoffs || 0),
        dayLandings: String(editingFlight.dayLandings || 0),
        nightTakeoffs: String((editingFlight as any).nightTakeoffs || 0),
        nightLandings: String(editingFlight.nightLandings || 0),
        autolands: String((editingFlight as any).autolands || 0),
        approach1: (editingFlight as any).approach1 || "",
        approach2: (editingFlight as any).approach2 || "",
        holds: String((editingFlight as any).holds || 0),
        remarks: editingFlight.remarks || "",
        ipcIcc: (editingFlight as any).ipcIcc || false,
      })
      setCalculatedTimes({
        blockTime: editingFlight.blockTime || "00:00",
        flightTime: editingFlight.flightTime || "00:00",
        nightTime: editingFlight.nightTime || "00:00",
        p1Time: editingFlight.p1Time || "00:00",
        p2Time: editingFlight.p2Time || "00:00",
        p1usTime: editingFlight.p1usTime || "00:00",
        dualTime: editingFlight.dualTime || "00:00",
        instructorTime: editingFlight.instructorTime || "00:00",
      })
    }
  }, [editingFlight])

  const selectedAircraft = useMemo(
    () => aircraft.find((a) => a.id === formData.aircraftId),
    [aircraft, formData.aircraftId],
  )
  const departureAirport = useMemo(
    () => airports.find((a) => a.icao === formData.departureIcao.toUpperCase()),
    [airports, formData.departureIcao],
  )
  const arrivalAirport = useMemo(
    () => airports.find((a) => a.icao === formData.arrivalIcao.toUpperCase()),
    [airports, formData.arrivalIcao],
  )

  useEffect(() => {
    if (formData.outTime && formData.inTime) {
      const { blockTime, flightTime } = calculateTimesFromOOOI(
        formData.outTime,
        formData.offTime || formData.outTime,
        formData.onTime || formData.inTime,
        formData.inTime,
        formData.date,
      )

      let nightTime = "00:00"
      if (departureAirport && arrivalAirport && formData.offTime && formData.onTime) {
        const offDateTime = new Date(`${formData.date}T${formData.offTime}:00Z`)
        const onDateTime = new Date(`${formData.date}T${formData.onTime}:00Z`)
        if (onDateTime < offDateTime) {
          onDateTime.setUTCDate(onDateTime.getUTCDate() + 1)
        }
        nightTime = calculateNightTime(
          offDateTime,
          onDateTime,
          departureAirport.latitude,
          departureAirport.longitude,
          arrivalAirport.latitude,
          arrivalAirport.longitude,
        )
      }

      // Auto-populate landings based on PF status and timing
      if (formData.isPilotFlying && !editingFlight) {
        let takeoffIsNight = false
        let landingIsNight = false

        if (departureAirport && formData.offTime) {
          const offDateTime = new Date(`${formData.date}T${formData.offTime}:00Z`)
          const hour = offDateTime.getUTCHours()
          takeoffIsNight = hour >= 18 || hour < 6
        }

        if (arrivalAirport && formData.onTime) {
          const onDateTime = new Date(`${formData.date}T${formData.onTime}:00Z`)
          const hour = onDateTime.getUTCHours()
          landingIsNight = hour >= 18 || hour < 6
        }

        setFormData((prev) => ({
          ...prev,
          dayTakeoffs: takeoffIsNight ? "0" : "1",
          nightTakeoffs: takeoffIsNight ? "1" : "0",
          dayLandings: landingIsNight ? "0" : "1",
          nightLandings: landingIsNight ? "1" : "0",
        }))
      }

      // Calculate hours based on crew position and PF toggle
      let p1Time = "00:00",
        p2Time = "00:00",
        p1usTime = "00:00"

      // Find "self" in crew
      const selfId = personnel.find(
        (p) => p.firstName.toLowerCase() === "self" || p.lastName.toLowerCase() === "self",
      )?.id
      const isInPIC = formData.picCrewId === selfId
      const isInSIC = formData.sicCrewId === selfId

      if (isInPIC) {
        p1Time = flightTime
      } else if (isInSIC) {
        if (formData.isPilotFlying) {
          p1usTime = flightTime // PF as SIC = P1 U/S
        } else {
          p2Time = flightTime // Not PF as SIC = SIC
        }
      }

      setCalculatedTimes({
        blockTime,
        flightTime,
        nightTime,
        p1Time,
        p2Time,
        p1usTime,
        dualTime: "00:00",
        instructorTime: "00:00",
      })
    }
  }, [
    formData.outTime,
    formData.offTime,
    formData.onTime,
    formData.inTime,
    formData.date,
    formData.isPilotFlying,
    formData.picCrewId,
    formData.sicCrewId,
    departureAirport,
    arrivalAirport,
    personnel,
    editingFlight,
  ])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const crewIds = [formData.picCrewId, formData.sicCrewId, formData.observerCrewId].filter(Boolean)

      // Determine pilotRole based on isPilotFlying and crew position
      let pilotRole: PilotRole = "FO" // Default to FO
      const selfId = personnel.find(
        (p) => p.firstName.toLowerCase() === "self" || p.lastName.toLowerCase() === "self",
      )?.id
      if (formData.picCrewId === selfId) {
        pilotRole = formData.isPilotFlying ? "PIC" : "FO" // Assuming PIC is always PF
      } else if (formData.sicCrewId === selfId) {
        pilotRole = formData.isPilotFlying ? "P1US" : "FO"
      } else {
        // If 'self' is not in PIC or SIC, we need to infer from existing data or leave as default
        // For now, we'll use the previous value if editing, or default
        if (editingFlight) {
          pilotRole = editingFlight.pilotRole as PilotRole
        }
      }

      const flightData = {
        date: formData.date,
        flightNumber: formData.flightNumber,
        aircraftId: formData.aircraftId,
        aircraftType: selectedAircraft?.type || "",
        aircraftReg: selectedAircraft?.registration || "",
        departureAirportId: departureAirport?.id || "",
        arrivalAirportId: arrivalAirport?.id || "",
        departureIcao: formData.departureIcao.toUpperCase(),
        arrivalIcao: formData.arrivalIcao.toUpperCase(),
        outTime: formData.outTime,
        offTime: formData.offTime,
        onTime: formData.onTime,
        inTime: formData.inTime,
        blockTime: calculatedTimes.blockTime,
        flightTime: calculatedTimes.flightTime,
        p1Time: calculatedTimes.p1Time,
        p1usTime: calculatedTimes.p1usTime,
        p2Time: calculatedTimes.p2Time,
        dualTime: calculatedTimes.dualTime,
        instructorTime: calculatedTimes.instructorTime,
        nightTime: calculatedTimes.nightTime,
        ifrTime: formData.ifrTime || "00:00",
        actualInstrumentTime: formData.actualInstrumentTime || "00:00",
        simulatedInstrumentTime: formData.simulatedInstrumentTime || "00:00",
        crossCountryTime: formData.crossCountryTime || "00:00",
        dayTakeoffs: Number.parseInt(formData.dayTakeoffs) || 0,
        dayLandings: Number.parseInt(formData.dayLandings) || 0,
        nightTakeoffs: Number.parseInt(formData.nightTakeoffs) || 0,
        nightLandings: Number.parseInt(formData.nightLandings) || 0,
        autolands: Number.parseInt(formData.autolands) || 0,
        approach1: formData.approach1,
        approach2: formData.approach2,
        holds: Number.parseInt(formData.holds) || 0,
        pilotRole: pilotRole, // Use the determined pilotRole
        crewIds,
        remarks: formData.remarks,
        ipcIcc: formData.ipcIcc,
      }

      let flight: FlightLog | null
      if (editingFlight) {
        flight = await updateFlight(editingFlight.id, flightData)
      } else {
        flight = await addFlight(flightData)
      }

      if (flight) {
        if (navigator.onLine) syncService.fullSync()
        onFlightAdded(flight)
        onClose?.()
      }
    } catch (error) {
      console.error("Failed to save flight:", error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const updateField = (field: string, value: string | boolean | string[]) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const clearField = (field: string, defaultValue = "") => {
    setFormData((prev) => ({ ...prev, [field]: defaultValue }))
  }

  const copyFlightTime = (field: string) => {
    updateField(field, calculatedTimes.flightTime)
  }

  const swapCrew = () => {
    setFormData((prev) => ({
      ...prev,
      picCrewId: prev.sicCrewId,
      sicCrewId: prev.picCrewId,
    }))
  }

  const inputClassName = "bg-input h-10 text-base text-right w-full"

  const selfId = personnel.find((p) => p.firstName.toLowerCase() === "self" || p.lastName.toLowerCase() === "self")?.id
  const selfInCrew =
    formData.picCrewId === selfId || formData.sicCrewId === selfId || formData.observerCrewId === selfId
  const pfDisabled = !selfInCrew || formData.sicCrewId !== selfId

  return (
    <form onSubmit={handleSubmit} className="bg-card rounded-lg border border-border">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <h2 className="font-semibold text-foreground">{editingFlight ? "Edit Flight" : "New Entry"}</h2>
        <div className="flex items-center gap-2">
          {onClose && (
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
          <Button type="submit" size="sm" disabled={isSubmitting}>
            <Save className="h-4 w-4 mr-1" />
            {isSubmitting ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <div className="px-2 pb-2 divide-y divide-border">
        {/* A) Flight Section */}
        <div>
          <SectionHeader title="Flight" />

          <SwipeableRow label="Date" onClear={() => clearField("date", new Date().toISOString().split("T")[0])}>
            <Input
              type="date"
              value={formData.date}
              onChange={(e) => updateField("date", e.target.value)}
              className={inputClassName}
            />
          </SwipeableRow>

          <SwipeableRow label="Flight No" onClear={() => clearField("flightNumber")}>
            <Input
              placeholder="SQ123"
              value={formData.flightNumber}
              onChange={(e) => updateField("flightNumber", e.target.value)}
              className={cn(inputClassName, "uppercase")}
            />
          </SwipeableRow>

          <SwipeableRow label="Aircraft" onClear={() => clearField("aircraftId")}>
            <Select value={formData.aircraftId} onValueChange={(v) => updateField("aircraftId", v)}>
              <SelectTrigger className={inputClassName}>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {aircraft.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.registration} ({a.type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SwipeableRow>

          <SwipeableRow label="From" onClear={() => clearField("departureIcao")}>
            <Input
              placeholder="WSSS"
              value={formData.departureIcao}
              onChange={(e) => updateField("departureIcao", e.target.value)}
              className={cn(inputClassName, "uppercase")}
              list="dep-airports"
            />
            <datalist id="dep-airports">
              {airports.map((a) => (
                <option key={a.id} value={a.icao}>
                  {a.name}
                </option>
              ))}
            </datalist>
          </SwipeableRow>

          <SwipeableRow label="To" onClear={() => clearField("arrivalIcao")}>
            <Input
              placeholder="VHHH"
              value={formData.arrivalIcao}
              onChange={(e) => updateField("arrivalIcao", e.target.value)}
              className={cn(inputClassName, "uppercase")}
              list="arr-airports"
            />
            <datalist id="arr-airports">
              {airports.map((a) => (
                <option key={a.id} value={a.icao}>
                  {a.name}
                </option>
              ))}
            </datalist>
          </SwipeableRow>

          <SwipeableRow label="Out" onClear={() => clearField("outTime")}>
            <Input
              type="time"
              value={formData.outTime}
              onChange={(e) => updateField("outTime", e.target.value)}
              className={inputClassName}
            />
          </SwipeableRow>

          <SwipeableRow label="Off" onClear={() => clearField("offTime")}>
            <Input
              type="time"
              value={formData.offTime}
              onChange={(e) => updateField("offTime", e.target.value)}
              className={inputClassName}
            />
          </SwipeableRow>

          <SwipeableRow label="On" onClear={() => clearField("onTime")}>
            <Input
              type="time"
              value={formData.onTime}
              onChange={(e) => updateField("onTime", e.target.value)}
              className={inputClassName}
            />
          </SwipeableRow>

          <SwipeableRow label="In" onClear={() => clearField("inTime")}>
            <Input
              type="time"
              value={formData.inTime}
              onChange={(e) => updateField("inTime", e.target.value)}
              className={inputClassName}
            />
          </SwipeableRow>
        </div>

        {/* B) Time Section */}
        <div>
          <SectionHeader title="Time" />

          <SwipeableRow
            label="Total"
            onClear={() => {
              setCalculatedTimes((prev) => ({ ...prev, blockTime: "00:00" }))
            }}
          >
            <Input
              type="time"
              value={calculatedTimes.blockTime}
              onChange={(e) => setCalculatedTimes((prev) => ({ ...prev, blockTime: e.target.value }))}
              className={cn(inputClassName, "font-mono font-semibold")}
            />
          </SwipeableRow>

          <SwipeableRow
            label="Night"
            onClear={() => {
              setCalculatedTimes((prev) => ({ ...prev, nightTime: "00:00" }))
            }}
          >
            <Input
              type="time"
              value={calculatedTimes.nightTime}
              onChange={(e) => setCalculatedTimes((prev) => ({ ...prev, nightTime: e.target.value }))}
              className={cn(inputClassName, "font-mono")}
            />
          </SwipeableRow>

          <SwipeableRow
            label="P1 U/S"
            onClear={() => {
              setCalculatedTimes((prev) => ({ ...prev, p1usTime: "00:00" }))
            }}
          >
            <Input
              type="time"
              value={calculatedTimes.p1usTime}
              onChange={(e) => setCalculatedTimes((prev) => ({ ...prev, p1usTime: e.target.value }))}
              className={cn(inputClassName, "font-mono")}
            />
          </SwipeableRow>

          <SwipeableRow
            label="SIC"
            onClear={() => {
              setCalculatedTimes((prev) => ({ ...prev, p2Time: "00:00" }))
            }}
          >
            <Input
              type="time"
              value={calculatedTimes.p2Time}
              onChange={(e) => setCalculatedTimes((prev) => ({ ...prev, p2Time: e.target.value }))}
              className={cn(inputClassName, "font-mono")}
            />
          </SwipeableRow>

          <SwipeableRow label="XC" onClear={() => clearField("crossCountryTime")}>
            <div className="relative w-full">
              <Input
                type="time"
                value={formData.crossCountryTime}
                onChange={(e) => updateField("crossCountryTime", e.target.value)}
                className={cn(inputClassName, "pr-24")}
                style={{ WebkitAppearance: "none" }}
              />
              {!formData.crossCountryTime && (
                <button
                  type="button"
                  onClick={() => copyFlightTime("crossCountryTime")}
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-xs text-primary px-2 py-1 rounded bg-primary/10"
                >
                  Use {formatHHMMDisplay(calculatedTimes.flightTime)}
                </button>
              )}
            </div>
          </SwipeableRow>

          <SwipeableRow label="IFR" onClear={() => clearField("ifrTime")}>
            <div className="relative w-full">
              <Input
                type="time"
                value={formData.ifrTime}
                onChange={(e) => updateField("ifrTime", e.target.value)}
                className={cn(inputClassName, "pr-24")}
                style={{ WebkitAppearance: "none" }}
              />
              {!formData.ifrTime && (
                <button
                  type="button"
                  onClick={() => copyFlightTime("ifrTime")}
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-xs text-primary px-2 py-1 rounded bg-primary/10"
                >
                  Use {formatHHMMDisplay(calculatedTimes.flightTime)}
                </button>
              )}
            </div>
          </SwipeableRow>

          <SwipeableRow label="Actual Inst" onClear={() => clearField("actualInstrumentTime")}>
            <div className="relative w-full">
              <Input
                type="time"
                value={formData.actualInstrumentTime}
                onChange={(e) => updateField("actualInstrumentTime", e.target.value)}
                className={cn(inputClassName, "pr-24")}
                style={{ WebkitAppearance: "none" }}
              />
              {!formData.actualInstrumentTime && (
                <button
                  type="button"
                  onClick={() => copyFlightTime("actualInstrumentTime")}
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-xs text-primary px-2 py-1 rounded bg-primary/10"
                >
                  Use {formatHHMMDisplay(calculatedTimes.flightTime)}
                </button>
              )}
            </div>
          </SwipeableRow>

          <SwipeableRow label="Sim Inst" onClear={() => clearField("simulatedInstrumentTime")}>
            <div className="relative w-full">
              <Input
                type="time"
                value={formData.simulatedInstrumentTime}
                onChange={(e) => updateField("simulatedInstrumentTime", e.target.value)}
                className={cn(inputClassName, "pr-24")}
                style={{ WebkitAppearance: "none" }}
              />
              {!formData.simulatedInstrumentTime && (
                <button
                  type="button"
                  onClick={() => copyFlightTime("simulatedInstrumentTime")}
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-xs text-primary px-2 py-1 rounded bg-primary/10"
                >
                  Use {formatHHMMDisplay(calculatedTimes.flightTime)}
                </button>
              )}
            </div>
          </SwipeableRow>
        </div>

        {/* C) Crew Section */}
        <div>
          <SectionHeader title="Crew">
            <Button type="button" variant="ghost" size="sm" onClick={swapCrew} className="h-7 text-xs">
              <ArrowLeftRight className="h-3 w-3 mr-1" />
              Swap PIC/SIC
            </Button>
          </SectionHeader>

          <SwipeableRow label="PF" showClear={false}>
            <div className="flex items-center gap-2 justify-end">
              <span className="text-sm text-muted-foreground">{formData.isPilotFlying ? "Yes" : "No"}</span>
              <Switch
                checked={formData.isPilotFlying}
                onCheckedChange={(checked) => updateField("isPilotFlying", checked)}
                disabled={pfDisabled}
              />
            </div>
          </SwipeableRow>

          <SwipeableRow label="PIC/P1" onClear={() => clearField("picCrewId")}>
            <Select value={formData.picCrewId} onValueChange={(v) => updateField("picCrewId", v)}>
              <SelectTrigger className={inputClassName}>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {personnel.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.firstName} {p.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SwipeableRow>

          <SwipeableRow label="SIC/P2" onClear={() => clearField("sicCrewId")}>
            <Select value={formData.sicCrewId} onValueChange={(v) => updateField("sicCrewId", v)}>
              <SelectTrigger className={inputClassName}>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {personnel.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.firstName} {p.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SwipeableRow>

          <SwipeableRow label="Observer" onClear={() => clearField("observerCrewId")}>
            <Select value={formData.observerCrewId} onValueChange={(v) => updateField("observerCrewId", v)}>
              <SelectTrigger className={inputClassName}>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {personnel.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.firstName} {p.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SwipeableRow>
        </div>

        {/* D) Landings Section */}
        <div>
          <SectionHeader title="Landings" />

          <SwipeableRow label="Day T/O" onClear={() => clearField("dayTakeoffs", "0")}>
            <Input
              type="number"
              min="0"
              value={formData.dayTakeoffs}
              onChange={(e) => updateField("dayTakeoffs", e.target.value)}
              className={inputClassName}
            />
          </SwipeableRow>

          <SwipeableRow label="Day Ldg" onClear={() => clearField("dayLandings", "0")}>
            <Input
              type="number"
              min="0"
              value={formData.dayLandings}
              onChange={(e) => updateField("dayLandings", e.target.value)}
              className={inputClassName}
            />
          </SwipeableRow>

          <SwipeableRow label="Night T/O" onClear={() => clearField("nightTakeoffs", "0")}>
            <Input
              type="number"
              min="0"
              value={formData.nightTakeoffs}
              onChange={(e) => updateField("nightTakeoffs", e.target.value)}
              className={inputClassName}
            />
          </SwipeableRow>

          <SwipeableRow label="Night Ldg" onClear={() => clearField("nightLandings", "0")}>
            <Input
              type="number"
              min="0"
              value={formData.nightLandings}
              onChange={(e) => updateField("nightLandings", e.target.value)}
              className={inputClassName}
            />
          </SwipeableRow>

          <SwipeableRow label="Autolands" onClear={() => clearField("autolands", "0")}>
            <Input
              type="number"
              min="0"
              value={formData.autolands}
              onChange={(e) => updateField("autolands", e.target.value)}
              className={inputClassName}
            />
          </SwipeableRow>
        </div>

        {/* E) App and Hold Section */}
        <div>
          <SectionHeader title="App and Hold" />

          <SwipeableRow label="App 1" onClear={() => clearField("approach1")}>
            <Input
              placeholder="ILS 20C"
              value={formData.approach1}
              onChange={(e) => updateField("approach1", e.target.value)}
              className={inputClassName}
            />
          </SwipeableRow>

          <SwipeableRow label="App 2" onClear={() => clearField("approach2")}>
            <Input
              placeholder="VOR 02L"
              value={formData.approach2}
              onChange={(e) => updateField("approach2", e.target.value)}
              className={inputClassName}
            />
          </SwipeableRow>

          <SwipeableRow label="Holds" onClear={() => clearField("holds", "0")}>
            <Input
              type="number"
              min="0"
              value={formData.holds}
              onChange={(e) => updateField("holds", e.target.value)}
              className={inputClassName}
            />
          </SwipeableRow>
        </div>

        {/* F) Notes Section */}
        <div>
          <SectionHeader title="Notes" />

          <SwipeableRow label="Remarks" onClear={() => clearField("remarks")}>
            <Textarea
              value={formData.remarks}
              onChange={(e) => updateField("remarks", e.target.value)}
              className={cn(inputClassName, "min-h-20 resize-none")}
              placeholder="Additional notes..."
            />
          </SwipeableRow>

          <SwipeableRow label="IPC/ICC" showClear={false}>
            <div className="flex items-center gap-2 justify-end">
              <span className="text-sm text-muted-foreground">{formData.ipcIcc ? "Yes" : "No"}</span>
              <Switch checked={formData.ipcIcc} onCheckedChange={(checked) => updateField("ipcIcc", checked)} />
            </div>
          </SwipeableRow>
        </div>
      </div>
    </form>
  )
}
