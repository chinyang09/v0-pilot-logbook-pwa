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
  getAllPersonnel,
  type FlightLog,
  type Personnel,
  getUserPreferences,
  saveUserPreferences,
} from "@/lib/indexed-db"
import { useAirportDatabase } from "@/hooks/use-indexed-db"
import { searchAirports, getAirportByICAO, type AirportData } from "@/lib/airport-database"
import { calculateTimesFromOOOI, calculateNightTime } from "@/lib/night-time-calculator"
import { formatHHMMDisplay } from "@/lib/time-utils"
import { syncService } from "@/lib/sync-service"
import { Save, X, ArrowLeftRight, Trash2, MapPin } from "lucide-react"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"

interface FlightFormProps {
  onFlightAdded: (flight: FlightLog) => void
  onClose: () => void
  editingFlight?: FlightLog | null
  selectedAirportField?: string | null
  selectedAirportCode?: string | null
}

type PilotRole = "PIC" | "FO" | "P1US" | "STUDENT" | "INSTRUCTOR"

interface SwipeableRowProps {
  label: string
  children: React.ReactNode
  onClear?: () => void
  showClear?: boolean
  disabled?: boolean
}

function SwipeableRow({ label, children, onClear, showClear = true, disabled = false }: SwipeableRowProps) {
  const [swiped, setSwiped] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const startX = useRef(0)
  const startY = useRef(0)
  const currentX = useRef(0)

  const handleTouchStart = (e: React.TouchEvent) => {
    if (disabled) return // Don't allow swipe in config mode
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    setIsDragging(false)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (disabled) return // Don't allow swipe in config mode
    const deltaX = startX.current - e.touches[0].clientX
    const deltaY = Math.abs(startY.current - e.touches[0].clientY)

    // Only swipe if horizontal movement > vertical movement
    if (Math.abs(deltaX) > 10 && Math.abs(deltaX) > deltaY) {
      setIsDragging(true)
      currentX.current = e.touches[0].clientX
    }
  }

  const handleTouchEnd = () => {
    if (disabled) return // Don't allow swipe in config mode
    if (!isDragging) {
      // If not dragging, treat as tap to close if already swiped
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
    <div className="relative overflow-hidden min-h-[2.5rem]">
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
          "flex items-center gap-1.5 py-1 px-1 transition-transform duration-200 bg-card relative z-10 min-h-[2.5rem]",
          swiped && "-translate-x-20",
        )}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <span className="text-sm text-muted-foreground w-20 flex-shrink-0 text-left flex items-center h-10">
          {label}
        </span>
        <div className="flex-1 flex justify-end items-center h-10">{children}</div>
      </div>
    </div>
  )
}

function SectionHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="bg-secondary/50 px-2 py-1.5 -mx-2 mt-2 first:mt-0 flex items-center justify-between min-h-[2.5rem]">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  )
}

export function FlightForm({
  onFlightAdded,
  onClose,
  editingFlight,
  selectedAirportField,
  selectedAirportCode,
}: FlightFormProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { airports: airportDatabase, isLoading: airportsLoading } = useAirportDatabase()
  const [aircraft, setAircraft] = useState([])
  const [personnel, setPersonnel] = useState<Personnel[]>([])

  const [depAirportSearch, setDepAirportSearch] = useState("")
  const [arrAirportSearch, setArrAirportSearch] = useState("")
  const [depAirportResults, setDepAirportResults] = useState<AirportData[]>([])
  const [arrAirportResults, setArrAirportResults] = useState<AirportData[]>([])
  const [showDepResults, setShowDepResults] = useState(false)
  const [showArrResults, setShowArrResults] = useState(false)

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
    isPilotFlying: false, // Changed from pilotRole to isPilotFlying toggle
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

  const [fieldOrders, setFieldOrders] = useState({
    flight: [
      "date",
      "flightNumber",
      "aircraftId",
      "departureIcao",
      "arrivalIcao",
      "outTime",
      "offTime",
      "onTime",
      "inTime",
    ],
    time: ["total", "night", "p1us", "sicTime", "xc", "ifr", "actualInst", "simInst"],
    crew: ["pf", "picCrew", "sicCrew", "observer"],
    landings: ["dayTO", "dayLdg", "nightTO", "nightLdg", "autolands"],
    approaches: ["app1", "app2", "holds"],
    notes: ["remarks", "ipcIcc"],
  })
  const [draggedField, setDraggedField] = useState<{ section: string; field: string } | null>(null)

  const [dragStartTime, setDragStartTime] = useState(0)
  const dragElementRef = useRef<HTMLDivElement | null>(null)

  const [touchDragState, setTouchDragState] = useState<{
    section: string
    field: string
    startY: number
  } | null>(null)
  const [touchStartY, setTouchStartY] = useState(0)
  const [touchCurrentY, setTouchCurrentY] = useState(0)
  const [isDraggingTouch, setIsDraggingTouch] = useState(false)

  useEffect(() => {
    const loadPreferences = async () => {
      const prefs = await getUserPreferences()
      if (prefs?.fieldOrder) {
        const migratedOrders = migrateFieldKeys(prefs.fieldOrder)
        setFieldOrders(migratedOrders)

        // Save migrated orders back to preferences
        if (JSON.stringify(prefs.fieldOrder) !== JSON.stringify(migratedOrders)) {
          await saveUserPreferences({ fieldOrder: migratedOrders })
        }
      }
    }
    loadPreferences()
  }, [])

  const saveFieldOrders = async (newOrders: typeof fieldOrders) => {
    setFieldOrders(newOrders)
    await saveUserPreferences({ fieldOrder: newOrders })
    if (navigator.onLine) {
      syncService.fullSync()
    }
  }

  const handleDragStart = (section: string, field: string) => {
    setDraggedField({ section, field })
  }

  const handleDragOver = (e: React.DragEvent, section: string, targetField: string) => {
    e.preventDefault()
    if (!draggedField || draggedField.section !== section || draggedField.field === targetField) return

    const newOrders = { ...fieldOrders }
    const sectionKey = section as keyof typeof fieldOrders
    const order = [...newOrders[sectionKey]]
    const draggedIndex = order.indexOf(draggedField.field)
    const targetIndex = order.indexOf(targetField)

    order.splice(draggedIndex, 1)
    order.splice(targetIndex, 0, draggedField.field)

    newOrders[sectionKey] = order
    setFieldOrders(newOrders)
  }

  const handleDragEnd = () => {
    if (draggedField) {
      saveFieldOrders(fieldOrders)
      setDraggedField(null)
    }
  }

  const handleTouchStartConfig = (e: React.TouchEvent, section: string, field: string) => {
    if (!editingFlight) return

    const touch = e.touches[0]
    setTouchStartY(touch.clientY)
    setTouchCurrentY(touch.clientY)
    setTouchDragState({
      section,
      field,
      startY: touch.clientY,
    })
    setDragStartTime(Date.now())
    setIsDraggingTouch(false)
  }

  const handleTouchMoveConfig = (e: React.TouchEvent, section: string, targetField: string) => {
    if (!touchDragState || touchDragState.section !== section) return

    const touch = e.touches[0]
    const dragDistance = Math.abs(touch.clientY - touchDragState.startY)

    setTouchCurrentY(touch.clientY)

    // Start dragging after minimum distance
    if (dragDistance > 20) {
      setIsDraggingTouch(true)

      // Only reorder if we're over a different field
      if (touchDragState.field !== targetField) {
        const newOrders = { ...fieldOrders }
        const sectionKey = section as keyof typeof fieldOrders
        const order = [...newOrders[sectionKey]]
        const draggedIndex = order.indexOf(touchDragState.field)
        const targetIndex = order.indexOf(targetField)

        if (draggedIndex !== -1 && targetIndex !== -1 && draggedIndex !== targetIndex) {
          order.splice(draggedIndex, 1)
          order.splice(targetIndex, 0, touchDragState.field)
          newOrders[sectionKey] = order
          setFieldOrders(newOrders)

          // Update the drag state to the new position
          setTouchDragState({
            ...touchDragState,
            startY: touch.clientY,
          })
        }
      }
    }
  }

  const handleTouchEndConfig = () => {
    if (touchDragState && isDraggingTouch) {
      saveFieldOrders(fieldOrders)
    }
    setTouchDragState(null)
    setIsDraggingTouch(false)
    setTouchStartY(0)
    setTouchCurrentY(0)
  }

  // Load reference data
  useEffect(() => {
    async function loadData() {
      // Use async function
      try {
        const personnelData = await getAllPersonnel()
        setPersonnel(personnelData)
      } catch (error) {
        console.error("Failed to load data:", error)
      }
    }
    loadData()
  }, [])

  useEffect(() => {
    if (depAirportSearch.length >= 2) {
      const results = searchAirports(airportDatabase, depAirportSearch, 10)
      setDepAirportResults(results)
    } else {
      setDepAirportResults([])
    }
  }, [depAirportSearch, airportDatabase])

  useEffect(() => {
    if (arrAirportSearch.length >= 2) {
      const results = searchAirports(airportDatabase, arrAirportSearch, 10)
      setArrAirportResults(results)
    } else {
      setArrAirportResults([])
    }
  }, [arrAirportSearch, airportDatabase])

  useEffect(() => {
    console.log("[v0] Selected airport effect triggered", { selectedAirportField, selectedAirportCode })
    if (selectedAirportField && selectedAirportCode) {
      if (selectedAirportField === "from") {
        setFormData((prev) => ({ ...prev, departureIcao: selectedAirportCode }))
      } else if (selectedAirportField === "to") {
        setFormData((prev) => ({ ...prev, arrivalIcao: selectedAirportCode }))
      }

      // Clear URL params after processing to prevent re-triggering
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href)
        url.searchParams.delete("field")
        url.searchParams.delete("airport")
        window.history.replaceState({}, "", url.toString())
      }
    }
  }, [selectedAirportField, selectedAirportCode])

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
        // Removed pilotRole, added isPilotFlying based on its original value
        isPilotFlying:
          (editingFlight as any).pilotRole === "PIC" || (editingFlight as any).pilotRole === "INSTRUCTOR" || false,
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
    () => getAirportByICAO(airportDatabase, formData.departureIcao),
    [airportDatabase, formData.departureIcao],
  )
  const arrivalAirport = useMemo(
    () => getAirportByICAO(airportDatabase, formData.arrivalIcao),
    [airportDatabase, formData.arrivalIcao],
  )

  useEffect(() => {
    let nightTime = "00:00"

    if (formData.outTime && formData.inTime) {
      const times = calculateTimesFromOOOI(
        formData.outTime,
        formData.offTime,
        formData.onTime,
        formData.inTime,
        formData.date,
      )
      setCalculatedTimes((prev) => ({ ...prev, blockTime: times.blockTime, flightTime: times.flightTime }))
    }

    if (departureAirport && arrivalAirport && formData.offTime && formData.onTime) {
      const offDateTime = new Date(`${formData.date}T${formData.offTime}:00Z`)
      const onDateTime = new Date(`${formData.date}T${formData.onTime}:00Z`)

      if (onDateTime < offDateTime) {
        onDateTime.setDate(onDateTime.getDate() + 1)
      }

      nightTime = calculateNightTime(
        offDateTime,
        onDateTime,
        departureAirport.lat,
        departureAirport.lon,
        arrivalAirport.lat,
        arrivalAirport.lon,
      )

      setCalculatedTimes((prev) => ({ ...prev, nightTime }))
    }
  }, [
    formData.date,
    formData.outTime,
    formData.offTime,
    formData.onTime,
    formData.inTime,
    departureAirport,
    arrivalAirport,
  ])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const personnelIds = [formData.picCrewId, formData.sicCrewId, formData.observerCrewId].filter(Boolean)

      // Determine pilotRole based on isPilotFlying and crew position
      let pilotRole: PilotRole = "FO" // Default to FO
      const selfId = personnel.find(
        (p) => p.firstName.toLowerCase() === "self" || p.lastName.toLowerCase() === "self",
      )?.id
      if (formData.picCrewId === selfId) {
        pilotRole = formData.isPilotFlying ? "PIC" : "FO" // Assuming PIC is always PF
      } else if (formData.sicCrewId === selfId) {
        pilotRole = formData.isPilotFlying ? "P1US" : "FO"
      } else {
        // If 'self' is not in PIC or SIC, we need to infer from existing data or leave as default
        // For now, we'll use the previous value if editing, or default
        if (editingFlight) {
          pilotRole = editingFlight.pilotRole as PilotRole
        }
      }

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
        pilotRole: pilotRole,
        personnelIds, // Updated to use aligned schema keys: personnelIds instead of crewIds
        picId: formData.picCrewId, // Added explicit PIC ID
        sicId: formData.sicCrewId, // Added explicit SIC ID
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
        onFlightAdded?.(flight) // Use optional chaining for callbacks
        onClose?.() // Use optional chaining for callbacks
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

  const inputClassName = "bg-input h-10 text-base text-right w-full"

  const selfId = personnel.find((p) => p.firstName.toLowerCase() === "self" || p.lastName.toLowerCase() === "self")?.id
  const selfInCrew =
    formData.picCrewId === selfId || formData.sicCrewId === selfId || formData.observerCrewId === selfId
  const pfDisabled = !selfInCrew || formData.sicCrewId !== selfId

  const fieldComponents: Record<string, React.ReactNode> = {
    date: (
      <SwipeableRow label="Date" onClear={() => clearField("date", new Date().toISOString().split("T")[0])}>
        <Input
          type="date"
          value={formData.date}
          onChange={(e) => updateField("date", e.target.value)}
          className={inputClassName}
        />
      </SwipeableRow>
    ),
    flightNumber: (
      <SwipeableRow label="Flight No" onClear={() => clearField("flightNumber")}>
        <Input
          placeholder="SQ123"
          value={formData.flightNumber}
          onChange={(e) => updateField("flightNumber", e.target.value)}
          className={cn(inputClassName, "uppercase")}
        />
      </SwipeableRow>
    ),
    aircraftId: (
      <SwipeableRow label="Aircraft" onClear={() => clearField("aircraftId")}>
        <Input
          placeholder="Aircraft ID"
          value={formData.aircraftId}
          onChange={(e) => updateField("aircraftId", e.target.value)}
          className={inputClassName}
        />
      </SwipeableRow>
    ),
    departureIcao: (
      <SwipeableRow label="From" onClear={() => clearField("departureIcao")}>
        <button
          type="button"
          onClick={() => router.push("/airports?field=from&return=/new-flight")}
          className={cn(
            inputClassName,
            "text-right uppercase flex items-center justify-end gap-2 cursor-pointer hover:bg-accent/50 transition-colors",
          )}
        >
          {formData.departureIcao || <span className="text-muted-foreground">Select</span>}
          <MapPin className="h-4 w-4 text-muted-foreground" />
        </button>
      </SwipeableRow>
    ),

    arrivalIcao: (
      <SwipeableRow label="To" onClear={() => clearField("arrivalIcao")}>
        <button
          type="button"
          onClick={() => router.push("/airports?field=to&return=/new-flight")}
          className={cn(
            inputClassName,
            "text-right uppercase flex items-center justify-end gap-2 cursor-pointer hover:bg-accent/50 transition-colors",
          )}
        >
          {formData.arrivalIcao || <span className="text-muted-foreground">Select</span>}
          <MapPin className="h-4 w-4 text-muted-foreground" />
        </button>
      </SwipeableRow>
    ),
    outTime: (
      <SwipeableRow label="Out" onClear={() => clearField("outTime")}>
        <Input
          type="time"
          value={formData.outTime}
          onChange={(e) => updateField("outTime", e.target.value)}
          className={inputClassName}
        />
      </SwipeableRow>
    ),
    offTime: (
      <SwipeableRow label="Off" onClear={() => clearField("offTime")}>
        <Input
          type="time"
          value={formData.offTime}
          onChange={(e) => updateField("offTime", e.target.value)}
          className={inputClassName}
        />
      </SwipeableRow>
    ),
    onTime: (
      <SwipeableRow label="On" onClear={() => clearField("onTime")}>
        <Input
          type="time"
          value={formData.onTime}
          onChange={(e) => updateField("onTime", e.target.value)}
          className={inputClassName}
        />
      </SwipeableRow>
    ),
    inTime: (
      <SwipeableRow label="In" onClear={() => clearField("inTime")}>
        <Input
          type="time"
          value={formData.inTime}
          onChange={(e) => updateField("inTime", e.target.value)}
          className={inputClassName}
        />
      </SwipeableRow>
    ),
    crossCountryTime: (
      <SwipeableRow label="XC" onClear={() => clearField("crossCountryTime")}>
        <div className="relative w-full">
          <Input
            type="time"
            value={formData.crossCountryTime}
            onChange={(e) => updateField("crossCountryTime", e.target.value)}
            className={cn(inputClassName, "pr-24")}
            style={{ WebkitAppearance: "none" }}
          />
          {!formData.crossCountryTime && (
            <button
              type="button"
              onClick={() => copyFlightTime("crossCountryTime")}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-xs text-primary px-2 py-1 rounded bg-primary/10"
            >
              Use {formatHHMMDisplay(calculatedTimes.flightTime)}
            </button>
          )}
        </div>
      </SwipeableRow>
    ),
    ifrTime: (
      <SwipeableRow label="IFR" onClear={() => clearField("ifrTime")}>
        <div className="relative w-full">
          <Input
            type="time"
            value={formData.ifrTime}
            onChange={(e) => updateField("ifrTime", e.target.value)}
            className={cn(inputClassName, "pr-24")}
            style={{ WebkitAppearance: "none" }}
          />
          {!formData.ifrTime && (
            <button
              type="button"
              onClick={() => copyFlightTime("ifrTime")}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-xs text-primary px-2 py-1 rounded bg-primary/10"
            >
              Use {formatHHMMDisplay(calculatedTimes.flightTime)}
            </button>
          )}
        </div>
      </SwipeableRow>
    ),
    actualInstrumentTime: (
      <SwipeableRow label="Actual Inst" onClear={() => clearField("actualInstrumentTime")}>
        <div className="relative w-full">
          <Input
            type="time"
            value={formData.actualInstrumentTime}
            onChange={(e) => updateField("actualInstrumentTime", e.target.value)}
            className={cn(inputClassName, "pr-24")}
            style={{ WebkitAppearance: "none" }}
          />
          {!formData.actualInstrumentTime && (
            <button
              type="button"
              onClick={() => copyFlightTime("actualInstrumentTime")}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-xs text-primary px-2 py-1 rounded bg-primary/10"
            >
              Use {formatHHMMDisplay(calculatedTimes.flightTime)}
            </button>
          )}
        </div>
      </SwipeableRow>
    ),
    simulatedInstrumentTime: (
      <SwipeableRow label="Sim Inst" onClear={() => clearField("simulatedInstrumentTime")}>
        <div className="relative w-full">
          <Input
            type="time"
            value={formData.simulatedInstrumentTime}
            onChange={(e) => updateField("simulatedInstrumentTime", e.target.value)}
            className={cn(inputClassName, "pr-24")}
            style={{ WebkitAppearance: "none" }}
          />
          {!formData.simulatedInstrumentTime && (
            <button
              type="button"
              onClick={() => copyFlightTime("simulatedInstrumentTime")}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-xs text-primary px-2 py-1 rounded bg-primary/10"
            >
              Use {formatHHMMDisplay(calculatedTimes.flightTime)}
            </button>
          )}
        </div>
      </SwipeableRow>
    ),
    picCrewId: (
      <SwipeableRow label="PIC/P1" onClear={() => clearField("picCrewId")}>
        <Select value={formData.picCrewId} onValueChange={(v) => updateField("picCrewId", v)}>
          <SelectTrigger className={cn(inputClassName, "[&>span]:text-right [&>svg]:hidden")}>
            <SelectValue />
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
    ),
    sicCrewId: (
      <SwipeableRow label="SIC/P2" onClear={() => clearField("sicCrewId")}>
        <Select value={formData.sicCrewId} onValueChange={(v) => updateField("sicCrewId", v)}>
          <SelectTrigger className={cn(inputClassName, "[&>span]:text-right [&>svg]:hidden")}>
            <SelectValue />
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
    ),
    observerCrewId: (
      <SwipeableRow label="Observer" onClear={() => clearField("observerCrewId")}>
        <Select value={formData.observerCrewId} onValueChange={(v) => updateField("observerCrewId", v)}>
          <SelectTrigger className={cn(inputClassName, "[&>span]:text-right [&>svg]:hidden")}>
            <SelectValue />
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
    ),
    dayTakeoffs: (
      <SwipeableRow label="Day T/O" onClear={() => clearField("dayTakeoffs", "0")}>
        <Input
          type="number"
          min="0"
          value={formData.dayTakeoffs}
          onChange={(e) => updateField("dayTakeoffs", e.target.value)}
          className={inputClassName}
        />
      </SwipeableRow>
    ),
    dayLandings: (
      <SwipeableRow label="Day Ldg" onClear={() => clearField("dayLandings", "0")}>
        <Input
          type="number"
          min="0"
          value={formData.dayLandings}
          onChange={(e) => updateField("dayLandings", e.target.value)}
          className={inputClassName}
        />
      </SwipeableRow>
    ),
    nightTakeoffs: (
      <SwipeableRow label="Night T/O" onClear={() => clearField("nightTakeoffs", "0")}>
        <Input
          type="number"
          min="0"
          value={formData.nightTakeoffs}
          onChange={(e) => updateField("nightTakeoffs", e.target.value)}
          className={inputClassName}
        />
      </SwipeableRow>
    ),
    nightLandings: (
      <SwipeableRow label="Night Ldg" onClear={() => clearField("nightLandings", "0")}>
        <Input
          type="number"
          min="0"
          value={formData.nightLandings}
          onChange={(e) => updateField("nightLandings", e.target.value)}
          className={inputClassName}
        />
      </SwipeableRow>
    ),
    autolands: (
      <SwipeableRow label="Autolands" onClear={() => clearField("autolands", "0")}>
        <Input
          type="number"
          min="0"
          value={formData.autolands}
          onChange={(e) => updateField("autolands", e.target.value)}
          className={inputClassName}
        />
      </SwipeableRow>
    ),
    approach1: (
      <SwipeableRow label="App 1" onClear={() => clearField("approach1")}>
        <Input
          placeholder="ILS 20C"
          value={formData.approach1}
          onChange={(e) => updateField("approach1", e.target.value)}
          className={inputClassName}
        />
      </SwipeableRow>
    ),
    approach2: (
      <SwipeableRow label="App 2" onClear={() => clearField("approach2")}>
        <Input
          placeholder="VOR 02L"
          value={formData.approach2}
          onChange={(e) => updateField("approach2", e.target.value)}
          className={inputClassName}
        />
      </SwipeableRow>
    ),
    holds: (
      <SwipeableRow label="Holds" onClear={() => clearField("holds", "0")}>
        <Input
          type="number"
          min="0"
          value={formData.holds}
          onChange={(e) => updateField("holds", e.target.value)}
          className={inputClassName}
        />
      </SwipeableRow>
    ),
    remarks: (
      <SwipeableRow label="Remarks" onClear={() => clearField("remarks")}>
        <Textarea
          value={formData.remarks}
          onChange={(e) => updateField("remarks", e.target.value)}
          className={cn(inputClassName, "min-h-20 resize-none")}
          placeholder="Additional notes..."
        />
      </SwipeableRow>
    ),
    ipcIcc: (
      <SwipeableRow label="IPC/ICC" showClear={false}>
        <div className="flex items-center gap-2 justify-end">
          <span className="text-sm text-muted-foreground">{formData.ipcIcc ? "Yes" : "No"}</span>
          <Switch checked={formData.ipcIcc} onCheckedChange={(checked) => updateField("ipcIcc", checked)} />
        </div>
      </SwipeableRow>
    ),
  }

  const allFieldComponents: Record<string, React.ReactNode> = {
    // Section A - Flight
    date: fieldComponents.date,
    flightNumber: fieldComponents.flightNumber,
    aircraftId: fieldComponents.aircraftId,
    departureIcao: fieldComponents.departureIcao,
    arrivalIcao: fieldComponents.arrivalIcao,
    outTime: fieldComponents.outTime,
    offTime: fieldComponents.offTime,
    onTime: fieldComponents.onTime,
    inTime: fieldComponents.inTime,

    // Section B - Time (add to existing)
    total: (
      <SwipeableRow
        label="Total"
        onClear={() => {
          setCalculatedTimes((prev) => ({ ...prev, blockTime: "00:00" }))
        }}
      >
        <Input
          type="time"
          value={calculatedTimes.blockTime}
          onChange={(e) => setCalculatedTimes((prev) => ({ ...prev, blockTime: e.target.value }))}
          className={cn(inputClassName, "font-mono font-semibold")}
          style={{ WebkitAppearance: "none" }}
        />
      </SwipeableRow>
    ),
    night: (
      <SwipeableRow
        label="Night"
        onClear={() => {
          setCalculatedTimes((prev) => ({ ...prev, nightTime: "00:00" }))
        }}
      >
        <Input
          type="time"
          value={calculatedTimes.nightTime}
          onChange={(e) => setCalculatedTimes((prev) => ({ ...prev, nightTime: e.target.value }))}
          className={cn(inputClassName, "font-mono")}
          style={{ WebkitAppearance: "none" }}
        />
      </SwipeableRow>
    ),
    p1us: (
      <SwipeableRow
        label="P1 U/S"
        onClear={() => {
          setCalculatedTimes((prev) => ({ ...prev, p1usTime: "00:00" }))
        }}
      >
        <Input
          type="time"
          value={calculatedTimes.p1usTime}
          onChange={(e) => setCalculatedTimes((prev) => ({ ...prev, p1usTime: e.target.value }))}
          className={cn(inputClassName, "font-mono")}
          style={{ WebkitAppearance: "none" }}
        />
      </SwipeableRow>
    ),
    sicTime: (
      <SwipeableRow
        label="SIC"
        onClear={() => {
          setCalculatedTimes((prev) => ({ ...prev, p2Time: "00:00" }))
        }}
      >
        <Input
          type="time"
          value={calculatedTimes.p2Time}
          onChange={(e) => setCalculatedTimes((prev) => ({ ...prev, p2Time: e.target.value }))}
          className={cn(inputClassName, "font-mono")}
          style={{ WebkitAppearance: "none" }}
        />
      </SwipeableRow>
    ),
    xc: fieldComponents.crossCountryTime,
    ifr: fieldComponents.ifrTime,
    actualInst: fieldComponents.actualInstrumentTime,
    simInst: fieldComponents.simulatedInstrumentTime,

    // Section C - Crew
    pf: (
      <SwipeableRow label="PF" showClear={false}>
        <div className="flex items-center gap-2 justify-end">
          <span className="text-sm text-muted-foreground">{formData.isPilotFlying ? "Yes" : "No"}</span>
          <Switch
            checked={formData.isPilotFlying}
            onCheckedChange={(checked) => updateField("isPilotFlying", checked)}
            disabled={pfDisabled}
          />
        </div>
      </SwipeableRow>
    ),
    picCrew: fieldComponents.picCrewId,
    sicCrew: fieldComponents.sicCrewId,
    observer: fieldComponents.observerCrewId,

    // Section D - Landings
    dayTO: fieldComponents.dayTakeoffs,
    dayLdg: fieldComponents.dayLandings,
    nightTO: fieldComponents.nightTakeoffs,
    nightLdg: fieldComponents.nightLandings,
    autolands: fieldComponents.autolands,

    // Section E - Approaches
    app1: fieldComponents.approach1,
    app2: fieldComponents.approach2,
    holds: fieldComponents.holds,

    // Section F - Notes
    remarks: fieldComponents.remarks,
    ipcIcc: fieldComponents.ipcIcc,
  }

  const renderField = (section: string, fieldKey: string) => (
    <div
      key={fieldKey}
      draggable={editingFlight}
      onDragStart={() => handleDragStart(section, fieldKey)}
      onDragOver={(e) => handleDragOver(e, section, fieldKey)}
      onDragEnd={handleDragEnd}
      onTouchStart={(e) => handleTouchStartConfig(e, section, fieldKey)}
      onTouchMove={(e) => handleTouchMoveConfig(e, section, fieldKey)}
      onTouchEnd={handleTouchEndConfig}
      className={cn(
        "relative transition-all duration-150",
        editingFlight && "cursor-grab active:cursor-grabbing",
        touchDragState?.field === fieldKey && isDraggingTouch && "opacity-60 scale-[0.98]",
        draggedField?.field === fieldKey && "opacity-60 scale-[0.98]",
      )}
      style={{
        touchAction: editingFlight ? "none" : "auto",
        userSelect: editingFlight ? "none" : "auto",
        WebkitUserSelect: editingFlight ? "none" : "auto",
      }}
    >
      {editingFlight && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center w-10 h-full z-30 pointer-events-none">
          <div className="flex flex-col gap-1 bg-secondary/95 rounded-md p-2 shadow-sm border border-border">
            <div className="w-5 h-0.5 bg-foreground/50 rounded-full" />
            <div className="w-5 h-0.5 bg-foreground/50 rounded-full" />
            <div className="w-5 h-0.5 bg-foreground/50 rounded-full" />
          </div>
        </div>
      )}
      <div className={cn(editingFlight && "pr-12")}>{allFieldComponents[fieldKey]}</div>
    </div>
  )

  const migrateFieldKeys = (oldOrders: typeof fieldOrders): typeof fieldOrders => {
    const keyMap: Record<string, string> = {
      // Flight section
      aircraft: "aircraftId",
      from: "departureIcao",
      to: "arrivalIcao",
      out: "outTime",
      off: "offTime",
      on: "onTime",
      in: "inTime",
      // Time section
      sic: "sicTime",
      // Crew section
      pic: "picCrew",
      sic: "sicCrew",
      // Landings section (already correct)
      // Approaches section (already correct)
      // Notes section (already correct)
    }

    const migrateArray = (arr: string[]): string[] => {
      return arr.map((key) => keyMap[key] || key).filter((key) => allFieldComponents[key] !== undefined)
    }

    return {
      flight: migrateArray(oldOrders.flight || []),
      time: migrateArray(oldOrders.time || []),
      crew: migrateArray(oldOrders.crew || []),
      landings: migrateArray(oldOrders.landings || []),
      approaches: migrateArray(oldOrders.approaches || []),
      notes: migrateArray(oldOrders.notes || []),
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-card rounded-lg border border-border">
      <div className="border-b border-border p-3 flex items-center justify-between">
        <h2 className="text-xl font-semibold">{editingFlight ? "Edit Flight" : "New Entry"}</h2>
        <div className="flex items-center gap-2">
          {editingFlight && (
            <Button type="button" variant="ghost" size="sm" onClick={swapCrew} className="h-7 text-xs gap-1 px-2">
              <ArrowLeftRight className="h-3 w-3" />
              Swap PIC/SIC
            </Button>
          )}
          {onClose && (
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
          )}
          <Button type="submit" size="sm" disabled={isSubmitting}>
            <Save className="h-4 w-4 mr-1" />
            {isSubmitting ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <div className="p-3 space-y-1">
        {/* A) Flight Section */}
        <div>
          <SectionHeader title="FLIGHT" />
          {fieldOrders.flight.map((fieldKey) => renderField("flight", fieldKey))}
        </div>

        {/* B) Time Section */}
        <div>
          <SectionHeader title="TIME" />
          {fieldOrders.time.map((fieldKey) => renderField("time", fieldKey))}
        </div>

        {/* C) Crew Section */}
        <div>
          <SectionHeader title="CREW" />
          {fieldOrders.crew.map((fieldKey) => renderField("crew", fieldKey))}
        </div>

        {/* D) Landings Section */}
        <div>
          <SectionHeader title="LANDINGS" />
          {fieldOrders.landings.map((fieldKey) => renderField("landings", fieldKey))}
        </div>

        {/* E) App and Hold Section */}
        <div>
          <SectionHeader title="APP AND HOLD" />
          {fieldOrders.approaches.map((fieldKey) => renderField("approaches", fieldKey))}
        </div>

        {/* F) Notes Section */}
        <div>
          <SectionHeader title="NOTES" />
          {fieldOrders.notes.map((fieldKey) => renderField("notes", fieldKey))}
        </div>
      </div>
    </form>
  )
}
