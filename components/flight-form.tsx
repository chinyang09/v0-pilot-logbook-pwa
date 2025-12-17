"use client"

import type React from "react"
import type { FlightLog } from "@/lib/indexed-db"
import { useState, useEffect, useMemo, useCallback } from "react"
import { addFlight, updateFlight, addRecentlyUsedAirport, addRecentlyUsedAircraft } from "@/lib/indexed-db"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useAirportDatabase } from "@/hooks/use-indexed-db"
import { getAirportByICAO } from "@/lib/airport-database"
import { calculateTimesFromOOOI, isNight } from "@/lib/night-time-calculator"
import { Plane, ArrowLeft, Loader2, ChevronRight, Info } from "lucide-react"

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
  pilotFlying: boolean
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
  pilotFlying: true,
}

function SettingsRow({
  label,
  value,
  secondaryValue,
  secondaryLabel,
  onChange,
  onSecondaryChange,
  placeholder,
  type = "text",
  readOnly = false,
  onClick,
  showChevron = false,
  showInfo = false,
  icon,
  highlight = false,
}: {
  label: string
  value: string
  secondaryValue?: string
  secondaryLabel?: string
  onChange?: (value: string) => void
  onSecondaryChange?: (value: string) => void
  placeholder?: string
  type?: string
  readOnly?: boolean
  onClick?: () => void
  showChevron?: boolean
  showInfo?: boolean
  icon?: React.ReactNode
  highlight?: boolean
}) {
  const content = (
    <div
      className={`flex items-center justify-between py-3 border-b border-border last:border-b-0 ${onClick ? "cursor-pointer active:bg-muted/50" : ""}`}
    >
      <div className="flex items-center gap-2">
        {icon && <span className="text-primary">{icon}</span>}
        <span className="text-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {secondaryValue !== undefined ? (
          // Dual time display (UTC + Local)
          <div className="flex items-center gap-3">
            <div className="text-right">
              <Input
                type={type}
                value={value}
                onChange={(e) => onChange?.(e.target.value)}
                placeholder={placeholder || "UTC"}
                className="text-right border-0 bg-transparent h-auto p-0 w-16 text-foreground font-medium focus-visible:ring-0"
                readOnly={readOnly}
              />
              <span className="text-xs text-muted-foreground">UTC</span>
            </div>
            <div className="text-right">
              <span className="text-foreground font-medium">{secondaryValue || "--:--"}</span>
              <span className="text-xs text-muted-foreground block">{secondaryLabel || "Local"}</span>
            </div>
          </div>
        ) : readOnly || onClick ? (
          <span className={`${highlight ? "text-foreground font-medium" : "text-muted-foreground"}`}>
            {value || placeholder || "-"}
          </span>
        ) : (
          <Input
            type={type}
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            placeholder={placeholder}
            className="text-right border-0 bg-transparent h-auto p-0 w-auto max-w-[200px] text-muted-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0"
          />
        )}
        {showInfo && <Info className="h-4 w-4 text-primary" />}
        {showChevron && <ChevronRight className="h-5 w-5 text-muted-foreground/50" />}
      </div>
    </div>
  )

  return onClick ? <div onClick={onClick}>{content}</div> : content
}

function TimeRow({
  label,
  value,
  onUseTime,
  useLabel,
  secondaryValue,
  secondaryLabel,
}: {
  label: string
  value: string
  onUseTime?: () => void
  useLabel?: string
  secondaryValue?: string
  secondaryLabel?: string
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-b-0">
      <span className="text-foreground">{label}</span>
      <div className="flex items-center gap-3">
        {secondaryValue !== undefined ? (
          <>
            <span className="text-foreground font-medium">{value || "0:00"}</span>
            <span className="text-muted-foreground">
              {secondaryLabel} {secondaryValue || "0:00"}
            </span>
          </>
        ) : onUseTime ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onUseTime}
            className="h-7 px-2 text-xs border-primary text-primary hover:bg-primary/10 bg-transparent"
          >
            {useLabel || `USE ${value}`}
          </Button>
        ) : (
          <span className="text-foreground font-medium">{value || "0:00"}</span>
        )}
      </div>
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  onCheckedChange?: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-b-0">
      <span className="text-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function NowButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      className="h-7 px-2 text-xs border-primary text-primary hover:bg-primary/10 bg-transparent"
    >
      NOW
    </Button>
  )
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
  const [isSubmitting, setIsSubmitting] = useState(false)

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
        pilotFlying: editingFlight.pilotRole === "PF",
      })
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

  // Handle crew selection from picker
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

    if (depAirport?.latitude && depAirport?.longitude) {
      const isNightTO = isNight(formData.date, formData.offTime, depAirport.latitude, depAirport.longitude)
      setFormData((prev) => ({
        ...prev,
        nightTakeoffs: isNightTO ? 1 : 0,
        dayTakeoffs: isNightTO ? 0 : 1,
      }))
    }

    if (arrAirport?.latitude && arrAirport?.longitude) {
      const isNightLdg = isNight(formData.date, formData.onTime, arrAirport.latitude, arrAirport.longitude)
      setFormData((prev) => ({
        ...prev,
        nightLandings: isNightLdg ? 1 : 0,
        dayLandings: isNightLdg ? 0 : 1,
      }))
    }
  }, [formData.date, formData.offTime, formData.onTime, formData.departureIcao, formData.arrivalIcao, airports])

  const updateField = useCallback((field: keyof FormData, value: string | number | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }, [])

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

  const setNowTime = (field: "scheduledOut" | "scheduledIn" | "outTime" | "offTime" | "onTime" | "inTime") => {
    const now = new Date()
    const utcTime = `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`
    updateField(field, utcTime)
  }

  // Format date for display
  const formatDateDisplay = (dateStr: string) => {
    if (!dateStr) return ""
    const date = new Date(dateStr)
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return `${days[date.getDay()]} ${date.getDate()}-${months[date.getMonth()]}-${String(date.getFullYear()).slice(-2)}`
  }

  // Convert UTC time to local display
  const getLocalTime = (utcTime: string, tzOffset = 8) => {
    if (!utcTime || utcTime.length < 4) return "--:--"
    const hours = Number.parseInt(utcTime.slice(0, 2), 10)
    const mins = utcTime.slice(2, 4)
    const localHours = (hours + tzOffset + 24) % 24
    return `${String(localHours).padStart(2, "0")}${mins}`
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
      const pilotRole = formData.pilotFlying ? "PF" : "PM"

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
        pilotRole: pilotRole,
        picTime: pilotRole === "PF" ? calculatedTimes.flightTime || "00:00" : "00:00",
        sicTime: pilotRole === "PM" ? calculatedTimes.flightTime || "00:00" : "00:00",
        picusTime: formData.pilotRole === "STUDENT" ? calculatedTimes.flightTime || "00:00" : "00:00",
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

  // Calculate day/night time display
  const dayTime = useMemo(() => {
    if (!calculatedTimes.flightTime || !calculatedTimes.nightTime) return "0:00"
    const flightMins = parseTimeToMinutes(calculatedTimes.flightTime)
    const nightMins = parseTimeToMinutes(calculatedTimes.nightTime)
    const dayMins = Math.max(0, flightMins - nightMins)
    return formatMinutesToTime(dayMins)
  }, [calculatedTimes.flightTime, calculatedTimes.nightTime])

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-b border-border">
        <div className="container mx-auto px-3">
          <div className="flex items-center justify-between h-12">
            <Button variant="ghost" size="sm" onClick={handleCancel} className="text-primary h-8 px-2">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-lg font-semibold">{editingFlight ? "Edit Flight" : "New Flight"}</h1>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="text-primary h-8 px-2 font-semibold"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>
      </div>

      <main className="container mx-auto px-3 pt-16 pb-20">
        <form onSubmit={handleSubmit}>
          {/* FLIGHT Section */}
          <div className="mb-2">
            <span className="text-xs text-muted-foreground uppercase tracking-wider px-4">Flight</span>
          </div>
          <div className="bg-card rounded-xl overflow-hidden mb-6">
            <div className="px-4">
              {/* Flight row with icon */}
              <SettingsRow
                label="Flight"
                value=""
                icon={<Plane className="h-4 w-4 rotate-45" />}
                showChevron
                readOnly
              />

              {/* Date */}
              <div className="flex items-center justify-between py-3 border-b border-border">
                <span className="text-foreground">Date</span>
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={formData.date}
                    onChange={(e) => updateField("date", e.target.value)}
                    className="text-right border-0 bg-transparent h-auto p-0 w-auto text-foreground font-medium focus-visible:ring-0"
                  />
                  <span className="text-xs text-muted-foreground">UTC</span>
                </div>
              </div>

              {/* Flight # */}
              <SettingsRow
                label="Flight #"
                value={formData.flightNumber}
                onChange={(v) => updateField("flightNumber", v.toUpperCase())}
                placeholder="SQ123"
              />

              {/* Aircraft ID */}
              <SettingsRow
                label="Aircraft ID"
                value={formData.aircraftReg}
                onClick={openAircraftPicker}
                showInfo
                showChevron
                readOnly
                highlight={!!formData.aircraftReg}
              />

              {/* Aircraft Type */}
              <SettingsRow
                label="Aircraft Type"
                value={formData.aircraftType}
                onClick={openAircraftPicker}
                showInfo
                showChevron
                readOnly
                highlight={!!formData.aircraftType}
              />

              {/* From */}
              <SettingsRow
                label="From"
                value={formData.departureIcao}
                onClick={() => openAirportPicker("departureIcao")}
                showInfo
                showChevron
                readOnly
                highlight={!!formData.departureIcao}
              />

              {/* To */}
              <SettingsRow
                label="To"
                value={formData.arrivalIcao}
                onClick={() => openAirportPicker("arrivalIcao")}
                showInfo
                showChevron
                readOnly
                highlight={!!formData.arrivalIcao}
              />

              {/* Scheduled Out */}
              <div className="flex items-center justify-between py-3 border-b border-border">
                <span className="text-foreground">Scheduled Out</span>
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    value={formData.scheduledOut}
                    onChange={(e) => updateField("scheduledOut", e.target.value)}
                    placeholder="HHMM"
                    maxLength={4}
                    className="text-right border-0 bg-transparent h-auto p-0 w-14 text-foreground focus-visible:ring-0"
                  />
                  <span className="text-xs text-muted-foreground">UTC</span>
                  <NowButton onClick={() => setNowTime("scheduledOut")} />
                  <span className="text-xs text-muted-foreground">
                    {getLocalTime(formData.scheduledOut)}
                    <br />
                    SGT
                  </span>
                </div>
              </div>

              {/* Scheduled In */}
              <div className="flex items-center justify-between py-3 border-b border-border">
                <span className="text-foreground">Scheduled In</span>
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    value={formData.scheduledIn}
                    onChange={(e) => updateField("scheduledIn", e.target.value)}
                    placeholder="HHMM"
                    maxLength={4}
                    className="text-right border-0 bg-transparent h-auto p-0 w-14 text-foreground focus-visible:ring-0"
                  />
                  <span className="text-xs text-muted-foreground">UTC</span>
                  <NowButton onClick={() => setNowTime("scheduledIn")} />
                  <span className="text-xs text-muted-foreground">
                    {getLocalTime(formData.scheduledIn)}
                    <br />
                    SGT
                  </span>
                </div>
              </div>

              {/* Out */}
              <div className="flex items-center justify-between py-3 border-b border-border">
                <span className="text-foreground">Out</span>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <Input
                      type="text"
                      value={formData.outTime}
                      onChange={(e) => updateField("outTime", e.target.value)}
                      placeholder="HHMM"
                      maxLength={4}
                      className="text-right border-0 bg-transparent h-auto p-0 w-14 text-foreground font-medium focus-visible:ring-0"
                    />
                    <span className="text-xs text-muted-foreground">UTC</span>
                  </div>
                  <div className="text-right">
                    <span className="text-foreground font-medium">{getLocalTime(formData.outTime)}</span>
                    <span className="text-xs text-muted-foreground block">SGT</span>
                  </div>
                </div>
              </div>

              {/* Off */}
              <div className="flex items-center justify-between py-3 border-b border-border">
                <span className="text-foreground">Off</span>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <Input
                      type="text"
                      value={formData.offTime}
                      onChange={(e) => updateField("offTime", e.target.value)}
                      placeholder="HHMM"
                      maxLength={4}
                      className="text-right border-0 bg-transparent h-auto p-0 w-14 text-foreground font-medium focus-visible:ring-0"
                    />
                    <span className="text-xs text-muted-foreground">UTC</span>
                  </div>
                  <div className="text-right">
                    <span className="text-foreground font-medium">{getLocalTime(formData.offTime)}</span>
                    <span className="text-xs text-muted-foreground block">SGT</span>
                  </div>
                </div>
              </div>

              {/* On */}
              <div className="flex items-center justify-between py-3 border-b border-border">
                <span className="text-foreground">On</span>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <Input
                      type="text"
                      value={formData.onTime}
                      onChange={(e) => updateField("onTime", e.target.value)}
                      placeholder="HHMM"
                      maxLength={4}
                      className="text-right border-0 bg-transparent h-auto p-0 w-14 text-foreground font-medium focus-visible:ring-0"
                    />
                    <span className="text-xs text-muted-foreground">UTC</span>
                  </div>
                  <div className="text-right">
                    <span className="text-foreground font-medium">{getLocalTime(formData.onTime)}</span>
                    <span className="text-xs text-muted-foreground block">SGT</span>
                  </div>
                </div>
              </div>

              {/* In */}
              <div className="flex items-center justify-between py-3">
                <span className="text-foreground">In</span>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <Input
                      type="text"
                      value={formData.inTime}
                      onChange={(e) => updateField("inTime", e.target.value)}
                      placeholder="HHMM"
                      maxLength={4}
                      className="text-right border-0 bg-transparent h-auto p-0 w-14 text-foreground font-medium focus-visible:ring-0"
                    />
                    <span className="text-xs text-muted-foreground">UTC</span>
                  </div>
                  <div className="text-right">
                    <span className="text-foreground font-medium">{getLocalTime(formData.inTime)}</span>
                    <span className="text-xs text-muted-foreground block">SGT</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* CREW Section */}
          <div className="mb-2">
            <span className="text-xs text-muted-foreground uppercase tracking-wider px-4">Crew</span>
          </div>
          <div className="bg-card rounded-xl overflow-hidden mb-6">
            <div className="px-4">
              <SettingsRow
                label="PIC / P1"
                value={formData.picName || "Select"}
                onClick={() => openCrewPicker("picId")}
                showChevron
                readOnly
                highlight={!!formData.picName}
              />
              <SettingsRow
                label="SIC / P2"
                value={formData.sicName || "Select"}
                onClick={() => openCrewPicker("sicId")}
                showChevron
                readOnly
                highlight={!!formData.sicName}
              />
              <SettingsRow
                label="Other Crew"
                value={formData.otherCrew}
                onChange={(v) => updateField("otherCrew", v)}
                placeholder="Additional crew"
              />
            </div>
          </div>

          {/* TIME Section */}
          <div className="mb-2">
            <span className="text-xs text-muted-foreground uppercase tracking-wider px-4">Time</span>
          </div>
          <div className="bg-card rounded-xl overflow-hidden mb-6">
            <div className="px-4">
              <TimeRow label="Total Time" value={formatTime(calculatedTimes.flightTime)} />
              <TimeRow
                label="Night"
                value={formatTime(calculatedTimes.nightTime)}
                secondaryValue={dayTime}
                secondaryLabel="Day"
              />
              <TimeRow
                label="P1u/s"
                value={formatTime(calculatedTimes.flightTime)}
                onUseTime={() => updateField("manualNightTime", calculatedTimes.flightTime || "00:00")}
                useLabel={`USE ${formatTime(calculatedTimes.flightTime)}`}
              />
              <TimeRow label="SIC" value={formData.pilotFlying ? "0:00" : formatTime(calculatedTimes.flightTime)} />
              <TimeRow label="XC" value={formatTime(formData.crossCountryTime)} />
              <TimeRow
                label="Actual Inst"
                value={formatTime(formData.actualInstrumentTime)}
                onUseTime={() => updateField("actualInstrumentTime", calculatedTimes.flightTime || "00:00")}
                useLabel={`USE ${formatTime(calculatedTimes.flightTime)}`}
              />
              <TimeRow label="IFR" value={formatTime(formData.ifrTime)} />
              <TimeRow
                label="Simulator"
                value={formatTime(formData.simulatedInstrumentTime)}
                onUseTime={() => updateField("simulatedInstrumentTime", calculatedTimes.flightTime || "00:00")}
                useLabel={`USE ${formatTime(calculatedTimes.flightTime)}`}
              />
            </div>
          </div>

          {/* DUTY Section */}
          <div className="mb-2">
            <span className="text-xs text-muted-foreground uppercase tracking-wider px-4">Duty</span>
          </div>
          <div className="bg-card rounded-xl overflow-hidden mb-6">
            <div className="px-4">
              <ToggleRow
                label="Pilot Flying"
                checked={formData.pilotFlying}
                onCheckedChange={(checked) => updateField("pilotFlying", checked)}
              />
            </div>
          </div>

          {/* LANDINGS Section */}
          <div className="mb-2">
            <span className="text-xs text-muted-foreground uppercase tracking-wider px-4">Landings</span>
          </div>
          <div className="bg-card rounded-xl overflow-hidden mb-6">
            <div className="px-4">
              <div className="flex items-center justify-between py-3 border-b border-border">
                <span className="text-foreground">Day T/O</span>
                <Input
                  type="number"
                  value={formData.dayTakeoffs}
                  onChange={(e) => updateField("dayTakeoffs", Number.parseInt(e.target.value) || 0)}
                  className="text-right border-0 bg-transparent h-auto p-0 w-16 text-foreground font-medium focus-visible:ring-0"
                />
              </div>
              <div className="flex items-center justify-between py-3 border-b border-border">
                <span className="text-foreground">Day Ldg</span>
                <Input
                  type="number"
                  value={formData.dayLandings}
                  onChange={(e) => updateField("dayLandings", Number.parseInt(e.target.value) || 0)}
                  className="text-right border-0 bg-transparent h-auto p-0 w-16 text-foreground font-medium focus-visible:ring-0"
                />
              </div>
              <div className="flex items-center justify-between py-3 border-b border-border">
                <span className="text-foreground">Night T/O</span>
                <Input
                  type="number"
                  value={formData.nightTakeoffs}
                  onChange={(e) => updateField("nightTakeoffs", Number.parseInt(e.target.value) || 0)}
                  className="text-right border-0 bg-transparent h-auto p-0 w-16 text-foreground font-medium focus-visible:ring-0"
                />
              </div>
              <div className="flex items-center justify-between py-3 border-b border-border">
                <span className="text-foreground">Night Ldg</span>
                <Input
                  type="number"
                  value={formData.nightLandings}
                  onChange={(e) => updateField("nightLandings", Number.parseInt(e.target.value) || 0)}
                  className="text-right border-0 bg-transparent h-auto p-0 w-16 text-foreground font-medium focus-visible:ring-0"
                />
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="text-foreground">Autolands</span>
                <Input
                  type="number"
                  value={formData.autolands}
                  onChange={(e) => updateField("autolands", Number.parseInt(e.target.value) || 0)}
                  className="text-right border-0 bg-transparent h-auto p-0 w-16 text-foreground font-medium focus-visible:ring-0"
                />
              </div>
            </div>
          </div>

          {/* REMARKS Section */}
          <div className="mb-2">
            <span className="text-xs text-muted-foreground uppercase tracking-wider px-4">Remarks</span>
          </div>
          <div className="bg-card rounded-xl overflow-hidden mb-6">
            <div className="px-4">
              <SettingsRow
                label="Remarks"
                value={formData.remarks}
                onChange={(v) => updateField("remarks", v)}
                placeholder="Add remarks"
              />
              <SettingsRow
                label="Endorsements"
                value={formData.endorsements}
                onChange={(v) => updateField("endorsements", v)}
                placeholder="Add endorsements"
              />
            </div>
          </div>
        </form>
      </main>
    </div>
  )
}

// Helper functions
function parseTimeToMinutes(time: string): number {
  if (!time) return 0
  const parts = time.split(":")
  if (parts.length !== 2) return 0
  return Number.parseInt(parts[0], 10) * 60 + Number.parseInt(parts[1], 10)
}

function formatMinutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}:${String(m).padStart(2, "0")}`
}

function formatTime(time: string | undefined): string {
  if (!time) return "0:00"
  if (time.includes(":")) {
    const [h, m] = time.split(":")
    return `${Number.parseInt(h, 10)}:${m}`
  }
  return time
}
