"use client"

import type React from "react"
import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SwipeableCard } from "@/components/swipeable-card"
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
  addPersonnel,
  updateAircraft,
  updatePersonnel,
  deleteAircraft,
  deletePersonnel,
  type Aircraft,
  type Personnel,
} from "@/lib/db"
import { useAircraft, usePersonnel } from "@/hooks/data"
import { syncService } from "@/lib/sync"
import { Plane, Users, Save, X, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { SwipeableCard } from "@/components/swipeable-card"

type TabType = "aircraft" | "personnel"

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
  return (
    <SwipeableCard
      onClick={onEdit}
      actions={[
        {
          icon: <Trash2 className="h-5 w-5" />,
          onClick: onDelete,
          variant: "destructive",
        },
      ]}
    >
      <div
        className={cn(
          "p-3 bg-secondary/50 rounded-lg cursor-pointer",
          isActive && "ring-2 ring-primary",
        )}
      >
        {children}
      </div>
    </SwipeableCard>
  )
}

export function ManageData() {
  const [activeTab, setActiveTab] = useState<TabType>("aircraft")
  const { aircraft, refresh: refreshAircraft } = useAircraft()
  const { personnel, refresh: refreshPersonnel } = usePersonnel()

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ type: TabType; item: Aircraft | Personnel } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Edit state
  const [editingAircraft, setEditingAircraft] = useState<Aircraft | null>(null)
  const [editingPersonnel, setEditingPersonnel] = useState<Personnel | null>(null)

  // Aircraft form
  const [aircraftForm, setAircraftForm] = useState({
    registration: "",
    type: "",
    typeDesignator: "",
    category: "ASEL",
    engineType: "JET",
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

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
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
