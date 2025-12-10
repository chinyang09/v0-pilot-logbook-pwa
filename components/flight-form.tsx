"use client"

import type React from "react"

import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import {
  addFlight,
  type FlightLog,
  type Aircraft,
  type Airport,
  type Personnel,
  getAllAircraft,
  getAllAirports,
  getAllPersonnel,
} from "@/lib/indexed-db"
import { calculateTimesFromOOOI, calculateNightTime } from "@/lib/night-time-calculator"
import { Plane, Clock, MapPin, Save, Users, Timer, Moon, X } from "lucide-react"

interface FlightFormProps {
  onFlightAdded: (flight: FlightLog) => void
  onClose?: () => void
}

export function FlightForm({ onFlightAdded, onClose }: FlightFormProps) {
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
    // OOOI Times
    outTime: "",
    offTime: "",
    onTime: "",
    inTime: "",
    // Role and crew
    pilotRole: "FO" as "PIC" | "FO" | "STUDENT" | "INSTRUCTOR",
    crewIds: [] as string[],
    // Conditions
    ifrTime: "",
    actualInstrumentTime: "",
    simulatedInstrumentTime: "",
    // Landings
    dayLandings: "1",
    nightLandings: "0",
    // Remarks
    remarks: "",
  })

  // Calculated values
  const [calculatedTimes, setCalculatedTimes] = useState({
    blockTime: 0,
    flightTime: 0,
    nightTime: 0,
    p1Time: 0,
    p2Time: 0,
    p1usTime: 0,
    dualTime: 0,
    instructorTime: 0,
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

  // Get selected aircraft details
  const selectedAircraft = useMemo(() => {
    return aircraft.find((a) => a.id === formData.aircraftId)
  }, [aircraft, formData.aircraftId])

  // Get departure and arrival airports
  const departureAirport = useMemo(() => {
    return airports.find((a) => a.icao === formData.departureIcao.toUpperCase())
  }, [airports, formData.departureIcao])

  const arrivalAirport = useMemo(() => {
    return airports.find((a) => a.icao === formData.arrivalIcao.toUpperCase())
  }, [airports, formData.arrivalIcao])

  // Calculate times when OOOI changes
  useEffect(() => {
    if (formData.outTime && formData.offTime && formData.onTime && formData.inTime) {
      const { blockTime, flightTime } = calculateTimesFromOOOI(
        formData.outTime,
        formData.offTime,
        formData.onTime,
        formData.inTime,
        formData.date,
      )

      // Calculate night time if we have airport coordinates
      let nightTime = 0
      if (departureAirport && arrivalAirport) {
        const offDateTime = new Date(`${formData.date}T${formData.offTime}:00Z`)
        const onDateTime = new Date(`${formData.date}T${formData.onTime}:00Z`)
        // Handle overnight
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

      // Calculate hours based on role
      let p1Time = 0,
        p2Time = 0,
        p1usTime = 0,
        dualTime = 0,
        instructorTime = 0

      switch (formData.pilotRole) {
        case "PIC":
          p1Time = flightTime
          break
        case "FO":
          p2Time = flightTime
          break
        case "STUDENT":
          dualTime = flightTime
          break
        case "INSTRUCTOR":
          instructorTime = flightTime
          p1Time = flightTime // Instructor also logs P1
          break
      }

      setCalculatedTimes({
        blockTime,
        flightTime,
        nightTime,
        p1Time,
        p2Time,
        p1usTime,
        dualTime,
        instructorTime,
      })
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
  ])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const flight = await addFlight({
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
        ifrTime: Number.parseFloat(formData.ifrTime) || 0,
        actualInstrumentTime: Number.parseFloat(formData.actualInstrumentTime) || 0,
        simulatedInstrumentTime: Number.parseFloat(formData.simulatedInstrumentTime) || 0,
        dayLandings: Number.parseInt(formData.dayLandings) || 0,
        nightLandings: Number.parseInt(formData.nightLandings) || 0,
        pilotRole: formData.pilotRole,
        crewIds: formData.crewIds,
        remarks: formData.remarks,
      })

      onFlightAdded(flight)
      onClose?.()
    } catch (error) {
      console.error("Failed to add flight:", error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const updateField = (field: string, value: string | string[]) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const toggleCrewMember = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      crewIds: prev.crewIds.includes(id) ? prev.crewIds.filter((c) => c !== id) : [...prev.crewIds, id],
    }))
  }

  const formatHours = (hours: number) => hours.toFixed(1)

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Plane className="h-5 w-5 text-primary" />
          Log New Flight
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Date, Flight Number, and Aircraft */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={formData.date}
                onChange={(e) => updateField("date", e.target.value)}
                required
                className="bg-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="flightNumber">Flight Number</Label>
              <Input
                id="flightNumber"
                placeholder="SQ123"
                value={formData.flightNumber}
                onChange={(e) => updateField("flightNumber", e.target.value)}
                className="bg-input uppercase"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="aircraft">Aircraft</Label>
              <Select value={formData.aircraftId} onValueChange={(v) => updateField("aircraftId", v)}>
                <SelectTrigger className="bg-input">
                  <SelectValue placeholder="Select aircraft" />
                </SelectTrigger>
                <SelectContent>
                  {aircraft.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.registration} ({a.type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Route */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="h-4 w-4" />
              <span className="text-sm font-medium">Route</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="departureIcao">Departure (ICAO)</Label>
                <Input
                  id="departureIcao"
                  placeholder="WSSS"
                  value={formData.departureIcao}
                  onChange={(e) => updateField("departureIcao", e.target.value)}
                  required
                  className="bg-input uppercase"
                  list="departure-airports"
                />
                <datalist id="departure-airports">
                  {airports.map((a) => (
                    <option key={a.id} value={a.icao}>
                      {a.name} ({a.iata})
                    </option>
                  ))}
                </datalist>
                {departureAirport && <p className="text-xs text-muted-foreground">{departureAirport.name}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="arrivalIcao">Arrival (ICAO)</Label>
                <Input
                  id="arrivalIcao"
                  placeholder="VHHH"
                  value={formData.arrivalIcao}
                  onChange={(e) => updateField("arrivalIcao", e.target.value)}
                  required
                  className="bg-input uppercase"
                  list="arrival-airports"
                />
                <datalist id="arrival-airports">
                  {airports.map((a) => (
                    <option key={a.id} value={a.icao}>
                      {a.name} ({a.iata})
                    </option>
                  ))}
                </datalist>
                {arrivalAirport && <p className="text-xs text-muted-foreground">{arrivalAirport.name}</p>}
              </div>
            </div>
          </div>

          {/* OOOI Times */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Timer className="h-4 w-4" />
              <span className="text-sm font-medium">OOOI Times (UTC)</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label htmlFor="outTime">OUT (Block Off)</Label>
                <Input
                  id="outTime"
                  type="time"
                  value={formData.outTime}
                  onChange={(e) => updateField("outTime", e.target.value)}
                  required
                  className="bg-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="offTime">OFF (Takeoff)</Label>
                <Input
                  id="offTime"
                  type="time"
                  value={formData.offTime}
                  onChange={(e) => updateField("offTime", e.target.value)}
                  required
                  className="bg-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="onTime">ON (Landing)</Label>
                <Input
                  id="onTime"
                  type="time"
                  value={formData.onTime}
                  onChange={(e) => updateField("onTime", e.target.value)}
                  required
                  className="bg-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inTime">IN (Block On)</Label>
                <Input
                  id="inTime"
                  type="time"
                  value={formData.inTime}
                  onChange={(e) => updateField("inTime", e.target.value)}
                  required
                  className="bg-input"
                />
              </div>
            </div>
          </div>

          {/* Calculated Times Display */}
          {calculatedTimes.blockTime > 0 && (
            <div className="bg-secondary/50 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 text-foreground">
                <Clock className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Calculated Times</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Block Time</p>
                  <p className="text-lg font-semibold">{formatHours(calculatedTimes.blockTime)}h</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Flight Time</p>
                  <p className="text-lg font-semibold">{formatHours(calculatedTimes.flightTime)}h</p>
                </div>
                <div className="flex items-start gap-2">
                  <div>
                    <p className="text-muted-foreground flex items-center gap-1">
                      <Moon className="h-3 w-3" /> Night Time
                    </p>
                    <p className="text-lg font-semibold">{formatHours(calculatedTimes.nightTime)}h</p>
                  </div>
                  {!departureAirport || !arrivalAirport ? (
                    <Badge variant="outline" className="text-xs">
                      Add airports to DB
                    </Badge>
                  ) : null}
                </div>
                <div>
                  <p className="text-muted-foreground">
                    {formData.pilotRole === "PIC" && "P1 Time"}
                    {formData.pilotRole === "FO" && "P2 Time"}
                    {formData.pilotRole === "STUDENT" && "Dual Time"}
                    {formData.pilotRole === "INSTRUCTOR" && "Instructor Time"}
                  </p>
                  <p className="text-lg font-semibold">{formatHours(calculatedTimes.flightTime)}h</p>
                </div>
              </div>
            </div>
          )}

          {/* Pilot Role */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Users className="h-4 w-4" />
              <span className="text-sm font-medium">Your Role</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {(["PIC", "FO", "STUDENT", "INSTRUCTOR"] as const).map((role) => (
                <Button
                  key={role}
                  type="button"
                  variant={formData.pilotRole === role ? "default" : "outline"}
                  onClick={() => updateField("pilotRole", role)}
                  className="w-full"
                >
                  {role === "PIC" && "Captain (P1)"}
                  {role === "FO" && "First Officer (P2)"}
                  {role === "STUDENT" && "Student (Dual)"}
                  {role === "INSTRUCTOR" && "Instructor"}
                </Button>
              ))}
            </div>
          </div>

          {/* Crew Selection */}
          <div className="space-y-3">
            <Label>Crew Members</Label>
            <div className="flex flex-wrap gap-2">
              {personnel.map((person) => (
                <Badge
                  key={person.id}
                  variant={formData.crewIds.includes(person.id) ? "default" : "outline"}
                  className="cursor-pointer px-3 py-1.5"
                  onClick={() => toggleCrewMember(person.id)}
                >
                  {person.firstName} {person.lastName}
                  {person.role === "CAPT" && " (CAPT)"}
                  {person.role === "FO" && " (FO)"}
                  {formData.crewIds.includes(person.id) && <X className="h-3 w-3 ml-1" />}
                </Badge>
              ))}
              {personnel.length === 0 && <p className="text-sm text-muted-foreground">No crew members added yet</p>}
            </div>
          </div>

          {/* Conditions and Landings */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ifrTime">IFR Time</Label>
              <Input
                id="ifrTime"
                type="number"
                step="0.1"
                placeholder="0.0"
                value={formData.ifrTime}
                onChange={(e) => updateField("ifrTime", e.target.value)}
                className="bg-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="actualInstrumentTime">Actual IMC</Label>
              <Input
                id="actualInstrumentTime"
                type="number"
                step="0.1"
                placeholder="0.0"
                value={formData.actualInstrumentTime}
                onChange={(e) => updateField("actualInstrumentTime", e.target.value)}
                className="bg-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dayLandings">Day Landings</Label>
              <Input
                id="dayLandings"
                type="number"
                placeholder="1"
                value={formData.dayLandings}
                onChange={(e) => updateField("dayLandings", e.target.value)}
                className="bg-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nightLandings">Night Landings</Label>
              <Input
                id="nightLandings"
                type="number"
                placeholder="0"
                value={formData.nightLandings}
                onChange={(e) => updateField("nightLandings", e.target.value)}
                className="bg-input"
              />
            </div>
          </div>

          {/* Remarks */}
          <div className="space-y-2">
            <Label htmlFor="remarks">Remarks</Label>
            <Textarea
              id="remarks"
              placeholder="Flight notes, delays, weather conditions..."
              value={formData.remarks}
              onChange={(e) => updateField("remarks", e.target.value)}
              className="bg-input min-h-[80px]"
            />
          </div>

          {/* Submit */}
          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={isSubmitting} className="flex-1">
              <Save className="h-4 w-4 mr-2" />
              {isSubmitting ? "Saving..." : "Save Flight"}
            </Button>
            {onClose && (
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
