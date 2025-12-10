"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { addFlight, type FlightLog } from "@/lib/indexed-db"
import { Plane, Clock, MapPin, Save } from "lucide-react"

interface FlightFormProps {
  onFlightAdded: (flight: FlightLog) => void
  onClose?: () => void
}

export function FlightForm({ onFlightAdded, onClose }: FlightFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split("T")[0],
    aircraftType: "",
    aircraftReg: "",
    departureAirport: "",
    arrivalAirport: "",
    departureTime: "",
    arrivalTime: "",
    totalTime: "",
    picTime: "",
    sicTime: "",
    dualTime: "",
    nightTime: "",
    ifrTime: "",
    landings: "",
    nightLandings: "",
    remarks: "",
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const flight = await addFlight({
        date: formData.date,
        aircraftType: formData.aircraftType,
        aircraftReg: formData.aircraftReg.toUpperCase(),
        departureAirport: formData.departureAirport.toUpperCase(),
        arrivalAirport: formData.arrivalAirport.toUpperCase(),
        departureTime: formData.departureTime,
        arrivalTime: formData.arrivalTime,
        totalTime: Number.parseFloat(formData.totalTime) || 0,
        picTime: Number.parseFloat(formData.picTime) || 0,
        sicTime: Number.parseFloat(formData.sicTime) || 0,
        dualTime: Number.parseFloat(formData.dualTime) || 0,
        nightTime: Number.parseFloat(formData.nightTime) || 0,
        ifrTime: Number.parseFloat(formData.ifrTime) || 0,
        landings: Number.parseInt(formData.landings) || 0,
        nightLandings: Number.parseInt(formData.nightLandings) || 0,
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

  const updateField = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

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
          {/* Date and Aircraft */}
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
              <Label htmlFor="aircraftType">Aircraft Type</Label>
              <Input
                id="aircraftType"
                placeholder="C172"
                value={formData.aircraftType}
                onChange={(e) => updateField("aircraftType", e.target.value)}
                required
                className="bg-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="aircraftReg">Registration</Label>
              <Input
                id="aircraftReg"
                placeholder="N12345"
                value={formData.aircraftReg}
                onChange={(e) => updateField("aircraftReg", e.target.value)}
                required
                className="bg-input uppercase"
              />
            </div>
          </div>

          {/* Route */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="h-4 w-4" />
              <span className="text-sm font-medium">Route</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label htmlFor="departureAirport">From</Label>
                <Input
                  id="departureAirport"
                  placeholder="KJFK"
                  value={formData.departureAirport}
                  onChange={(e) => updateField("departureAirport", e.target.value)}
                  required
                  className="bg-input uppercase"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="arrivalAirport">To</Label>
                <Input
                  id="arrivalAirport"
                  placeholder="KLAX"
                  value={formData.arrivalAirport}
                  onChange={(e) => updateField("arrivalAirport", e.target.value)}
                  required
                  className="bg-input uppercase"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="departureTime">Departure</Label>
                <Input
                  id="departureTime"
                  type="time"
                  value={formData.departureTime}
                  onChange={(e) => updateField("departureTime", e.target.value)}
                  required
                  className="bg-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="arrivalTime">Arrival</Label>
                <Input
                  id="arrivalTime"
                  type="time"
                  value={formData.arrivalTime}
                  onChange={(e) => updateField("arrivalTime", e.target.value)}
                  required
                  className="bg-input"
                />
              </div>
            </div>
          </div>

          {/* Flight Times */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span className="text-sm font-medium">Flight Time (hours)</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="space-y-2">
                <Label htmlFor="totalTime">Total</Label>
                <Input
                  id="totalTime"
                  type="number"
                  step="0.1"
                  placeholder="0.0"
                  value={formData.totalTime}
                  onChange={(e) => updateField("totalTime", e.target.value)}
                  required
                  className="bg-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="picTime">PIC</Label>
                <Input
                  id="picTime"
                  type="number"
                  step="0.1"
                  placeholder="0.0"
                  value={formData.picTime}
                  onChange={(e) => updateField("picTime", e.target.value)}
                  className="bg-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sicTime">SIC</Label>
                <Input
                  id="sicTime"
                  type="number"
                  step="0.1"
                  placeholder="0.0"
                  value={formData.sicTime}
                  onChange={(e) => updateField("sicTime", e.target.value)}
                  className="bg-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dualTime">Dual</Label>
                <Input
                  id="dualTime"
                  type="number"
                  step="0.1"
                  placeholder="0.0"
                  value={formData.dualTime}
                  onChange={(e) => updateField("dualTime", e.target.value)}
                  className="bg-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nightTime">Night</Label>
                <Input
                  id="nightTime"
                  type="number"
                  step="0.1"
                  placeholder="0.0"
                  value={formData.nightTime}
                  onChange={(e) => updateField("nightTime", e.target.value)}
                  className="bg-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ifrTime">IFR</Label>
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
            </div>
          </div>

          {/* Landings */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="landings">Day Landings</Label>
              <Input
                id="landings"
                type="number"
                placeholder="0"
                value={formData.landings}
                onChange={(e) => updateField("landings", e.target.value)}
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
              placeholder="Flight notes, weather conditions, training maneuvers..."
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
