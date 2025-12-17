"use client"

import type React from "react"
import type { FlightLog, Personnel } from "@/lib/indexed-db"
import { useState, useEffect, useMemo } from "react"
import {
  addFlight,
  updateFlight,
  getAllPersonnel,
  addRecentlyUsedAirport,
  addRecentlyUsedAircraft,
} from "@/lib/indexed-db"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useAirportDatabase } from "@/hooks/use-indexed-db"
import { getAirportByICAO } from "@/lib/airport-database"
import { calculateTimesFromOOOI, isNight } from "@/lib/night-time-calculator"
import { Plane, Save, X, MapPin, ChevronDown, ChevronUp, Edit3, Users } from "lucide-react"

const FORM_STORAGE_KEY = "flight-form-draft"

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

interface FormData {
  date: string
  flightNumber: string
  aircraftReg: string
  aircraftType: string
  departureIcao: string
  departureIata: string
  arrivalIcao: string
  arrivalIata: string
  scheduledOut: string
  scheduledIn: string
  outTime: string
  offTime: string
  onTime: string
  inTime: string
  picId: string
  picName: string
  sicId: string
  sicName: string
  otherCrew: string
  pilotRole: "PF" | "PM" | "STUDENT" | "INSTRUCTOR"
  dayTakeoffs: number
  dayLandings: number
  nightTakeoffs: number
  nightLandings: number
  autolands: number
  remarks: string
  endorsements: string
  manualNightTime: string
  manualIfrTime: string
  manualActualInstrumentTime: string
  manualCrossCountryTime: string
  useManualOverrides: boolean
  ifrTime: string
  actualInstrumentTime: string
  simulatedInstrumentTime: string
  crossCountryTime: string
  approach1: string
  approach2: string
  holds: number
  ipcIcc: boolean
}

const defaultFormData: FormData = {
  date: new Date().toISOString().split("T")[0],
  flightNumber: "",
  aircraftReg: "",
  aircraftType: "",
  departureIcao: "",
  departureIata: "",
  arrivalIcao: "",
  arrivalIata: "",
  scheduledOut: "",
  scheduledIn: "",
  outTime: "",
  offTime: "",
  onTime: "",
  inTime: "",
  picId: "",
  picName: "",
  sicId: "",
  sicName: "",
  otherCrew: "",
  pilotRole: "PM",
  dayTakeoffs: 0,
  dayLandings: 1,
  nightTakeoffs: 0,
  nightLandings: 0,
  autolands: 0,
  remarks: "",
  endorsements: "",
  manualNightTime: "",
  manualIfrTime: "",
  manualActualInstrumentTime: "",
  manualCrossCountryTime: "",
  useManualOverrides: false,
  ifrTime: "00:00",
  actualInstrumentTime: "00:00",
  simulatedInstrumentTime: "00:00",
  crossCountryTime: "00:00",
  approach1: "",
  approach2: "",
  holds: 0,
  ipcIcc: false,
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
  const [personnel, setPersonnel] = useState<Personnel[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showOverrides, setShowOverrides] = useState(false)

  // Initialize form data from sessionStorage or defaults
  const [formData, setFormData] = useState<FormData>(() => {
    if (typeof window !== "undefined" && !editingFlight) {
      const saved = sessionStorage.getItem(FORM_STORAGE_KEY)
      if (saved) {
        try {
          return { ...defaultFormData, ...JSON.parse(saved) }
        } catch {
          // Ignore parse errors
        }
      }
    }
    return defaultFormData
  })

  // Load personnel
  useEffect(() => {
    const loadData = async () => {
      const pers = await getAllPersonnel()
      setPersonnel(pers)
    }
    loadData()
  }, [])

  // Handle editing flight
  useEffect(() => {
    if (editingFlight) {
      setFormData({
        date: editingFlight.date,
        flightNumber: editingFlight.flightNumber,
        aircraftReg: editingFlight.aircraftReg || "",
        aircraftType: editingFlight.aircraftType || "",
        departureIcao: editingFlight.departureIcao,
        departureIata: editingFlight.departureIata || "",
        arrivalIcao: editingFlight.arrivalIcao,
        arrivalIata: editingFlight.arrivalIata || "",
        scheduledOut: editingFlight.scheduledOut || "",
        scheduledIn: editingFlight.scheduledIn || "",
        outTime: editingFlight.outTime,
        offTime: editingFlight.offTime,
        onTime: editingFlight.onTime,
        inTime: editingFlight.inTime,
        picId: editingFlight.picId || "",
        picName: editingFlight.picName || "",
        sicId: editingFlight.sicId || "",
        sicName: editingFlight.sicName || "",
        otherCrew: editingFlight.otherCrew || "",
        pilotRole: editingFlight.pilotRole,
        dayTakeoffs: editingFlight.dayTakeoffs,
        dayLandings: editingFlight.dayLandings,
        nightTakeoffs: editingFlight.nightTakeoffs,
        nightLandings: editingFlight.nightLandings,
        autolands: editingFlight.autolands,
        remarks: editingFlight.remarks || "",
        endorsements: editingFlight.endorsements || "",
        manualNightTime: editingFlight.manualOverrides?.nightTime || "",
        manualIfrTime: editingFlight.manualOverrides?.ifrTime || "",
        manualActualInstrumentTime: editingFlight.manualOverrides?.actualInstrumentTime || "",
        manualCrossCountryTime: editingFlight.manualOverrides?.crossCountryTime || "",
        useManualOverrides: !!editingFlight.manualOverrides && Object.keys(editingFlight.manualOverrides).length > 0,
        ifrTime: editingFlight.ifrTime || "00:00",
        actualInstrumentTime: editingFlight.actualInstrumentTime || "00:00",
        simulatedInstrumentTime: editingFlight.simulatedInstrumentTime || "00:00",
        crossCountryTime: editingFlight.crossCountryTime || "00:00",
        approach1: editingFlight.approach1 || "",
        approach2: editingFlight.approach2 || "",
        holds: editingFlight.holds || 0,
        ipcIcc: editingFlight.ipcIcc || false,
      })
      if (editingFlight.manualOverrides && Object.keys(editingFlight.manualOverrides).length > 0) {
        setShowOverrides(true)
      }
    }
  }, [editingFlight])

  // Handle airport selection from picker
  useEffect(() => {
    if (selectedAirportField && selectedAirportCode) {
      const airport = getAirportByICAO(airports, selectedAirportCode)
      setFormData((prev) => {
        const updated = { ...prev }
        if (selectedAirportField === "departureIcao") {
          updated.departureIcao = selectedAirportCode
          updated.departureIata = airport?.iata || ""
        } else if (selectedAirportField === "arrivalIcao") {
          updated.arrivalIcao = selectedAirportCode
          updated.arrivalIata = airport?.iata || ""
        }
        return updated
      })

      addRecentlyUsedAirport(selectedAirportCode)

      const url = new URL(window.location.href)
      url.searchParams.delete("field")
      url.searchParams.delete("airport")
      window.history.replaceState({}, "", url.toString())
    }
  }, [selectedAirportField, selectedAirportCode, airports])

  // Handle aircraft selection from picker
  useEffect(() => {
    if (selectedAircraftReg) {
      setFormData((prev) => ({
        ...prev,
        aircraftReg: selectedAircraftReg,
        aircraftType: selectedAircraftType || prev.aircraftType,
      }))

      addRecentlyUsedAircraft(selectedAircraftReg)

      const url = new URL(window.location.href)
      url.searchParams.delete("field")
      url.searchParams.delete("aircraftReg")
      url.searchParams.delete("aircraftType")
      window.history.replaceState({}, "", url.toString())
    }
  }, [selectedAircraftReg, selectedAircraftType])

  useEffect(() => {
    if (selectedCrewField && selectedCrewId) {
      setFormData((prev) => {
        const updated = { ...prev }
        if (selectedCrewField === "picId") {
          updated.picId = selectedCrewId
          updated.picName = selectedCrewName || ""
        } else if (selectedCrewField === "sicId") {
          updated.sicId = selectedCrewId
          updated.sicName = selectedCrewName || ""
        }
        return updated
      })

      const url = new URL(window.location.href)
      url.searchParams.delete("field")
      url.searchParams.delete("crewId")
      url.searchParams.delete("crewName")
      window.history.replaceState({}, "", url.toString())
    }
  }, [selectedCrewField, selectedCrewId, selectedCrewName])

  // Save form data to sessionStorage whenever it changes
  useEffect(() => {
    if (!editingFlight) {
      sessionStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(formData))
    }
  }, [formData, editingFlight])

  // Calculate times when OOOI changes
  const calculatedTimes = useMemo(() => {
    const depAirport = getAirportByICAO(airports, formData.departureIcao)
    const arrAirport = getAirportByICAO(airports, formData.arrivalIcao)

    return calculateTimesFromOOOI(
      formData.date,
      formData.outTime,
      formData.offTime,
      formData.onTime,
      formData.inTime,
      depAirport?.latitude,
      depAirport?.longitude,
      arrAirport?.latitude,
      arrAirport?.longitude,
    )
  }, [
    formData.date,
    formData.outTime,
    formData.offTime,
    formData.onTime,
    formData.inTime,
    formData.departureIcao,
    formData.arrivalIcao,
    airports,
  ])

  // Auto-detect night takeoff/landing
  useEffect(() => {
    if (!formData.offTime || !formData.onTime || !formData.date) return

    const depAirport = getAirportByICAO(airports, formData.departureIcao)
    const arrAirport = getAirportByICAO(airports, formData.arrivalIcao)

    if (depAirport && depAirport.latitude && depAirport.longitude && formData.offTime) {
      const isNightTO = isNight(formData.date, formData.offTime, depAirport.latitude, depAirport.longitude)
      setFormData((prev) => ({
        ...prev,
        nightTakeoffs: isNightTO ? 1 : 0,
        dayTakeoffs: isNightTO ? 0 : 1,
      }))
    }

    if (arrAirport && arrAirport.latitude && arrAirport.longitude && formData.onTime) {
      const isNightLdg = isNight(formData.date, formData.onTime, arrAirport.latitude, arrAirport.longitude)
      setFormData((prev) => ({
        ...prev,
        nightLandings: isNightLdg ? 1 : 0,
        dayLandings: isNightLdg ? 0 : 1,
      }))
    }
  }, [formData.date, formData.offTime, formData.onTime, formData.departureIcao, formData.arrivalIcao, airports])

  const openAircraftPicker = () => {
    sessionStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(formData))
    router.push(`/aircraft?select=true&returnTo=/new-flight&field=aircraftReg`)
  }

  const openAirportPicker = (field: "departureIcao" | "arrivalIcao") => {
    sessionStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(formData))
    router.push(`/airports?select=true&returnTo=/new-flight&field=${field}`)
  }

  const openCrewPicker = (field: "picId" | "sicId") => {
    sessionStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(formData))
    router.push(`/crew?select=true&return=/new-flight&field=${field}`)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const manualOverrides: FlightLog["manualOverrides"] = {}
      if (formData.useManualOverrides) {
        if (formData.manualNightTime) manualOverrides.nightTime = formData.manualNightTime
        if (formData.manualIfrTime) manualOverrides.ifrTime = formData.manualIfrTime
        if (formData.manualActualInstrumentTime)
          manualOverrides.actualInstrumentTime = formData.manualActualInstrumentTime
        if (formData.manualCrossCountryTime) manualOverrides.crossCountryTime = formData.manualCrossCountryTime
      }

      const nightTime =
        formData.useManualOverrides && formData.manualNightTime ? formData.manualNightTime : calculatedTimes.nightTime

      const flightData: Omit<FlightLog, "id" | "createdAt" | "updatedAt" | "syncStatus"> = {
        date: formData.date,
        flightNumber: formData.flightNumber,
        aircraftReg: formData.aircraftReg,
        aircraftType: formData.aircraftType,
        departureIcao: formData.departureIcao,
        departureIata: formData.departureIata,
        arrivalIcao: formData.arrivalIcao,
        arrivalIata: formData.arrivalIata,
        scheduledOut: formData.scheduledOut,
        scheduledIn: formData.scheduledIn,
        outTime: formData.outTime,
        offTime: formData.offTime,
        onTime: formData.onTime,
        inTime: formData.inTime,
        blockTime: calculatedTimes.blockTime || "00:00",
        flightTime: calculatedTimes.flightTime || "00:00",
        nightTime: nightTime || "00:00",
        picId: formData.picId,
        picName: formData.picName,
        sicId: formData.sicId,
        sicName: formData.sicName,
        otherCrew: formData.otherCrew,
        pilotRole: formData.pilotRole,
        p1Time: ["PIC", "P1", "PF"].includes(formData.pilotRole) ? calculatedTimes.flightTime || "00:00" : "00:00",
        p2Time: ["SIC", "P2", "PM"].includes(formData.pilotRole) ? calculatedTimes.flightTime || "00:00" : "00:00",
        puTime: formData.pilotRole === "PU" ? calculatedTimes.flightTime || "00:00" : "00:00",
        dualTime: formData.pilotRole === "STUDENT" ? calculatedTimes.flightTime || "00:00" : "00:00",
        instructorTime: formData.pilotRole === "INSTRUCTOR" ? calculatedTimes.flightTime || "00:00" : "00:00",
        dayTakeoffs: formData.dayTakeoffs,
        dayLandings: formData.dayLandings,
        nightTakeoffs: formData.nightTakeoffs,
        nightLandings: formData.nightLandings,
        autolands: formData.autolands,
        remarks: formData.remarks,
        endorsements: formData.endorsements,
        manualOverrides: Object.keys(manualOverrides).length > 0 ? manualOverrides : {},
        ifrTime: formData.useManualOverrides && formData.manualIfrTime ? formData.manualIfrTime : formData.ifrTime,
        actualInstrumentTime:
          formData.useManualOverrides && formData.manualActualInstrumentTime
            ? formData.manualActualInstrumentTime
            : formData.actualInstrumentTime,
        simulatedInstrumentTime: formData.simulatedInstrumentTime,
        crossCountryTime:
          formData.useManualOverrides && formData.manualCrossCountryTime
            ? formData.manualCrossCountryTime
            : formData.crossCountryTime,
        approach1: formData.approach1,
        approach2: formData.approach2,
        holds: formData.holds,
        ipcIcc: formData.ipcIcc,
      }

      let savedFlight: FlightLog
      if (editingFlight) {
        savedFlight = (await updateFlight(editingFlight.id, flightData)) as FlightLog
      } else {
        savedFlight = await addFlight(flightData)
      }

      sessionStorage.removeItem(FORM_STORAGE_KEY)

      if (formData.departureIcao) await addRecentlyUsedAirport(formData.departureIcao)
      if (formData.arrivalIcao) await addRecentlyUsedAirport(formData.arrivalIcao)
      if (formData.aircraftReg) await addRecentlyUsedAircraft(formData.aircraftReg)

      onFlightAdded(savedFlight)
    } catch (error) {
      console.error("Failed to save flight:", error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = () => {
    sessionStorage.removeItem(FORM_STORAGE_KEY)
    onClose()
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Plane className="h-5 w-5" />
            {editingFlight ? "Edit Flight" : "New Flight"}
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={handleCancel}>
            <X className="h-5 w-5" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Date and Flight Number */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">Date</Label>
              <Input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData((prev) => ({ ...prev, date: e.target.value }))}
                className="h-9"
                required
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Flight #</Label>
              <Input
                value={formData.flightNumber}
                onChange={(e) => setFormData((prev) => ({ ...prev, flightNumber: e.target.value.toUpperCase() }))}
                placeholder="SQ123"
                className="h-9"
              />
            </div>
          </div>

          {/* Aircraft Selection */}
          <div>
            <Label className="text-xs text-muted-foreground">Aircraft</Label>
            <Button
              type="button"
              variant="outline"
              className="w-full h-9 justify-start font-normal bg-transparent"
              onClick={openAircraftPicker}
            >
              <Plane className="h-4 w-4 mr-2 text-muted-foreground" />
              {formData.aircraftReg ? (
                <span>
                  {formData.aircraftReg}
                  {formData.aircraftType && (
                    <span className="text-muted-foreground ml-1">({formData.aircraftType})</span>
                  )}
                </span>
              ) : (
                <span className="text-muted-foreground">Select aircraft</span>
              )}
            </Button>
          </div>

          {/* From/To Airports */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">From</Label>
              <Button
                type="button"
                variant="outline"
                className="w-full h-9 justify-start font-normal bg-transparent"
                onClick={() => openAirportPicker("departureIcao")}
              >
                <MapPin className="h-4 w-4 mr-2 text-muted-foreground" />
                {formData.departureIcao ? (
                  <span>
                    {formData.departureIcao}
                    {formData.departureIata && (
                      <span className="text-muted-foreground ml-1">/{formData.departureIata}</span>
                    )}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Select</span>
                )}
              </Button>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">To</Label>
              <Button
                type="button"
                variant="outline"
                className="w-full h-9 justify-start font-normal bg-transparent"
                onClick={() => openAirportPicker("arrivalIcao")}
              >
                <MapPin className="h-4 w-4 mr-2 text-muted-foreground" />
                {formData.arrivalIcao ? (
                  <span>
                    {formData.arrivalIcao}
                    {formData.arrivalIata && (
                      <span className="text-muted-foreground ml-1">/{formData.arrivalIata}</span>
                    )}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Select</span>
                )}
              </Button>
            </div>
          </div>

          {/* Scheduled Times */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">Sched Out</Label>
              <Input
                type="time"
                value={formData.scheduledOut}
                onChange={(e) => setFormData((prev) => ({ ...prev, scheduledOut: e.target.value }))}
                className="h-9 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Sched In</Label>
              <Input
                type="time"
                value={formData.scheduledIn}
                onChange={(e) => setFormData((prev) => ({ ...prev, scheduledIn: e.target.value }))}
                className="h-9 text-sm"
              />
            </div>
          </div>

          {/* OOOI Times */}
          <div className="grid grid-cols-4 gap-1">
            <div>
              <Label className="text-xs text-muted-foreground">Out</Label>
              <Input
                type="time"
                value={formData.outTime}
                onChange={(e) => setFormData((prev) => ({ ...prev, outTime: e.target.value }))}
                className="h-9 text-sm px-2"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Off</Label>
              <Input
                type="time"
                value={formData.offTime}
                onChange={(e) => setFormData((prev) => ({ ...prev, offTime: e.target.value }))}
                className="h-9 text-sm px-2"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">On</Label>
              <Input
                type="time"
                value={formData.onTime}
                onChange={(e) => setFormData((prev) => ({ ...prev, onTime: e.target.value }))}
                className="h-9 text-sm px-2"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">In</Label>
              <Input
                type="time"
                value={formData.inTime}
                onChange={(e) => setFormData((prev) => ({ ...prev, inTime: e.target.value }))}
                className="h-9 text-sm px-2"
              />
            </div>
          </div>

          {/* Calculated Times Display */}
          <div className="grid grid-cols-3 gap-2 p-2 bg-muted/50 rounded-lg">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Block</p>
              <p className="font-mono font-medium">{calculatedTimes.blockTime || "0:00"}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Flight</p>
              <p className="font-mono font-medium">{calculatedTimes.flightTime || "0:00"}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Night</p>
              <p className="font-mono font-medium">
                {formData.useManualOverrides && formData.manualNightTime
                  ? formData.manualNightTime
                  : calculatedTimes.nightTime || "0:00"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">PIC/P1</Label>
              <Button
                type="button"
                variant="outline"
                className="w-full h-9 justify-start font-normal bg-transparent"
                onClick={() => openCrewPicker("picId")}
              >
                <Users className="h-4 w-4 mr-2 text-muted-foreground" />
                {formData.picName ? (
                  <span className="truncate">{formData.picName}</span>
                ) : (
                  <span className="text-muted-foreground">Select PIC</span>
                )}
              </Button>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">SIC/P2</Label>
              <Button
                type="button"
                variant="outline"
                className="w-full h-9 justify-start font-normal bg-transparent"
                onClick={() => openCrewPicker("sicId")}
              >
                <Users className="h-4 w-4 mr-2 text-muted-foreground" />
                {formData.sicName ? (
                  <span className="truncate">{formData.sicName}</span>
                ) : (
                  <span className="text-muted-foreground">Select SIC</span>
                )}
              </Button>
            </div>
          </div>

          {/* Other Crew */}
          <div>
            <Label className="text-xs text-muted-foreground">Other Crew</Label>
            <Input
              value={formData.otherCrew}
              onChange={(e) => setFormData((prev) => ({ ...prev, otherCrew: e.target.value }))}
              placeholder="Additional crew members"
              className="h-9"
            />
          </div>

          {/* Pilot Role */}
          <div>
            <Label className="text-xs text-muted-foreground">Pilot Role (Logging As)</Label>
            <Select
              value={formData.pilotRole}
              onValueChange={(value) => setFormData((prev) => ({ ...prev, pilotRole: value as FormData["pilotRole"] }))}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PIC">PIC</SelectItem>
                <SelectItem value="SIC">SIC</SelectItem>
                <SelectItem value="P1">P1</SelectItem>
                <SelectItem value="P2">P2</SelectItem>
                <SelectItem value="PU">P1 U/S</SelectItem>
                <SelectItem value="PF">Pilot Flying</SelectItem>
                <SelectItem value="PM">Pilot Monitoring</SelectItem>
                <SelectItem value="STUDENT">Student</SelectItem>
                <SelectItem value="INSTRUCTOR">Instructor</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Takeoffs/Landings */}
          <div className="grid grid-cols-5 gap-1">
            <div>
              <Label className="text-xs text-muted-foreground">Day TO</Label>
              <Input
                type="number"
                min={0}
                value={formData.dayTakeoffs}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, dayTakeoffs: Number.parseInt(e.target.value) || 0 }))
                }
                className="h-9 px-2"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Day Ldg</Label>
              <Input
                type="number"
                min={0}
                value={formData.dayLandings}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, dayLandings: Number.parseInt(e.target.value) || 0 }))
                }
                className="h-9 px-2"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Ngt TO</Label>
              <Input
                type="number"
                min={0}
                value={formData.nightTakeoffs}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, nightTakeoffs: Number.parseInt(e.target.value) || 0 }))
                }
                className="h-9 px-2"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Ngt Ldg</Label>
              <Input
                type="number"
                min={0}
                value={formData.nightLandings}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, nightLandings: Number.parseInt(e.target.value) || 0 }))
                }
                className="h-9 px-2"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Auto</Label>
              <Input
                type="number"
                min={0}
                value={formData.autolands}
                onChange={(e) => setFormData((prev) => ({ ...prev, autolands: Number.parseInt(e.target.value) || 0 }))}
                className="h-9 px-2"
              />
            </div>
          </div>

          {/* Remarks */}
          <div>
            <Label className="text-xs text-muted-foreground">Remarks</Label>
            <Textarea
              value={formData.remarks}
              onChange={(e) => setFormData((prev) => ({ ...prev, remarks: e.target.value }))}
              placeholder="Additional notes..."
              className="h-16 resize-none"
            />
          </div>

          {/* Endorsements */}
          <div>
            <Label className="text-xs text-muted-foreground">Endorsements</Label>
            <Textarea
              value={formData.endorsements}
              onChange={(e) => setFormData((prev) => ({ ...prev, endorsements: e.target.value }))}
              placeholder="Route checks, line checks, etc..."
              className="h-16 resize-none"
            />
          </div>

          {/* Manual Overrides Section */}
          <Collapsible open={showOverrides} onOpenChange={setShowOverrides}>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" className="w-full justify-between h-9 px-2">
                <span className="flex items-center gap-2 text-sm">
                  <Edit3 className="h-4 w-4" />
                  Manual Overrides
                </span>
                {showOverrides ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Enable Manual Overrides</Label>
                <Switch
                  checked={formData.useManualOverrides}
                  onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, useManualOverrides: checked }))}
                />
              </div>
              {formData.useManualOverrides && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">Night Time</Label>
                    <Input
                      type="time"
                      value={formData.manualNightTime}
                      onChange={(e) => setFormData((prev) => ({ ...prev, manualNightTime: e.target.value }))}
                      className="h-9"
                      placeholder="HH:MM"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">IFR Time</Label>
                    <Input
                      type="time"
                      value={formData.manualIfrTime}
                      onChange={(e) => setFormData((prev) => ({ ...prev, manualIfrTime: e.target.value }))}
                      className="h-9"
                      placeholder="HH:MM"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Actual Instrument</Label>
                    <Input
                      type="time"
                      value={formData.manualActualInstrumentTime}
                      onChange={(e) => setFormData((prev) => ({ ...prev, manualActualInstrumentTime: e.target.value }))}
                      className="h-9"
                      placeholder="HH:MM"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Cross Country</Label>
                    <Input
                      type="time"
                      value={formData.manualCrossCountryTime}
                      onChange={(e) => setFormData((prev) => ({ ...prev, manualCrossCountryTime: e.target.value }))}
                      className="h-9"
                      placeholder="HH:MM"
                    />
                  </div>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>

          {/* Advanced Section */}
          <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" className="w-full justify-between h-9 px-2">
                <span className="text-sm">Advanced Options</span>
                {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-2">
              {/* Approaches */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Approach 1</Label>
                  <Input
                    value={formData.approach1}
                    onChange={(e) => setFormData((prev) => ({ ...prev, approach1: e.target.value }))}
                    placeholder="ILS 28L"
                    className="h-9"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Approach 2</Label>
                  <Input
                    value={formData.approach2}
                    onChange={(e) => setFormData((prev) => ({ ...prev, approach2: e.target.value }))}
                    placeholder="VOR 10"
                    className="h-9"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Holds</Label>
                  <Input
                    type="number"
                    min={0}
                    value={formData.holds}
                    onChange={(e) => setFormData((prev) => ({ ...prev, holds: Number.parseInt(e.target.value) || 0 }))}
                    className="h-9"
                  />
                </div>
              </div>

              {/* IPC/ICC Toggle */}
              <div className="flex items-center justify-between">
                <Label className="text-sm">IPC/ICC Check</Label>
                <Switch
                  checked={formData.ipcIcc}
                  onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, ipcIcc: checked }))}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Submit Button */}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            <Save className="h-4 w-4 mr-2" />
            {isSubmitting ? "Saving..." : editingFlight ? "Update Flight" : "Save Flight"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
