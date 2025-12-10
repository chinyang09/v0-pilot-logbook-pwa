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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
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
import { Plane, MapPin, Users, Plus, X, Loader2, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface ManageDataProps {
  onClose?: () => void
}

const SWIPE_THRESHOLD = 80

function SwipeableItem({
  children,
  onTap,
  onDelete,
}: {
  children: React.ReactNode
  onTap: () => void
  onDelete: () => void
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

    // Swipe LEFT to reveal delete
    if (isHorizontalSwipe.current && diffX < 0) {
      setSwipeX(Math.max(diffX, -(SWIPE_THRESHOLD + 20)))
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
          className="h-full w-full rounded-none text-destructive-foreground hover:bg-destructive/90"
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
          "bg-secondary p-2 cursor-pointer active:bg-secondary/80",
          !isSwiping && "transition-transform duration-200",
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

export function ManageData({ onClose }: ManageDataProps) {
  const { aircraft, isLoading: aircraftLoading, refresh: refreshAircraft } = useAircraft()
  const { airports, isLoading: airportsLoading, refresh: refreshAirports } = useAirports()
  const { personnel, isLoading: personnelLoading, refresh: refreshPersonnel } = usePersonnel()

  const [isSubmitting, setIsSubmitting] = useState(false)

  // Edit states
  const [editingAircraft, setEditingAircraft] = useState<Aircraft | null>(null)
  const [editingAirport, setEditingAirport] = useState<Airport | null>(null)
  const [editingPersonnel, setEditingPersonnel] = useState<Personnel | null>(null)

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
      await refreshAircraft()
      if (navigator.onLine) syncService.fullSync()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleUpdateAircraft = async () => {
    if (!editingAircraft) return
    setIsSubmitting(true)
    try {
      await updateAircraft(editingAircraft.id, editingAircraft)
      setEditingAircraft(null)
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
      await refreshAirports()
      if (navigator.onLine) syncService.fullSync()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleUpdateAirport = async () => {
    if (!editingAirport) return
    setIsSubmitting(true)
    try {
      await updateAirport(editingAirport.id, editingAirport)
      setEditingAirport(null)
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
      await refreshPersonnel()
      if (navigator.onLine) syncService.fullSync()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleUpdatePersonnel = async () => {
    if (!editingPersonnel) return
    setIsSubmitting(true)
    try {
      await updatePersonnel(editingPersonnel.id, editingPersonnel)
      setEditingPersonnel(null)
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
                {isSubmitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                Add Aircraft
              </Button>

              <ScrollArea className="h-[200px] border rounded-md p-2">
                {aircraftLoading ? (
                  <ListSkeleton />
                ) : (
                  <div className="space-y-2">
                    {aircraft.map((a) => (
                      <SwipeableItem
                        key={a.id}
                        onTap={() => setEditingAircraft(a)}
                        onDelete={() => setDeleteAircraftTarget(a)}
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
                {isSubmitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                Add Airport
              </Button>

              <ScrollArea className="h-[200px] border rounded-md p-2">
                {airportsLoading ? (
                  <ListSkeleton />
                ) : (
                  <div className="space-y-2">
                    {airports.map((a) => (
                      <SwipeableItem
                        key={a.id}
                        onTap={() => setEditingAirport(a)}
                        onDelete={() => setDeleteAirportTarget(a)}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-medium">{a.icao}</span>
                            {a.iata && <span className="text-muted-foreground">/{a.iata}</span>}
                            <span className="text-muted-foreground ml-2">{a.name}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">{a.city}</span>
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
                  <Label htmlFor="pFirst" className="text-xs">
                    First Name
                  </Label>
                  <Input
                    id="pFirst"
                    placeholder="John"
                    value={personnelForm.firstName}
                    onChange={(e) => setPersonnelForm({ ...personnelForm, firstName: e.target.value })}
                    className="bg-input"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pLast" className="text-xs">
                    Last Name
                  </Label>
                  <Input
                    id="pLast"
                    placeholder="Smith"
                    value={personnelForm.lastName}
                    onChange={(e) => setPersonnelForm({ ...personnelForm, lastName: e.target.value })}
                    className="bg-input"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pEmpId" className="text-xs">
                    Employee ID
                  </Label>
                  <Input
                    id="pEmpId"
                    placeholder="SQ12345"
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
                      <SelectItem value="SO">Second Officer</SelectItem>
                      <SelectItem value="INS">Instructor</SelectItem>
                      <SelectItem value="EXM">Examiner</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={handleAddPersonnel} disabled={isSubmitting} size="sm">
                {isSubmitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                Add Personnel
              </Button>

              <ScrollArea className="h-[200px] border rounded-md p-2">
                {personnelLoading ? (
                  <ListSkeleton />
                ) : (
                  <div className="space-y-2">
                    {personnel.map((p) => (
                      <SwipeableItem
                        key={p.id}
                        onTap={() => setEditingPersonnel(p)}
                        onDelete={() => setDeletePersonnelTarget(p)}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-medium">
                              {p.firstName} {p.lastName}
                            </span>
                            {p.employeeId && <span className="text-muted-foreground ml-2">({p.employeeId})</span>}
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

      {/* Edit Aircraft Dialog */}
      <Dialog open={!!editingAircraft} onOpenChange={() => setEditingAircraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Aircraft</DialogTitle>
          </DialogHeader>
          {editingAircraft && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Registration</Label>
                <Input
                  value={editingAircraft.registration}
                  onChange={(e) =>
                    setEditingAircraft({ ...editingAircraft, registration: e.target.value.toUpperCase() })
                  }
                  className="uppercase"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Input
                  value={editingAircraft.type}
                  onChange={(e) => setEditingAircraft({ ...editingAircraft, type: e.target.value.toUpperCase() })}
                  className="uppercase"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Model</Label>
                <Input
                  value={editingAircraft.model}
                  onChange={(e) => setEditingAircraft({ ...editingAircraft, model: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Engine Type</Label>
                <Select
                  value={editingAircraft.engineType}
                  onValueChange={(v) =>
                    setEditingAircraft({ ...editingAircraft, engineType: v as Aircraft["engineType"] })
                  }
                >
                  <SelectTrigger>
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
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingAircraft(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateAircraft} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Airport Dialog */}
      <Dialog open={!!editingAirport} onOpenChange={() => setEditingAirport(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Airport</DialogTitle>
          </DialogHeader>
          {editingAirport && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">ICAO</Label>
                <Input
                  value={editingAirport.icao}
                  onChange={(e) => setEditingAirport({ ...editingAirport, icao: e.target.value.toUpperCase() })}
                  className="uppercase"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">IATA</Label>
                <Input
                  value={editingAirport.iata}
                  onChange={(e) => setEditingAirport({ ...editingAirport, iata: e.target.value.toUpperCase() })}
                  className="uppercase"
                />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Name</Label>
                <Input
                  value={editingAirport.name}
                  onChange={(e) => setEditingAirport({ ...editingAirport, name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">City</Label>
                <Input
                  value={editingAirport.city}
                  onChange={(e) => setEditingAirport({ ...editingAirport, city: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Country</Label>
                <Input
                  value={editingAirport.country}
                  onChange={(e) => setEditingAirport({ ...editingAirport, country: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Latitude</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={editingAirport.latitude}
                  onChange={(e) =>
                    setEditingAirport({ ...editingAirport, latitude: Number.parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Longitude</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={editingAirport.longitude}
                  onChange={(e) =>
                    setEditingAirport({ ...editingAirport, longitude: Number.parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Timezone</Label>
                <Input
                  value={editingAirport.timezone}
                  onChange={(e) => setEditingAirport({ ...editingAirport, timezone: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">UTC Offset</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={editingAirport.utcOffset}
                  onChange={(e) =>
                    setEditingAirport({ ...editingAirport, utcOffset: Number.parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingAirport(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateAirport} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Personnel Dialog */}
      <Dialog open={!!editingPersonnel} onOpenChange={() => setEditingPersonnel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Personnel</DialogTitle>
          </DialogHeader>
          {editingPersonnel && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">First Name</Label>
                <Input
                  value={editingPersonnel.firstName}
                  onChange={(e) => setEditingPersonnel({ ...editingPersonnel, firstName: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Last Name</Label>
                <Input
                  value={editingPersonnel.lastName}
                  onChange={(e) => setEditingPersonnel({ ...editingPersonnel, lastName: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Employee ID</Label>
                <Input
                  value={editingPersonnel.employeeId}
                  onChange={(e) => setEditingPersonnel({ ...editingPersonnel, employeeId: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Role</Label>
                <Select
                  value={editingPersonnel.role}
                  onValueChange={(v) => setEditingPersonnel({ ...editingPersonnel, role: v as Personnel["role"] })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CAPT">Captain</SelectItem>
                    <SelectItem value="FO">First Officer</SelectItem>
                    <SelectItem value="SO">Second Officer</SelectItem>
                    <SelectItem value="INS">Instructor</SelectItem>
                    <SelectItem value="EXM">Examiner</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">License Number</Label>
                <Input
                  value={editingPersonnel.licenseNumber}
                  onChange={(e) => setEditingPersonnel({ ...editingPersonnel, licenseNumber: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Company</Label>
                <Input
                  value={editingPersonnel.company}
                  onChange={(e) => setEditingPersonnel({ ...editingPersonnel, company: e.target.value })}
                />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Email</Label>
                <Input
                  type="email"
                  value={editingPersonnel.email}
                  onChange={(e) => setEditingPersonnel({ ...editingPersonnel, email: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingPersonnel(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdatePersonnel} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialogs */}
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
              Are you sure you want to delete {deleteAirportTarget?.icao} ({deleteAirportTarget?.name})? This action
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
