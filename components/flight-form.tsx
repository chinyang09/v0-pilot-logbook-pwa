"use client"

import type React from "react"

import type { FlightLog, Aircraft, Personnel } from "@/lib/indexed-db"
import { useState, useEffect, useMemo } from "react"
import {
  addFlight,
  updateFlight,
  getAllAircraft,
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
import { useAirportDatabase } from "@/hooks/use-indexed-db"
import { getAirportByICAO } from "@/lib/airport-database"
import { calculateTimesFromOOOI, isNight } from "@/lib/night-time-calculator"
import { Plane, Save, X, MapPin } from "lucide-react"

const FORM_STORAGE_KEY = "flight-form-draft"

interface FlightFormProps {
  onFlightAdded: (flight: FlightLog) => void
  onClose: () => void
  editingFlight?: FlightLog | null
  selectedAirportField?: string | null
  selectedAirportCode?: string | null
  selectedAircraftReg?: string | null
  selectedAircraftType?: string | null
}

interface FormData {
  date: string
  flightNumber: string
  aircraftId: string
  aircraftReg: string
  aircraftType: string
  departureIcao: string
  arrivalIcao: string
  outTime: string
  offTime: string
  onTime: string
  inTime: string
  isPilotFlying: boolean
  picCrewId: string
  sicCrewId: string
  pilotRole: "PIC" | "FO" | "STUDENT" | "INSTRUCTOR" | "P1US"
  p1usTime: string
  dayTakeoffs: number
  dayLandings: number
  nightTakeoffs: number
  nightLandings: number
  autolands: number
  ifrTime: string
  actualInstrumentTime: string
  simulatedInstrumentTime: string
  crossCountryTime: string
  approach1: string
  approach2: string
  holds: number
  remarks: string
  ipcIcc: boolean
}

const defaultFormData: FormData = {
  date: new Date().toISOString().split("T")[0],
  flightNumber: "",
  aircraftId: "",
  aircraftReg: "",
  aircraftType: "",
  departureIcao: "",
  arrivalIcao: "",
  outTime: "",
  offTime: "",
  onTime: "",
  inTime: "",
  isPilotFlying: false,
  picCrewId: "",
  sicCrewId: "",
  pilotRole: "FO",
  p1usTime: "00:00",
  dayTakeoffs: 0,
  dayLandings: 1,
  nightTakeoffs: 0,
  nightLandings: 0,
  autolands: 0,
  ifrTime: "00:00",
  actualInstrumentTime: "00:00",
  simulatedInstrumentTime: "00:00",
  crossCountryTime: "00:00",
  approach1: "",
  approach2: "",
  holds: 0,
  remarks: "",
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
}: FlightFormProps) {
  const router = useRouter()
  const { airports } = useAirportDatabase()
  const [aircraft, setAircraft] = useState<Aircraft[]>([])
  const [personnel, setPersonnel] = useState<Personnel[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

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

  // Load aircraft and personnel
  useEffect(() => {
    const loadData = async () => {
      const [ac, pers] = await Promise.all([getAllAircraft(), getAllPersonnel()])
      setAircraft(ac)
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
        aircraftId: editingFlight.aircraftId,
        aircraftReg: editingFlight.aircraftReg || "",
        aircraftType: editingFlight.aircraftType || "",
        departureIcao: editingFlight.departureIcao,
        arrivalIcao: editingFlight.arrivalIcao,
        outTime: editingFlight.outTime,
        offTime: editingFlight.offTime,
        onTime: editingFlight.onTime,
        inTime: editingFlight.inTime,
        isPilotFlying: editingFlight.pilotRole === "PIC" || editingFlight.pilotRole === "P1US",
        picCrewId: editingFlight.picId || "",
        sicCrewId: editingFlight.sicId || "",
        pilotRole: editingFlight.pilotRole,
        p1usTime: editingFlight.p1usTime || "00:00",
        dayTakeoffs: editingFlight.dayTakeoffs,
        dayLandings: editingFlight.dayLandings,
        nightTakeoffs: editingFlight.nightTakeoffs,
        nightLandings: editingFlight.nightLandings,
        autolands: editingFlight.autolands,
        ifrTime: editingFlight.ifrTime || "00:00",
        actualInstrumentTime: editingFlight.actualInstrumentTime || "00:00",
        simulatedInstrumentTime: editingFlight.simulatedInstrumentTime || "00:00",
        crossCountryTime: editingFlight.crossCountryTime || "00:00",
        approach1: editingFlight.approach1 || "",
        approach2: editingFlight.approach2 || "",
        holds: editingFlight.holds || 0,
        remarks: editingFlight.remarks || "",
        ipcIcc: editingFlight.ipcIcc || false,
      })
    }
  }, [editingFlight])

  // Handle airport selection from picker
  useEffect(() => {
    if (selectedAirportField && selectedAirportCode) {
      setFormData((prev) => {
        const updated = { ...prev }
        if (selectedAirportField === "departureIcao") {
          updated.departureIcao = selectedAirportCode
        } else if (selectedAirportField === "arrivalIcao") {
          updated.arrivalIcao = selectedAirportCode
        }
        return updated
      })

      // Save to recently used
      addRecentlyUsedAirport(selectedAirportCode)

      // Clear URL params
      const url = new URL(window.location.href)
      url.searchParams.delete("field")
      url.searchParams.delete("airport")
      window.history.replaceState({}, "", url.toString())
    }
  }, [selectedAirportField, selectedAirportCode])

  useEffect(() => {
    if (selectedAircraftReg) {
      setFormData((prev) => ({
        ...prev,
        aircraftReg: selectedAircraftReg,
        aircraftType: selectedAircraftType || prev.aircraftType,
      }))

      // Save to recently used
      addRecentlyUsedAircraft(selectedAircraftReg)

      // Clear URL params
      const url = new URL(window.location.href)
      url.searchParams.delete("field")
      url.searchParams.delete("aircraftReg")
      url.searchParams.delete("aircraftType")
      window.history.replaceState({}, "", url.toString())
    }
  }, [selectedAircraftReg, selectedAircraftType])

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
      depAirport?.lat,
      depAirport?.lon,
      arrAirport?.lat,
      arrAirport?.lon,
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

    if (depAirport && formData.offTime) {
      const isNightTO = isNight(formData.date, formData.offTime, depAirport.lat, depAirport.lon)
      setFormData((prev) => ({
        ...prev,
        nightTakeoffs: isNightTO ? 1 : 0,
        dayTakeoffs: isNightTO ? 0 : 1,
      }))
    }

    if (arrAirport && formData.onTime) {
      const isNightLdg = isNight(formData.date, formData.onTime, arrAirport.lat, arrAirport.lon)
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

  // Navigate to airport picker
  const openAirportPicker = (field: "departureIcao" | "arrivalIcao") => {
    sessionStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(formData))
    router.push(`/airports?select=true&returnTo=/new-flight&field=${field}`)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const depAirport = getAirportByICAO(airports, formData.departureIcao)
      const arrAirport = getAirportByICAO(airports, formData.arrivalIcao)

      const flightData = {
        date: formData.date,
        flightNumber: formData.flightNumber,
        aircraftId: formData.aircraftId || formData.aircraftReg, // Use reg as ID if no ID
        aircraftReg: formData.aircraftReg,
        aircraftType: formData.aircraftType,
        departureIcao: formData.departureIcao,
        arrivalIcao: formData.arrivalIcao,
        outTime: formData.outTime,
        offTime: formData.offTime,
        onTime: formData.onTime,
        inTime: formData.inTime,
        blockTime: calculatedTimes.blockTime,
        flightTime: calculatedTimes.flightTime,
        p1Time: formData.pilotRole === "PIC" ? calculatedTimes.flightTime : "00:00",
        p1usTime: formData.pilotRole === "P1US" ? formData.p1usTime : "00:00",
        p2Time: formData.pilotRole === "FO" ? calculatedTimes.flightTime : "00:00",
        dualTime: formData.pilotRole === "STUDENT" ? calculatedTimes.flightTime : "00:00",
        instructorTime: formData.pilotRole === "INSTRUCTOR" ? calculatedTimes.flightTime : "00:00",
        nightTime: calculatedTimes.nightTime,
        ifrTime: formData.ifrTime,
        actualInstrumentTime: formData.actualInstrumentTime,
        simulatedInstrumentTime: formData.simulatedInstrumentTime,
        crossCountryTime: formData.crossCountryTime,
        dayTakeoffs: formData.dayTakeoffs,
        dayLandings: formData.dayLandings,
        nightTakeoffs: formData.nightTakeoffs,
        nightLandings: formData.nightLandings,
        autolands: formData.autolands,
        personnelIds: [formData.picCrewId, formData.sicCrewId].filter(Boolean),
        picId: formData.picCrewId,
        sicId: formData.sicCrewId,
        pilotRole: formData.pilotRole,
        approach1: formData.approach1,
        approach2: formData.approach2,
        holds: formData.holds,
        remarks: formData.remarks,
        ipcIcc: formData.ipcIcc,
      }

      let savedFlight: FlightLog
      if (editingFlight) {
        savedFlight = (await updateFlight(editingFlight.id, flightData)) as FlightLog
      } else {
        savedFlight = await addFlight(flightData)
      }

      // Clear form storage
      sessionStorage.removeItem(FORM_STORAGE_KEY)

      // Save airports to recently used
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
      <CardHeader className="pb-3">
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

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Date and Flight Number */}
          <div className="grid grid-cols-2 gap-3">
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
                onChange={(e) => setFormData((prev) => ({ ...prev, flightNumber: e.target.value }))}
                placeholder="SQ123"
                className="h-9"
              />
            </div>
          </div>

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

          {/* From/To Airports - Tap to open picker */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">From</Label>
              <Button
                type="button"
                variant="outline"
                className="w-full h-9 justify-start font-normal bg-transparent"
                onClick={() => openAirportPicker("departureIcao")}
              >
                <MapPin className="h-4 w-4 mr-2 text-muted-foreground" />
                {formData.departureIcao || <span className="text-muted-foreground">Select</span>}
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
                {formData.arrivalIcao || <span className="text-muted-foreground">Select</span>}
              </Button>
            </div>
          </div>

          {/* OOOI Times */}
          <div className="grid grid-cols-4 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">Out</Label>
              <Input
                type="time"
                value={formData.outTime}
                onChange={(e) => setFormData((prev) => ({ ...prev, outTime: e.target.value }))}
                className="h-9 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Off</Label>
              <Input
                type="time"
                value={formData.offTime}
                onChange={(e) => setFormData((prev) => ({ ...prev, offTime: e.target.value }))}
                className="h-9 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">On</Label>
              <Input
                type="time"
                value={formData.onTime}
                onChange={(e) => setFormData((prev) => ({ ...prev, onTime: e.target.value }))}
                className="h-9 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">In</Label>
              <Input
                type="time"
                value={formData.inTime}
                onChange={(e) => setFormData((prev) => ({ ...prev, inTime: e.target.value }))}
                className="h-9 text-sm"
              />
            </div>
          </div>

          {/* Calculated Times Display */}
          <div className="grid grid-cols-3 gap-2 p-2 bg-muted/50 rounded-lg">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Block</p>
              <p className="font-mono font-medium">{calculatedTimes.blockTime}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Flight</p>
              <p className="font-mono font-medium">{calculatedTimes.flightTime}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Night</p>
              <p className="font-mono font-medium">{calculatedTimes.nightTime}</p>
            </div>
          </div>

          {/* Pilot Role */}
          <div>
            <Label className="text-xs text-muted-foreground">Pilot Role</Label>
            <Select
              value={formData.pilotRole}
              onValueChange={(value) => setFormData((prev) => ({ ...prev, pilotRole: value as FormData["pilotRole"] }))}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PIC">PIC</SelectItem>
                <SelectItem value="FO">First Officer</SelectItem>
                <SelectItem value="P1US">P1 U/S</SelectItem>
                <SelectItem value="STUDENT">Student</SelectItem>
                <SelectItem value="INSTRUCTOR">Instructor</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Crew Selection */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">PIC</Label>
              <Select
                value={formData.picCrewId}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, picCrewId: value }))}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select PIC" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="self">Self</SelectItem>
                  {personnel.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">SIC</Label>
              <Select
                value={formData.sicCrewId}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, sicCrewId: value }))}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select SIC" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="self">Self</SelectItem>
                  {personnel.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Landings */}
          <div className="grid grid-cols-5 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">Day TO</Label>
              <Input
                type="number"
                min={0}
                value={formData.dayTakeoffs}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, dayTakeoffs: Number.parseInt(e.target.value) || 0 }))
                }
                className="h-9"
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
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Night TO</Label>
              <Input
                type="number"
                min={0}
                value={formData.nightTakeoffs}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, nightTakeoffs: Number.parseInt(e.target.value) || 0 }))
                }
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Night Ldg</Label>
              <Input
                type="number"
                min={0}
                value={formData.nightLandings}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, nightLandings: Number.parseInt(e.target.value) || 0 }))
                }
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Auto</Label>
              <Input
                type="number"
                min={0}
                value={formData.autolands}
                onChange={(e) => setFormData((prev) => ({ ...prev, autolands: Number.parseInt(e.target.value) || 0 }))}
                className="h-9"
              />
            </div>
          </div>

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

          {/* Remarks */}
          <div>
            <Label className="text-xs text-muted-foreground">Remarks</Label>
            <Textarea
              value={formData.remarks}
              onChange={(e) => setFormData((prev) => ({ ...prev, remarks: e.target.value }))}
              placeholder="Additional notes..."
              className="h-20 resize-none"
            />
          </div>

          {/* IPC/ICC Toggle */}
          <div className="flex items-center justify-between">
            <Label className="text-sm">IPC/ICC Check</Label>
            <Switch
              checked={formData.ipcIcc}
              onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, ipcIcc: checked }))}
            />
          </div>

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
