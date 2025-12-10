"use client"

import type React from "react"
import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  addAircraft,
  addAirport,
  addPersonnel,
  updateAircraft,
  updateAirport,
  updatePersonnel,
  deleteAircraft,
  deleteAirport,
  deletePersonnel,
  type Aircraft,
  type Airport,
  type Personnel,
} from "@/lib/indexed-db"
import { useAircraft, useAirports, usePersonnel } from "@/hooks/use-indexed-db"
import { syncService } from "@/lib/sync-service"
import { Plane, MapPin, Users, Plus, Loader2, Trash2, Save } from "lucide-react"
import { cn } from "@/lib/utils"

const SWIPE_THRESHOLD = 80

function SwipeableItem({
  children,
  onTap,
  onDelete,
  isActive,
}: {
  children: React.ReactNode
  onTap: () => void
  onDelete: () => void
  isActive?: boolean
}) {
  const [swipeX, setSwipeX] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)
  const startX = useRef(0)
  const startY = useRef(0)
  const isHorizontalSwipe = useRef<boolean | null>(null)

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    isHorizontalSwipe.current = null
    setIsSwiping(true)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isSwiping) return

    const currentX = e.touches[0].clientX
    const currentY = e.touches[0].clientY
    const diffX = currentX - startX.current
    const diffY = currentY - startY.current

    if (isHorizontalSwipe.current === null && (Math.abs(diffX) > 10 || Math.abs(diffY) > 10)) {
      isHorizontalSwipe.current = Math.abs(diffX) > Math.abs(diffY)
    }

    if (isHorizontalSwipe.current) {
      if (diffX < 0) {
        // Swiping left - reveal delete
        setSwipeX(Math.max(diffX, -(SWIPE_THRESHOLD + 20)))
      } else if (swipeX < 0) {
        // Swiping right while delete is shown - hide delete
        setSwipeX(Math.min(0, swipeX + diffX))
      }
    }
  }

  const handleTouchEnd = () => {
    setIsSwiping(false)
    if (swipeX < -SWIPE_THRESHOLD / 2) {
      setSwipeX(-SWIPE_THRESHOLD)
    } else {
      setSwipeX(0)
    }
  }

  const handleClick = () => {
    if (swipeX < 0) {
      setSwipeX(0)
    } else {
      onTap()
    }
  }

  return (
    <div className="relative overflow-hidden rounded">
      {/* Delete button on right */}
      <div
        className={cn(
          "absolute inset-y-0 right-0 flex items-center justify-center bg-destructive transition-opacity",
          swipeX < 0 ? "opacity-100" : "opacity-0",
        )}
        style={{ width: SWIPE_THRESHOLD }}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-full w-full rounded-none text-destructive-foreground"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 className="h-5 w-5" />
        </Button>
      </div>

      {/* Swipeable content */}
      <div
        className={cn(
          "p-2 cursor-pointer bg-secondary",
          !isSwiping && "transition-transform duration-200",
          isActive && "border-l-2 border-primary",
        )}
        style={{ transform: `translateX(${swipeX}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleClick}
      >
        {children}
      </div>
    </div>
  )
}

export function ManageData() {
  const { aircraft, isLoading: aircraftLoading, refresh: refreshAircraft } = useAircraft()
  const { airports, isLoading: airportsLoading, refresh: refreshAirports } = useAirports()
  const { personnel, isLoading: personnelLoading, refresh: refreshPersonnel } = usePersonnel()

  const [isSubmitting, setIsSubmitting] = useState(false)

  const [editingAircraftId, setEditingAircraftId] = useState<string | null>(null)
  const [editingAirportId, setEditingAirportId] = useState<string | null>(null)
  const [editingPersonnelId, setEditingPersonnelId] = useState<string | null>(null)

  // Delete states
  const [deleteAircraftTarget, setDeleteAircraftTarget] = useState<Aircraft | null>(null)
  const [deleteAirportTarget, setDeleteAirportTarget] = useState<Airport | null>(null)
  const [deletePersonnelTarget, setDeletePersonnelTarget] = useState<Personnel | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

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

  const handleEditAircraft = (a: Aircraft) => {
    setEditingAircraftId(a.id)
    setAircraftForm({
      registration: a.registration,
      type: a.type,
      typeDesignator: a.typeDesignator || "",
      model: a.model || "",
      category: a.category || "MEL",
      engineType: a.engineType,
      isComplex: a.isComplex ?? true,
      isHighPerformance: a.isHighPerformance ?? true,
    })
  }

  const handleEditAirport = (a: Airport) => {
    setEditingAirportId(a.id)
    setAirportForm({
      icao: a.icao,
      iata: a.iata || "",
      name: a.name,
      city: a.city || "",
      country: a.country || "",
      latitude: a.latitude?.toString() || "",
      longitude: a.longitude?.toString() || "",
      elevation: a.elevation?.toString() || "",
      timezone: a.timezone || "",
      utcOffset: a.utcOffset?.toString() || "",
      dstObserved: a.dstObserved ?? false,
    })
  }

  const handleEditPersonnel = (p: Personnel) => {
    setEditingPersonnelId(p.id)
    setPersonnelForm({
      firstName: p.firstName,
      lastName: p.lastName,
      employeeId: p.employeeId || "",
      licenseNumber: p.licenseNumber || "",
      role: p.role,
      company: p.company || "",
      email: p.email || "",
      notes: p.notes || "",
    })
  }

  const cancelAircraftEdit = () => {
    setEditingAircraftId(null)
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
  }

  const cancelAirportEdit = () => {
    setEditingAirportId(null)
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
  }

  const cancelPersonnelEdit = () => {
    setEditingPersonnelId(null)
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
  }

  const handleSaveAircraft = async () => {
    if (!aircraftForm.registration || !aircraftForm.type) return
    setIsSubmitting(true)
    try {
      const data = {
        registration: aircraftForm.registration.toUpperCase(),
        type: aircraftForm.type.toUpperCase(),
        typeDesignator: aircraftForm.typeDesignator.toUpperCase(),
        model: aircraftForm.model,
        category: aircraftForm.category,
        engineType: aircraftForm.engineType,
        isComplex: aircraftForm.isComplex,
        isHighPerformance: aircraftForm.isHighPerformance,
      }

      if (editingAircraftId) {
        await updateAircraft(editingAircraftId, data)
      } else {
        await addAircraft(data)
      }
      cancelAircraftEdit()
      await refreshAircraft()
      if (navigator.onLine) syncService.fullSync()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteAircraft = async () => {
    if (!deleteAircraftTarget) return
    setIsDeleting(true)
    try {
      await deleteAircraft(deleteAircraftTarget.id)
      setDeleteAircraftTarget(null)
      await refreshAircraft()
      if (navigator.onLine) syncService.fullSync()
    } finally {
      setIsDeleting(false)
    }
  }

  const handleSaveAirport = async () => {
    if (!airportForm.icao || !airportForm.name) return
    setIsSubmitting(true)
    try {
      const data = {
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
      }

      if (editingAirportId) {
        await updateAirport(editingAirportId, data)
      } else {
        await addAirport(data)
      }
      cancelAirportEdit()
      await refreshAirports()
      if (navigator.onLine) syncService.fullSync()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteAirport = async () => {
    if (!deleteAirportTarget) return
    setIsDeleting(true)
    try {
      await deleteAirport(deleteAirportTarget.id)
      setDeleteAirportTarget(null)
      await refreshAirports()
      if (navigator.onLine) syncService.fullSync()
    } finally {
      setIsDeleting(false)
    }
  }

  const handleSavePersonnel = async () => {
    if (!personnelForm.firstName || !personnelForm.lastName) return
    setIsSubmitting(true)
    try {
      const data = {
        firstName: personnelForm.firstName,
        lastName: personnelForm.lastName,
        employeeId: personnelForm.employeeId,
        licenseNumber: personnelForm.licenseNumber,
        role: personnelForm.role,
        company: personnelForm.company,
        email: personnelForm.email,
        notes: personnelForm.notes,
      }

      if (editingPersonnelId) {
        await updatePersonnel(editingPersonnelId, data)
      } else {
        await addPersonnel(data)
      }
      cancelPersonnelEdit()
      await refreshPersonnel()
      if (navigator.onLine) syncService.fullSync()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeletePersonnel = async () => {
    if (!deletePersonnelTarget) return
    setIsDeleting(true)
    try {
      await deletePersonnel(deletePersonnelTarget.id)
      setDeletePersonnelTarget(null)
      await refreshPersonnel()
      if (navigator.onLine) syncService.fullSync()
    } finally {
      setIsDeleting(false)
    }
  }

  const ListSkeleton = () => (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded" />
      ))}
    </div>
  )

  return (
    <>
      <Card className="bg-card border-border">
        <CardHeader className="pb-4">
          <CardTitle className="text-foreground">Manage Data</CardTitle>
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
              <div className="flex gap-2">
                <Button onClick={handleSaveAircraft} disabled={isSubmitting} size="sm">
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : editingAircraftId ? (
                    <Save className="h-4 w-4 mr-1" />
                  ) : (
                    <Plus className="h-4 w-4 mr-1" />
                  )}
                  {editingAircraftId ? "Save" : "Add Aircraft"}
                </Button>
                {editingAircraftId && (
                  <Button variant="outline" size="sm" onClick={cancelAircraftEdit}>
                    Cancel
                  </Button>
                )}
              </div>

              <ScrollArea className="h-[200px] border rounded-md p-2">
                {aircraftLoading ? (
                  <ListSkeleton />
                ) : (
                  <div className="space-y-2">
                    {aircraft.map((a) => (
                      <SwipeableItem
                        key={a.id}
                        onTap={() => handleEditAircraft(a)}
                        onDelete={() => setDeleteAircraftTarget(a)}
                        isActive={editingAircraftId === a.id}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-medium">{a.registration}</span>
                            <span className="text-muted-foreground ml-2">
                              {a.type} - {a.model}
                            </span>
                          </div>
                          <Badge variant="outline">{a.engineType}</Badge>
                        </div>
                      </SwipeableItem>
                    ))}
                    {aircraft.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">No aircraft added</p>
                    )}
                  </div>
                )}
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
                  <Label htmlFor="apLng" className="text-xs">
                    Longitude
                  </Label>
                  <Input
                    id="apLng"
                    type="number"
                    step="0.0001"
                    placeholder="103.9915"
                    value={airportForm.longitude}
                    onChange={(e) => setAirportForm({ ...airportForm, longitude: e.target.value })}
                    className="bg-input"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="apTimezone" className="text-xs">
                    Timezone
                  </Label>
                  <Input
                    id="apTimezone"
                    placeholder="Asia/Singapore"
                    value={airportForm.timezone}
                    onChange={(e) => setAirportForm({ ...airportForm, timezone: e.target.value })}
                    className="bg-input"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="apUtcOffset" className="text-xs">
                    UTC Offset
                  </Label>
                  <Input
                    id="apUtcOffset"
                    type="number"
                    step="0.5"
                    placeholder="8"
                    value={airportForm.utcOffset}
                    onChange={(e) => setAirportForm({ ...airportForm, utcOffset: e.target.value })}
                    className="bg-input"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSaveAirport} disabled={isSubmitting} size="sm">
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : editingAirportId ? (
                    <Save className="h-4 w-4 mr-1" />
                  ) : (
                    <Plus className="h-4 w-4 mr-1" />
                  )}
                  {editingAirportId ? "Save" : "Add Airport"}
                </Button>
                {editingAirportId && (
                  <Button variant="outline" size="sm" onClick={cancelAirportEdit}>
                    Cancel
                  </Button>
                )}
              </div>

              <ScrollArea className="h-[200px] border rounded-md p-2">
                {airportsLoading ? (
                  <ListSkeleton />
                ) : (
                  <div className="space-y-2">
                    {airports.map((a) => (
                      <SwipeableItem
                        key={a.id}
                        onTap={() => handleEditAirport(a)}
                        onDelete={() => setDeleteAirportTarget(a)}
                        isActive={editingAirportId === a.id}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-medium">{a.icao}</span>
                            <span className="text-muted-foreground ml-2">{a.name}</span>
                          </div>
                          <Badge variant="outline">{a.iata}</Badge>
                        </div>
                      </SwipeableItem>
                    ))}
                    {airports.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">No airports added</p>
                    )}
                  </div>
                )}
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
                  <Label htmlFor="pEmployeeId" className="text-xs">
                    Employee ID
                  </Label>
                  <Input
                    id="pEmployeeId"
                    placeholder="EMP123"
                    value={personnelForm.employeeId}
                    onChange={(e) => setPersonnelForm({ ...personnelForm, employeeId: e.target.value })}
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
                  <Label htmlFor="pLicense" className="text-xs">
                    License Number
                  </Label>
                  <Input
                    id="pLicense"
                    placeholder="ATP12345"
                    value={personnelForm.licenseNumber}
                    onChange={(e) => setPersonnelForm({ ...personnelForm, licenseNumber: e.target.value })}
                    className="bg-input"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pCompany" className="text-xs">
                    Company
                  </Label>
                  <Input
                    id="pCompany"
                    placeholder="Singapore Airlines"
                    value={personnelForm.company}
                    onChange={(e) => setPersonnelForm({ ...personnelForm, company: e.target.value })}
                    className="bg-input"
                  />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label htmlFor="pEmail" className="text-xs">
                    Email
                  </Label>
                  <Input
                    id="pEmail"
                    type="email"
                    placeholder="john.doe@airline.com"
                    value={personnelForm.email}
                    onChange={(e) => setPersonnelForm({ ...personnelForm, email: e.target.value })}
                    className="bg-input"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSavePersonnel} disabled={isSubmitting} size="sm">
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : editingPersonnelId ? (
                    <Save className="h-4 w-4 mr-1" />
                  ) : (
                    <Plus className="h-4 w-4 mr-1" />
                  )}
                  {editingPersonnelId ? "Save" : "Add Personnel"}
                </Button>
                {editingPersonnelId && (
                  <Button variant="outline" size="sm" onClick={cancelPersonnelEdit}>
                    Cancel
                  </Button>
                )}
              </div>

              <ScrollArea className="h-[200px] border rounded-md p-2">
                {personnelLoading ? (
                  <ListSkeleton />
                ) : (
                  <div className="space-y-2">
                    {personnel.map((p) => (
                      <SwipeableItem
                        key={p.id}
                        onTap={() => handleEditPersonnel(p)}
                        onDelete={() => setDeletePersonnelTarget(p)}
                        isActive={editingPersonnelId === p.id}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-medium">
                              {p.firstName} {p.lastName}
                            </span>
                            {p.company && <span className="text-muted-foreground ml-2">{p.company}</span>}
                          </div>
                          <Badge variant="outline">{p.role}</Badge>
                        </div>
                      </SwipeableItem>
                    ))}
                    {personnel.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">No personnel added</p>
                    )}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Delete Dialogs */}
      <AlertDialog open={!!deleteAircraftTarget} onOpenChange={() => setDeleteAircraftTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Aircraft</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deleteAircraftTarget?.registration}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAircraft}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteAirportTarget} onOpenChange={() => setDeleteAirportTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Airport</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deleteAirportTarget?.icao} - {deleteAirportTarget?.name}? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAirport}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deletePersonnelTarget} onOpenChange={() => setDeletePersonnelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Personnel</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deletePersonnelTarget?.firstName} {deletePersonnelTarget?.lastName}? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeletePersonnel}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
