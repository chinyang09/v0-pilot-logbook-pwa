"use client"

import type React from "react"
import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
import { Plane, MapPin, Users, Save, X, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"

type TabType = "aircraft" | "airports" | "personnel"

function SwipeableRow({
  label,
  children,
  onClear,
  showClear = true,
}: {
  label: string
  children: React.ReactNode
  onClear?: () => void
  showClear?: boolean
}) {
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

    if (Math.abs(deltaX) > 10 && Math.abs(deltaX) > deltaY) {
      setIsDragging(true)
      currentX.current = e.touches[0].clientX
    }
  }

  const handleTouchEnd = () => {
    if (!isDragging) {
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

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="bg-secondary/50 px-3 py-2 -mx-3 mt-4 first:mt-0">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</h3>
    </div>
  )
}

function SwipeableItem({
  children,
  onEdit,
  onDelete,
  isActive,
}: {
  children: React.ReactNode
  onEdit: () => void
  onDelete: () => void
  isActive?: boolean
}) {
  const [swipeX, setSwipeX] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)
  const startX = useRef(0)

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX
    setIsSwiping(true)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isSwiping) return
    const diff = e.touches[0].clientX - startX.current
    if (diff < 0) {
      setSwipeX(Math.max(diff, -80))
    } else if (swipeX < 0) {
      setSwipeX(Math.min(0, swipeX + diff))
    }
  }

  const handleTouchEnd = () => {
    setIsSwiping(false)
    setSwipeX(swipeX < -40 ? -80 : 0)
  }

  const handleClick = () => {
    if (swipeX < 0) {
      setSwipeX(0)
    } else {
      onEdit()
    }
  }

  return (
    <div className="relative overflow-hidden rounded-lg">
      <div
        className={cn(
          "absolute inset-y-0 right-0 flex items-center justify-center bg-destructive transition-opacity z-0",
          swipeX < 0 ? "opacity-100" : "opacity-0",
        )}
        style={{ width: 80 }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="h-full w-full flex items-center justify-center text-destructive-foreground"
        >
          <Trash2 className="h-5 w-5" />
        </button>
      </div>
      <div
        className={cn(
          "p-3 bg-secondary/50 rounded-lg cursor-pointer relative z-10 transition-transform",
          !isSwiping && "duration-200",
          isActive && "ring-2 ring-primary",
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
  const [activeTab, setActiveTab] = useState<TabType>("aircraft")
  const { aircraft, refresh: refreshAircraft } = useAircraft()
  const { airports, refresh: refreshAirports } = useAirports()
  const { personnel, refresh: refreshPersonnel } = usePersonnel()

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ type: TabType; item: Aircraft | Airport | Personnel } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Edit state
  const [editingAircraft, setEditingAircraft] = useState<Aircraft | null>(null)
  const [editingAirport, setEditingAirport] = useState<Airport | null>(null)
  const [editingPersonnel, setEditingPersonnel] = useState<Personnel | null>(null)

  // Aircraft form
  const [aircraftForm, setAircraftForm] = useState({
    registration: "",
    type: "",
    typeDesignator: "",
    category: "ASEL",
    engineType: "JET",
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
    timezone: "",
  })

  // Personnel form
  const [personnelForm, setPersonnelForm] = useState({
    firstName: "",
    lastName: "",
  })

  const inputClassName = "bg-input h-10 text-base text-right w-full"

  const resetAircraftForm = () => {
    setAircraftForm({ registration: "", type: "", typeDesignator: "", category: "ASEL", engineType: "JET" })
    setEditingAircraft(null)
  }

  const resetAirportForm = () => {
    setAirportForm({ icao: "", iata: "", name: "", city: "", country: "", latitude: "", longitude: "", timezone: "" })
    setEditingAirport(null)
  }

  const resetPersonnelForm = () => {
    setPersonnelForm({ firstName: "", lastName: "" })
    setEditingPersonnel(null)
  }

  const handleEditAircraft = (ac: Aircraft) => {
    setEditingAircraft(ac)
    setAircraftForm({
      registration: ac.registration,
      type: ac.type,
      typeDesignator: ac.typeDesignator || "",
      category: ac.category || "ASEL",
      engineType: ac.engineType || "JET",
    })
  }

  const handleEditAirport = (ap: Airport) => {
    setEditingAirport(ap)
    setAirportForm({
      icao: ap.icao,
      iata: ap.iata || "",
      name: ap.name,
      city: ap.city || "",
      country: ap.country || "",
      latitude: String(ap.latitude),
      longitude: String(ap.longitude),
      timezone: ap.timezone || "",
    })
  }

  const handleEditPersonnel = (p: Personnel) => {
    setEditingPersonnel(p)
    setPersonnelForm({
      firstName: p.firstName,
      lastName: p.lastName,
    })
  }

  const handleSaveAircraft = async () => {
    if (!aircraftForm.registration || !aircraftForm.type) return
    setIsSubmitting(true)
    try {
      if (editingAircraft) {
        await updateAircraft(editingAircraft.id, aircraftForm)
      } else {
        await addAircraft(aircraftForm)
      }
      resetAircraftForm()
      await refreshAircraft()
      if (navigator.onLine) syncService.fullSync()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSaveAirport = async () => {
    if (!airportForm.icao || !airportForm.name) return
    setIsSubmitting(true)
    try {
      const data = {
        ...airportForm,
        latitude: Number.parseFloat(airportForm.latitude) || 0,
        longitude: Number.parseFloat(airportForm.longitude) || 0,
      }
      if (editingAirport) {
        await updateAirport(editingAirport.id, data)
      } else {
        await addAirport(data)
      }
      resetAirportForm()
      await refreshAirports()
      if (navigator.onLine) syncService.fullSync()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSavePersonnel = async () => {
    if (!personnelForm.firstName || !personnelForm.lastName) return
    setIsSubmitting(true)
    try {
      if (editingPersonnel) {
        await updatePersonnel(editingPersonnel.id, personnelForm)
      } else {
        await addPersonnel(personnelForm)
      }
      resetPersonnelForm()
      await refreshPersonnel()
      if (navigator.onLine) syncService.fullSync()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      switch (deleteTarget.type) {
        case "aircraft":
          await deleteAircraft(deleteTarget.item.id)
          await refreshAircraft()
          break
        case "airports":
          await deleteAirport(deleteTarget.item.id)
          await refreshAirports()
          break
        case "personnel":
          await deletePersonnel(deleteTarget.item.id)
          await refreshPersonnel()
          break
      }
      if (navigator.onLine) syncService.fullSync()
    } finally {
      setIsDeleting(false)
      setDeleteTarget(null)
    }
  }

  const tabs = [
    { id: "aircraft" as TabType, label: "Aircraft", icon: Plane },
    { id: "airports" as TabType, label: "Airports", icon: MapPin },
    { id: "personnel" as TabType, label: "Personnel", icon: Users },
  ]

  return (
    <div className="space-y-4">
      {/* Tab buttons */}
      <div className="flex gap-1 p-1 bg-secondary/30 rounded-lg">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActiveTab(tab.id)}
            className="flex-1 gap-2"
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Aircraft Tab */}
      {activeTab === "aircraft" && (
        <div className="bg-card rounded-lg border border-border">
          <div className="flex items-center justify-between p-3 border-b border-border">
            <h3 className="font-semibold">{editingAircraft ? "Edit Aircraft" : "Add Aircraft"}</h3>
            <div className="flex gap-2">
              {editingAircraft && (
                <Button variant="ghost" size="sm" onClick={resetAircraftForm}>
                  <X className="h-4 w-4" />
                </Button>
              )}
              <Button size="sm" onClick={handleSaveAircraft} disabled={isSubmitting}>
                <Save className="h-4 w-4 mr-1" />
                {editingAircraft ? "Update" : "Add"}
              </Button>
            </div>
          </div>
          <div className="px-3 pb-3">
            <SwipeableRow label="Registration" onClear={() => setAircraftForm((p) => ({ ...p, registration: "" }))}>
              <Input
                placeholder="9V-SWA"
                value={aircraftForm.registration}
                onChange={(e) => setAircraftForm((p) => ({ ...p, registration: e.target.value.toUpperCase() }))}
                className={inputClassName}
              />
            </SwipeableRow>
            <SwipeableRow label="Type" onClear={() => setAircraftForm((p) => ({ ...p, type: "" }))}>
              <Input
                placeholder="B777-300ER"
                value={aircraftForm.type}
                onChange={(e) => setAircraftForm((p) => ({ ...p, type: e.target.value }))}
                className={inputClassName}
              />
            </SwipeableRow>
            <SwipeableRow label="ICAO Type" onClear={() => setAircraftForm((p) => ({ ...p, typeDesignator: "" }))}>
              <Input
                placeholder="B77W"
                value={aircraftForm.typeDesignator}
                onChange={(e) => setAircraftForm((p) => ({ ...p, typeDesignator: e.target.value.toUpperCase() }))}
                className={inputClassName}
              />
            </SwipeableRow>
            <SwipeableRow label="Category" showClear={false}>
              <Select
                value={aircraftForm.category}
                onValueChange={(v) => setAircraftForm((p) => ({ ...p, category: v }))}
              >
                <SelectTrigger className={inputClassName}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ASEL">ASEL</SelectItem>
                  <SelectItem value="AMEL">AMEL</SelectItem>
                  <SelectItem value="ASES">ASES</SelectItem>
                  <SelectItem value="AMES">AMES</SelectItem>
                  <SelectItem value="HELO">Helicopter</SelectItem>
                  <SelectItem value="GLIDER">Glider</SelectItem>
                </SelectContent>
              </Select>
            </SwipeableRow>
            <SwipeableRow label="Engine" showClear={false}>
              <Select
                value={aircraftForm.engineType}
                onValueChange={(v) => setAircraftForm((p) => ({ ...p, engineType: v }))}
              >
                <SelectTrigger className={inputClassName}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="JET">Jet</SelectItem>
                  <SelectItem value="TURBOPROP">Turboprop</SelectItem>
                  <SelectItem value="PISTON">Piston</SelectItem>
                  <SelectItem value="ELECTRIC">Electric</SelectItem>
                </SelectContent>
              </Select>
            </SwipeableRow>
          </div>

          {/* Aircraft List */}
          <div className="border-t border-border p-3 space-y-2 max-h-64 overflow-y-auto">
            {aircraft.map((ac) => (
              <SwipeableItem
                key={ac.id}
                onEdit={() => handleEditAircraft(ac)}
                onDelete={() => setDeleteTarget({ type: "aircraft", item: ac })}
                isActive={editingAircraft?.id === ac.id}
              >
                <div className="flex justify-between items-center">
                  <span className="font-medium">{ac.registration}</span>
                  <span className="text-sm text-muted-foreground">{ac.type}</span>
                </div>
              </SwipeableItem>
            ))}
            {aircraft.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No aircraft added yet</p>
            )}
          </div>
        </div>
      )}

      {/* Airports Tab */}
      {activeTab === "airports" && (
        <div className="bg-card rounded-lg border border-border">
          <div className="flex items-center justify-between p-3 border-b border-border">
            <h3 className="font-semibold">{editingAirport ? "Edit Airport" : "Add Airport"}</h3>
            <div className="flex gap-2">
              {editingAirport && (
                <Button variant="ghost" size="sm" onClick={resetAirportForm}>
                  <X className="h-4 w-4" />
                </Button>
              )}
              <Button size="sm" onClick={handleSaveAirport} disabled={isSubmitting}>
                <Save className="h-4 w-4 mr-1" />
                {editingAirport ? "Update" : "Add"}
              </Button>
            </div>
          </div>
          <div className="px-3 pb-3">
            <SwipeableRow label="ICAO" onClear={() => setAirportForm((p) => ({ ...p, icao: "" }))}>
              <Input
                placeholder="WSSS"
                value={airportForm.icao}
                onChange={(e) => setAirportForm((p) => ({ ...p, icao: e.target.value.toUpperCase() }))}
                className={inputClassName}
              />
            </SwipeableRow>
            <SwipeableRow label="IATA" onClear={() => setAirportForm((p) => ({ ...p, iata: "" }))}>
              <Input
                placeholder="SIN"
                value={airportForm.iata}
                onChange={(e) => setAirportForm((p) => ({ ...p, iata: e.target.value.toUpperCase() }))}
                className={inputClassName}
              />
            </SwipeableRow>
            <SwipeableRow label="Name" onClear={() => setAirportForm((p) => ({ ...p, name: "" }))}>
              <Input
                placeholder="Singapore Changi"
                value={airportForm.name}
                onChange={(e) => setAirportForm((p) => ({ ...p, name: e.target.value }))}
                className={inputClassName}
              />
            </SwipeableRow>
            <SwipeableRow label="City" onClear={() => setAirportForm((p) => ({ ...p, city: "" }))}>
              <Input
                placeholder="Singapore"
                value={airportForm.city}
                onChange={(e) => setAirportForm((p) => ({ ...p, city: e.target.value }))}
                className={inputClassName}
              />
            </SwipeableRow>
            <SwipeableRow label="Country" onClear={() => setAirportForm((p) => ({ ...p, country: "" }))}>
              <Input
                placeholder="Singapore"
                value={airportForm.country}
                onChange={(e) => setAirportForm((p) => ({ ...p, country: e.target.value }))}
                className={inputClassName}
              />
            </SwipeableRow>
            <SwipeableRow label="Latitude" onClear={() => setAirportForm((p) => ({ ...p, latitude: "" }))}>
              <Input
                type="number"
                step="0.0001"
                placeholder="1.3644"
                value={airportForm.latitude}
                onChange={(e) => setAirportForm((p) => ({ ...p, latitude: e.target.value }))}
                className={inputClassName}
              />
            </SwipeableRow>
            <SwipeableRow label="Longitude" onClear={() => setAirportForm((p) => ({ ...p, longitude: "" }))}>
              <Input
                type="number"
                step="0.0001"
                placeholder="103.9915"
                value={airportForm.longitude}
                onChange={(e) => setAirportForm((p) => ({ ...p, longitude: e.target.value }))}
                className={inputClassName}
              />
            </SwipeableRow>
            <SwipeableRow label="Timezone" onClear={() => setAirportForm((p) => ({ ...p, timezone: "" }))}>
              <Input
                placeholder="Asia/Singapore"
                value={airportForm.timezone}
                onChange={(e) => setAirportForm((p) => ({ ...p, timezone: e.target.value }))}
                className={inputClassName}
              />
            </SwipeableRow>
          </div>

          {/* Airports List */}
          <div className="border-t border-border p-3 space-y-2 max-h-64 overflow-y-auto">
            {airports.map((ap) => (
              <SwipeableItem
                key={ap.id}
                onEdit={() => handleEditAirport(ap)}
                onDelete={() => setDeleteTarget({ type: "airports", item: ap })}
                isActive={editingAirport?.id === ap.id}
              >
                <div className="flex justify-between items-center">
                  <span className="font-medium">{ap.icao}</span>
                  <span className="text-sm text-muted-foreground truncate ml-2">{ap.name}</span>
                </div>
              </SwipeableItem>
            ))}
            {airports.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No airports added yet</p>
            )}
          </div>
        </div>
      )}

      {/* Personnel Tab */}
      {activeTab === "personnel" && (
        <div className="bg-card rounded-lg border border-border">
          <div className="flex items-center justify-between p-3 border-b border-border">
            <h3 className="font-semibold">{editingPersonnel ? "Edit Personnel" : "Add Personnel"}</h3>
            <div className="flex gap-2">
              {editingPersonnel && (
                <Button variant="ghost" size="sm" onClick={resetPersonnelForm}>
                  <X className="h-4 w-4" />
                </Button>
              )}
              <Button size="sm" onClick={handleSavePersonnel} disabled={isSubmitting}>
                <Save className="h-4 w-4 mr-1" />
                {editingPersonnel ? "Update" : "Add"}
              </Button>
            </div>
          </div>
          <div className="px-3 pb-3">
            <SwipeableRow label="First Name" onClear={() => setPersonnelForm((p) => ({ ...p, firstName: "" }))}>
              <Input
                placeholder="John"
                value={personnelForm.firstName}
                onChange={(e) => setPersonnelForm((p) => ({ ...p, firstName: e.target.value }))}
                className={inputClassName}
              />
            </SwipeableRow>
            <SwipeableRow label="Last Name" onClear={() => setPersonnelForm((p) => ({ ...p, lastName: "" }))}>
              <Input
                placeholder="Smith"
                value={personnelForm.lastName}
                onChange={(e) => setPersonnelForm((p) => ({ ...p, lastName: e.target.value }))}
                className={inputClassName}
              />
            </SwipeableRow>
          </div>

          {/* Personnel List */}
          <div className="border-t border-border p-3 space-y-2 max-h-64 overflow-y-auto">
            {personnel.map((p) => (
              <SwipeableItem
                key={p.id}
                onEdit={() => handleEditPersonnel(p)}
                onDelete={() => setDeleteTarget({ type: "personnel", item: p })}
                isActive={editingPersonnel?.id === p.id}
              >
                <div className="flex justify-between items-center">
                  <span className="font-medium">
                    {p.firstName} {p.lastName}
                  </span>
                  <span className="text-sm text-muted-foreground">{p.role}</span>
                </div>
              </SwipeableItem>
            ))}
            {personnel.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No personnel added yet</p>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.type.slice(0, -1)}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this item? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
