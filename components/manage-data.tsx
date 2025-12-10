"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  addAircraft,
  addAirport,
  addPersonnel,
  getAllAircraft,
  getAllAirports,
  getAllPersonnel,
  type Aircraft,
  type Airport,
  type Personnel,
} from "@/lib/indexed-db"
import { Plane, MapPin, Users, Plus, X } from "lucide-react"

interface ManageDataProps {
  onClose?: () => void
}

export function ManageData({ onClose }: ManageDataProps) {
  const [aircraft, setAircraft] = useState<Aircraft[]>([])
  const [airports, setAirports] = useState<Airport[]>([])
  const [personnel, setPersonnel] = useState<Personnel[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Aircraft form
  const [aircraftForm, setAircraftForm] = useState({
    registration: "",
    type: "",
    typeDesignator: "",
    model: "",
    category: "MEL",
    engineType: "JET" as Aircraft["engineType"],
    isComplex: true,
    isHighPerformance: true,
  })

  // Airport form
  const [airportForm, setAirportForm] = useState({
    icao: "",
    iata: "",
    name: "",
    city: "",
    country: "",
    latitude: "",
    longitude: "",
    elevation: "",
    timezone: "",
    utcOffset: "",
    dstObserved: false,
  })

  // Personnel form
  const [personnelForm, setPersonnelForm] = useState({
    firstName: "",
    lastName: "",
    employeeId: "",
    licenseNumber: "",
    role: "FO" as Personnel["role"],
    company: "",
    email: "",
    notes: "",
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    const [a, ap, p] = await Promise.all([getAllAircraft(), getAllAirports(), getAllPersonnel()])
    setAircraft(a)
    setAirports(ap)
    setPersonnel(p)
  }

  const handleAddAircraft = async () => {
    if (!aircraftForm.registration || !aircraftForm.type) return
    setIsSubmitting(true)
    try {
      await addAircraft({
        registration: aircraftForm.registration.toUpperCase(),
        type: aircraftForm.type.toUpperCase(),
        typeDesignator: aircraftForm.typeDesignator.toUpperCase(),
        model: aircraftForm.model,
        category: aircraftForm.category,
        engineType: aircraftForm.engineType,
        isComplex: aircraftForm.isComplex,
        isHighPerformance: aircraftForm.isHighPerformance,
      })
      setAircraftForm({
        registration: "",
        type: "",
        typeDesignator: "",
        model: "",
        category: "MEL",
        engineType: "JET",
        isComplex: true,
        isHighPerformance: true,
      })
      loadData()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleAddAirport = async () => {
    if (!airportForm.icao || !airportForm.name) return
    setIsSubmitting(true)
    try {
      await addAirport({
        icao: airportForm.icao.toUpperCase(),
        iata: airportForm.iata.toUpperCase(),
        name: airportForm.name,
        city: airportForm.city,
        country: airportForm.country,
        latitude: Number.parseFloat(airportForm.latitude) || 0,
        longitude: Number.parseFloat(airportForm.longitude) || 0,
        elevation: Number.parseFloat(airportForm.elevation) || 0,
        timezone: airportForm.timezone,
        utcOffset: Number.parseFloat(airportForm.utcOffset) || 0,
        dstObserved: airportForm.dstObserved,
      })
      setAirportForm({
        icao: "",
        iata: "",
        name: "",
        city: "",
        country: "",
        latitude: "",
        longitude: "",
        elevation: "",
        timezone: "",
        utcOffset: "",
        dstObserved: false,
      })
      loadData()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleAddPersonnel = async () => {
    if (!personnelForm.firstName || !personnelForm.lastName) return
    setIsSubmitting(true)
    try {
      await addPersonnel({
        firstName: personnelForm.firstName,
        lastName: personnelForm.lastName,
        employeeId: personnelForm.employeeId,
        licenseNumber: personnelForm.licenseNumber,
        role: personnelForm.role,
        company: personnelForm.company,
        email: personnelForm.email,
        notes: personnelForm.notes,
      })
      setPersonnelForm({
        firstName: "",
        lastName: "",
        employeeId: "",
        licenseNumber: "",
        role: "FO",
        company: "",
        email: "",
        notes: "",
      })
      loadData()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-4 flex flex-row items-center justify-between">
        <CardTitle className="text-foreground">Manage Data</CardTitle>
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="aircraft" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-4">
            <TabsTrigger value="aircraft" className="flex items-center gap-1">
              <Plane className="h-4 w-4" />
              Aircraft
            </TabsTrigger>
            <TabsTrigger value="airports" className="flex items-center gap-1">
              <MapPin className="h-4 w-4" />
              Airports
            </TabsTrigger>
            <TabsTrigger value="personnel" className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              Personnel
            </TabsTrigger>
          </TabsList>

          {/* Aircraft Tab */}
          <TabsContent value="aircraft" className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label htmlFor="acReg" className="text-xs">
                  Registration
                </Label>
                <Input
                  id="acReg"
                  placeholder="9V-SMA"
                  value={aircraftForm.registration}
                  onChange={(e) => setAircraftForm({ ...aircraftForm, registration: e.target.value })}
                  className="bg-input uppercase"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="acType" className="text-xs">
                  Type
                </Label>
                <Input
                  id="acType"
                  placeholder="A350"
                  value={aircraftForm.type}
                  onChange={(e) => setAircraftForm({ ...aircraftForm, type: e.target.value })}
                  className="bg-input uppercase"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="acModel" className="text-xs">
                  Model
                </Label>
                <Input
                  id="acModel"
                  placeholder="A350-941"
                  value={aircraftForm.model}
                  onChange={(e) => setAircraftForm({ ...aircraftForm, model: e.target.value })}
                  className="bg-input"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Engine Type</Label>
                <Select
                  value={aircraftForm.engineType}
                  onValueChange={(v) => setAircraftForm({ ...aircraftForm, engineType: v as Aircraft["engineType"] })}
                >
                  <SelectTrigger className="bg-input">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SEP">SEP</SelectItem>
                    <SelectItem value="MEP">MEP</SelectItem>
                    <SelectItem value="SET">SET</SelectItem>
                    <SelectItem value="MET">MET</SelectItem>
                    <SelectItem value="JET">JET</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={handleAddAircraft} disabled={isSubmitting} size="sm">
              <Plus className="h-4 w-4 mr-1" /> Add Aircraft
            </Button>

            <ScrollArea className="h-[200px] border rounded-md p-2">
              <div className="space-y-2">
                {aircraft.map((a) => (
                  <div key={a.id} className="flex items-center justify-between p-2 bg-secondary rounded">
                    <div>
                      <span className="font-medium">{a.registration}</span>
                      <span className="text-muted-foreground ml-2">
                        {a.type} - {a.model}
                      </span>
                    </div>
                    <Badge variant="outline">{a.engineType}</Badge>
                  </div>
                ))}
                {aircraft.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No aircraft added</p>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Airports Tab */}
          <TabsContent value="airports" className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label htmlFor="apIcao" className="text-xs">
                  ICAO
                </Label>
                <Input
                  id="apIcao"
                  placeholder="WSSS"
                  value={airportForm.icao}
                  onChange={(e) => setAirportForm({ ...airportForm, icao: e.target.value })}
                  className="bg-input uppercase"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="apIata" className="text-xs">
                  IATA
                </Label>
                <Input
                  id="apIata"
                  placeholder="SIN"
                  value={airportForm.iata}
                  onChange={(e) => setAirportForm({ ...airportForm, iata: e.target.value })}
                  className="bg-input uppercase"
                />
              </div>
              <div className="space-y-1 col-span-2">
                <Label htmlFor="apName" className="text-xs">
                  Name
                </Label>
                <Input
                  id="apName"
                  placeholder="Singapore Changi Airport"
                  value={airportForm.name}
                  onChange={(e) => setAirportForm({ ...airportForm, name: e.target.value })}
                  className="bg-input"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="apCity" className="text-xs">
                  City
                </Label>
                <Input
                  id="apCity"
                  placeholder="Singapore"
                  value={airportForm.city}
                  onChange={(e) => setAirportForm({ ...airportForm, city: e.target.value })}
                  className="bg-input"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="apCountry" className="text-xs">
                  Country
                </Label>
                <Input
                  id="apCountry"
                  placeholder="Singapore"
                  value={airportForm.country}
                  onChange={(e) => setAirportForm({ ...airportForm, country: e.target.value })}
                  className="bg-input"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="apLat" className="text-xs">
                  Latitude
                </Label>
                <Input
                  id="apLat"
                  type="number"
                  step="0.0001"
                  placeholder="1.3644"
                  value={airportForm.latitude}
                  onChange={(e) => setAirportForm({ ...airportForm, latitude: e.target.value })}
                  className="bg-input"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="apLon" className="text-xs">
                  Longitude
                </Label>
                <Input
                  id="apLon"
                  type="number"
                  step="0.0001"
                  placeholder="103.9915"
                  value={airportForm.longitude}
                  onChange={(e) => setAirportForm({ ...airportForm, longitude: e.target.value })}
                  className="bg-input"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="apTz" className="text-xs">
                  Timezone
                </Label>
                <Input
                  id="apTz"
                  placeholder="Asia/Singapore"
                  value={airportForm.timezone}
                  onChange={(e) => setAirportForm({ ...airportForm, timezone: e.target.value })}
                  className="bg-input"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="apUtc" className="text-xs">
                  UTC Offset
                </Label>
                <Input
                  id="apUtc"
                  type="number"
                  step="0.5"
                  placeholder="8"
                  value={airportForm.utcOffset}
                  onChange={(e) => setAirportForm({ ...airportForm, utcOffset: e.target.value })}
                  className="bg-input"
                />
              </div>
            </div>
            <Button onClick={handleAddAirport} disabled={isSubmitting} size="sm">
              <Plus className="h-4 w-4 mr-1" /> Add Airport
            </Button>

            <ScrollArea className="h-[200px] border rounded-md p-2">
              <div className="space-y-2">
                {airports.map((a) => (
                  <div key={a.id} className="flex items-center justify-between p-2 bg-secondary rounded">
                    <div>
                      <span className="font-medium">{a.icao}</span>
                      <span className="text-muted-foreground ml-2">{a.name}</span>
                    </div>
                    <Badge variant="outline">{a.iata}</Badge>
                  </div>
                ))}
                {airports.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No airports added</p>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Personnel Tab */}
          <TabsContent value="personnel" className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label htmlFor="pFirstName" className="text-xs">
                  First Name
                </Label>
                <Input
                  id="pFirstName"
                  placeholder="John"
                  value={personnelForm.firstName}
                  onChange={(e) => setPersonnelForm({ ...personnelForm, firstName: e.target.value })}
                  className="bg-input"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pLastName" className="text-xs">
                  Last Name
                </Label>
                <Input
                  id="pLastName"
                  placeholder="Doe"
                  value={personnelForm.lastName}
                  onChange={(e) => setPersonnelForm({ ...personnelForm, lastName: e.target.value })}
                  className="bg-input"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Role</Label>
                <Select
                  value={personnelForm.role}
                  onValueChange={(v) => setPersonnelForm({ ...personnelForm, role: v as Personnel["role"] })}
                >
                  <SelectTrigger className="bg-input">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CAPT">Captain</SelectItem>
                    <SelectItem value="FO">First Officer</SelectItem>
                    <SelectItem value="INSTRUCTOR">Instructor</SelectItem>
                    <SelectItem value="STUDENT">Student</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="pEmpId" className="text-xs">
                  Employee ID
                </Label>
                <Input
                  id="pEmpId"
                  placeholder="12345"
                  value={personnelForm.employeeId}
                  onChange={(e) => setPersonnelForm({ ...personnelForm, employeeId: e.target.value })}
                  className="bg-input"
                />
              </div>
            </div>
            <Button onClick={handleAddPersonnel} disabled={isSubmitting} size="sm">
              <Plus className="h-4 w-4 mr-1" /> Add Personnel
            </Button>

            <ScrollArea className="h-[200px] border rounded-md p-2">
              <div className="space-y-2">
                {personnel.map((p) => (
                  <div key={p.id} className="flex items-center justify-between p-2 bg-secondary rounded">
                    <div>
                      <span className="font-medium">
                        {p.firstName} {p.lastName}
                      </span>
                      {p.employeeId && <span className="text-muted-foreground ml-2">#{p.employeeId}</span>}
                    </div>
                    <Badge variant="outline">{p.role}</Badge>
                  </div>
                ))}
                {personnel.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No personnel added</p>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
