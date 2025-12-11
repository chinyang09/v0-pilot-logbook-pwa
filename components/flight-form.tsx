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
  const startX = useRef(0)
  const currentX = useRef(0)

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    currentX.current = e.touches[0].clientX
  }

  const handleTouchEnd = () => {
    const diff = startX.current - currentX.current
    if (diff > 50) {
      setSwiped(true)
    } else if (diff < -50) {
      setSwiped(false)
    }
  }

  return (
    <div className="relative overflow-hidden">
      {showClear && onClear && (
        <button
          type="button"
          onClick={() => {
            onClear()
            setSwiped(false)
          }}
          className="absolute right-0 top-0 bottom-0 w-16 bg-destructive text-destructive-foreground flex items-center justify-center z-0"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
      <div
        className={cn(
          "flex items-center gap-3 py-2 px-1 transition-transform duration-200 bg-card relative z-10",
          swiped && "-translate-x-16",
        )}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => swiped && setSwiped(false)}
      >
        <span className="text-sm text-muted-foreground w-24 flex-shrink-0">{label}</span>
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
    pilotRole: "FO" as PilotRole,
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
        pilotRole: (editingFlight.pilotRole as PilotRole) || "FO",
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

      const isPilotFlying = formData.pilotRole === "PIC" || formData.pilotRole === "INSTRUCTOR"
      const hasNightTime = nightTime !== "00:00"

      if (isPilotFlying && !editingFlight) {
        // Check if takeoff is during night
        let takeoffIsNight = false
        let landingIsNight = false

        if (departureAirport && formData.offTime) {
          const offDateTime = new Date(`${formData.date}T${formData.offTime}:00Z`)
          // Simple night check: between 6pm and 6am local
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

      let p1Time = "00:00",
        p2Time = "00:00",
        p1usTime = "00:00",
        dualTime = "00:00",
        instructorTime = "00:00"
      switch (formData.pilotRole) {
        case "PIC":
          p1Time = flightTime
          break
        case "FO":
          p2Time = flightTime
          break
        case "P1US":
          p1usTime = flightTime
          break
        case "STUDENT":
          dualTime = flightTime
          break
        case "INSTRUCTOR":
          instructorTime = flightTime
          p1Time = flightTime
          break
      }

      setCalculatedTimes({ blockTime, flightTime, nightTime, p1Time, p2Time, p1usTime, dualTime, instructorTime })
    }
  }, [
    formData.outTime,
    formData.offTime,
    formData.onTime,
    formData.inTime,
    formData.date,
    formData.pilotRole,
    departureAirport,
    arrivalAirport,
    editingFlight,
  ])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const crewIds = [formData.picCrewId, formData.sicCrewId, formData.observerCrewId].filter(Boolean)

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
        pilotRole: formData.pilotRole,
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

  const inputClassName = "bg-input h-9 text-sm text-right w-full"

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

      <div className="px-3 pb-3 divide-y divide-border">
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

          <SwipeableRow label="Total" showClear={false}>
            <div className="flex items-center gap-2 justify-end">
              <span className="font-mono text-sm font-semibold">{formatHHMMDisplay(calculatedTimes.blockTime)}</span>
              <span className="text-xs text-muted-foreground">
                (Flt: {formatHHMMDisplay(calculatedTimes.flightTime)})
              </span>
            </div>
          </SwipeableRow>

          <SwipeableRow label="Night" showClear={false}>
            <span className="font-mono text-sm text-right">{formatHHMMDisplay(calculatedTimes.nightTime)}</span>
          </SwipeableRow>

          <SwipeableRow label="P1 U/S" showClear={false}>
            <span className="font-mono text-sm text-right">{formatHHMMDisplay(calculatedTimes.p1usTime)}</span>
          </SwipeableRow>

          <SwipeableRow label="SIC" showClear={false}>
            <span className="font-mono text-sm text-right">{formatHHMMDisplay(calculatedTimes.p2Time)}</span>
          </SwipeableRow>

          <SwipeableRow label="XC" onClear={() => clearField("crossCountryTime")}>
            <div className="relative w-full">
              <Input
                type="time"
                value={formData.crossCountryTime}
                onChange={(e) => updateField("crossCountryTime", e.target.value)}
                className={cn(inputClassName, "pr-20")}
              />
              <button
                type="button"
                onClick={() => copyFlightTime("crossCountryTime")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-primary"
              >
                Use {formatHHMMDisplay(calculatedTimes.flightTime)}
              </button>
            </div>
          </SwipeableRow>

          <SwipeableRow label="IFR" onClear={() => clearField("ifrTime")}>
            <div className="relative w-full">
              <Input
                type="time"
                value={formData.ifrTime}
                onChange={(e) => updateField("ifrTime", e.target.value)}
                className={cn(inputClassName, "pr-20")}
              />
              <button
                type="button"
                onClick={() => copyFlightTime("ifrTime")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-primary"
              >
                Use {formatHHMMDisplay(calculatedTimes.flightTime)}
              </button>
            </div>
          </SwipeableRow>

          <SwipeableRow label="Actual Inst" onClear={() => clearField("actualInstrumentTime")}>
            <div className="relative w-full">
              <Input
                type="time"
                value={formData.actualInstrumentTime}
                onChange={(e) => updateField("actualInstrumentTime", e.target.value)}
                className={cn(inputClassName, "pr-20")}
              />
              <button
                type="button"
                onClick={() => copyFlightTime("actualInstrumentTime")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-primary"
              >
                Use {formatHHMMDisplay(calculatedTimes.flightTime)}
              </button>
            </div>
          </SwipeableRow>

          <SwipeableRow label="Sim Inst" onClear={() => clearField("simulatedInstrumentTime")}>
            <div className="relative w-full">
              <Input
                type="time"
                value={formData.simulatedInstrumentTime}
                onChange={(e) => updateField("simulatedInstrumentTime", e.target.value)}
                className={cn(inputClassName, "pr-20")}
              />
              <button
                type="button"
                onClick={() => copyFlightTime("simulatedInstrumentTime")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-primary"
              >
                Use {formatHHMMDisplay(calculatedTimes.flightTime)}
              </button>
            </div>
          </SwipeableRow>
        </div>

        {/* C) Crew Section */}
        <div>
          <SectionHeader title="Crew">
            <Button type="button" variant="ghost" size="sm" onClick={swapCrew} className="h-6 px-2 text-xs gap-1">
              <ArrowLeftRight className="h-3 w-3" />
              Swap
            </Button>
          </SectionHeader>

          <SwipeableRow label="PIC/P1" onClear={() => clearField("picCrewId")}>
            <Select value={formData.picCrewId} onValueChange={(v) => updateField("picCrewId", v)}>
              <SelectTrigger className={inputClassName}>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {personnel.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.firstName} {p.lastName} ({p.role})
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
                    {p.firstName} {p.lastName} ({p.role})
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

          <SwipeableRow label="My Role" onClear={() => clearField("pilotRole", "FO")}>
            <Select value={formData.pilotRole} onValueChange={(v) => updateField("pilotRole", v)}>
              <SelectTrigger className={inputClassName}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PIC">PIC</SelectItem>
                <SelectItem value="FO">FO / SIC</SelectItem>
                <SelectItem value="P1US">P1 U/S</SelectItem>
                <SelectItem value="STUDENT">Student</SelectItem>
                <SelectItem value="INSTRUCTOR">Instructor</SelectItem>
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
              placeholder="ILS 02L"
              value={formData.approach1}
              onChange={(e) => updateField("approach1", e.target.value)}
              className={inputClassName}
            />
          </SwipeableRow>

          <SwipeableRow label="App 2" onClear={() => clearField("approach2")}>
            <Input
              placeholder="RNAV 20"
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
              placeholder="Additional notes..."
              value={formData.remarks}
              onChange={(e) => updateField("remarks", e.target.value)}
              className="bg-input text-sm min-h-[60px] text-right w-full"
            />
          </SwipeableRow>

          <SwipeableRow label="IPC/ICC" showClear={false}>
            <div className="flex items-center gap-2 justify-end">
              <span className="text-sm text-muted-foreground">{formData.ipcIcc ? "Yes" : "No"}</span>
              <Switch checked={formData.ipcIcc} onCheckedChange={(v) => updateField("ipcIcc", v)} />
            </div>
          </SwipeableRow>
        </div>
      </div>
    </form>
  )
}
