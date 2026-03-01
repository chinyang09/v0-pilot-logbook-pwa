"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  addCustomAircraftToDatabase,
  type NormalizedAircraft,
} from "@/lib/db/stores/reference/aircraft.store"
import { Loader2, ChevronLeft } from "lucide-react"
import { submitAircraftToServer } from "@/lib/submissions/submit"
import { getAircraftType, searchAircraftTypes } from "@/lib/db/stores/reference/aircraft-types.store"
import type { AircraftType } from "@/types/entities/aircraft-type.types"
import { formatAircraftType } from "@/lib/utils/aircraft-type-utils"

function SettingsRow({
  label,
  value,
  onChange,
  placeholder,
  readOnly = false,
}: {
  label: string
  value: string
  onChange?: (value: string) => void
  placeholder?: string
  readOnly?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-b-0">
      <span className="text-foreground">{label}</span>
      {readOnly ? (
        <span className="text-muted-foreground">{value || "-"}</span>
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          className="text-right border-0 bg-transparent h-auto p-0 w-auto max-w-[200px] text-muted-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0 uppercase"
        />
      )}
    </div>
  )
}

interface AircraftDetailPanelProps {
  /** Aircraft data from the parent's SWR hook (reactive) */
  aircraft: NormalizedAircraft
  /** Called after saving changes — parent should refresh SWR cache */
  onUpdated?: () => void
  /** Called when back button is pressed (mobile overlay dismiss) */
  onBack?: () => void
}

export function AircraftDetailPanel({ aircraft, onUpdated, onBack }: AircraftDetailPanelProps) {
  const [typeInfo, setTypeInfo] = useState<AircraftType | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const [formData, setFormData] = useState({
    registration: aircraft.registration,
    typecode: aircraft.typecode || "",
    icao24: aircraft.icao24 || "",
    operator: aircraft.operator || "",
  })

  const [typeSearchQuery, setTypeSearchQuery] = useState("")
  const [typeSearchResults, setTypeSearchResults] = useState<AircraftType[]>([])
  const [selectedType, setSelectedType] = useState<AircraftType | null>(null)
  const [showTypeSearch, setShowTypeSearch] = useState(false)

  // Update form data from props when not editing (reactive from SWR)
  useEffect(() => {
    if (!isEditing) {
      setFormData({
        registration: aircraft.registration,
        typecode: aircraft.typecode || "",
        icao24: aircraft.icao24 || "",
        operator: aircraft.operator || "",
      })
    }
  }, [aircraft, isEditing])

  // Look up ICAO type info from Dexie
  useEffect(() => {
    const typecode = aircraft.typecode
    if (typecode) {
      getAircraftType(typecode).then(setTypeInfo)
    } else {
      setTypeInfo(null)
    }
  }, [aircraft.typecode])

  const updateField = useCallback(
    (field: string, value: string) => {
      setFormData((prev) => ({ ...prev, [field]: value }))
    },
    []
  )

  useEffect(() => {
    if (!typeSearchQuery || typeSearchQuery.length < 1) {
      setTypeSearchResults([])
      return
    }
    const search = async () => {
      const results = await searchAircraftTypes(typeSearchQuery, 20)
      setTypeSearchResults(results)
    }
    const timer = setTimeout(search, 200)
    return () => clearTimeout(timer)
  }, [typeSearchQuery])

  const handleSelectType = useCallback((type: AircraftType) => {
    setSelectedType(type)
    setFormData((prev) => ({ ...prev, typecode: type.designator }))
    setShowTypeSearch(false)
    setTypeSearchQuery("")
    setTypeSearchResults([])
  }, [])

  const handleSave = async () => {
    if (!formData.registration.trim()) return

    setIsSaving(true)
    try {
      const finalTypeInfo = selectedType || typeInfo
      const submissionId = await addCustomAircraftToDatabase({
        registration: formData.registration.trim().toUpperCase(),
        icao24: formData.icao24.trim(),
        typecode: formData.typecode.trim().toUpperCase(),
        operator: formData.operator.trim(),
        shortDescription: finalTypeInfo?.description || aircraft.shortDescription || "",
        wtc: finalTypeInfo?.wtc || aircraft.wtc || "",
        wtg: finalTypeInfo?.wtg || aircraft.wtg || "",
        manufacturerCode: finalTypeInfo?.manufacturer || aircraft.manufacturerCode || "",
        source: "fr24",
      })

      submitAircraftToServer({
        submissionId,
        registration: formData.registration.trim().toUpperCase(),
        typecode: formData.typecode.trim().toUpperCase(),
        icao24: formData.icao24.trim(),
        operator: formData.operator.trim(),
      })

      setSelectedType(null)
      setIsEditing(false)
      onUpdated?.()
    } catch (error) {
      console.error("Failed to save aircraft:", error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setFormData({
      registration: aircraft.registration,
      typecode: aircraft.typecode || "",
      icao24: aircraft.icao24 || "",
      operator: aircraft.operator || "",
    })
    setSelectedType(null)
    setIsEditing(false)
  }

  const displayType = selectedType || typeInfo

  return (
    <div className="h-full relative flex flex-col">
      <header className="absolute top-0 left-0 right-0 z-50 bg-background/30 backdrop-blur-xl border-b border-border/50">
        <div className="px-4 h-12 flex items-center justify-between">
          {isEditing ? (
            <Button variant="ghost" size="sm" onClick={handleCancel} className="text-primary h-8 px-2">
              Cancel
            </Button>
          ) : onBack ? (
            <Button variant="ghost" size="icon-sm" onClick={onBack} className="lg:hidden">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          ) : (
            <span />
          )}
          <h1 className="text-lg font-semibold truncate px-2">
            {formData.registration || "Aircraft"}
            {formData.typecode && (
              <span className="text-muted-foreground text-sm ml-1">({formData.typecode})</span>
            )}
          </h1>
          {isEditing ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSave}
              disabled={!formData.registration.trim() || isSaving}
              className="text-primary h-8 px-2 font-semibold"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsEditing(true)}
              className="text-primary h-8 px-2 font-semibold"
            >
              Edit
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pt-12">
        <div className="px-4 pt-4 pb-safe">
          <div className="bg-card rounded-xl overflow-hidden mb-6 border border-border">
            <div className="px-4">
              <SettingsRow
                label="Registration"
                value={formData.registration}
                onChange={(value) => updateField("registration", value)}
                placeholder="e.g. 9V-TNK"
                readOnly={!isEditing}
              />

              {isEditing ? (
                <div className="py-3 border-b border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-foreground">Type Code</span>
                    <Input
                      value={formData.typecode}
                      onChange={(e) => {
                        const val = e.target.value.toUpperCase()
                        updateField("typecode", val)
                        setTypeSearchQuery(val)
                        setShowTypeSearch(true)
                        if (!val) setSelectedType(null)
                      }}
                      onFocus={() => {
                        if (formData.typecode) {
                          setTypeSearchQuery(formData.typecode)
                          setShowTypeSearch(true)
                        }
                      }}
                      placeholder="e.g. A359"
                      className="text-right border-0 bg-transparent h-auto p-0 w-auto max-w-[150px] text-muted-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0 uppercase"
                    />
                  </div>
                  {showTypeSearch && typeSearchResults.length > 0 && (
                    <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border bg-background">
                      {typeSearchResults.map((type) => (
                        <button
                          key={type.designator}
                          type="button"
                          onClick={() => handleSelectType(type)}
                          className="w-full text-left px-3 py-2 hover:bg-accent border-b border-border last:border-b-0 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-foreground">{type.designator}</span>
                            <span className="text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded">{type.description}</span>
                            {type.wtc && <span className="text-xs text-muted-foreground">WTC:{type.wtc}</span>}
                            {type.wtg && <span className="text-xs text-muted-foreground">WTG:{type.wtg}</span>}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">{formatAircraftType(type)}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <SettingsRow label="Type Code" value={formData.typecode} readOnly />
              )}

              <SettingsRow
                label="ICAO24"
                value={formData.icao24}
                onChange={(value) => updateField("icao24", value)}
                placeholder="Hex address"
                readOnly={!isEditing}
              />
              <SettingsRow
                label="Operator"
                value={formData.operator}
                onChange={(value) => updateField("operator", value)}
                placeholder="Operator"
                readOnly={!isEditing}
              />

              {displayType && (
                <>
                  <SettingsRow label="Description" value={displayType.description} readOnly />
                  <SettingsRow label="WTC" value={displayType.wtc} readOnly />
                  <SettingsRow label="WTG" value={displayType.wtg} readOnly />
                  <SettingsRow label="Manufacturer" value={displayType.manufacturer} readOnly />
                  <SettingsRow
                    label="Category"
                    value={`${displayType.category} · ${displayType.engineCount} × ${displayType.engineType}`}
                    readOnly
                  />
                </>
              )}

              {!displayType && (aircraft.shortDescription || aircraft.wtc || aircraft.wtg) && (
                <>
                  {aircraft.shortDescription && <SettingsRow label="Description" value={aircraft.shortDescription} readOnly />}
                  {aircraft.wtc && <SettingsRow label="WTC" value={aircraft.wtc} readOnly />}
                  {aircraft.wtg && <SettingsRow label="WTG" value={aircraft.wtg} readOnly />}
                  {aircraft.manufacturerCode && <SettingsRow label="Manufacturer" value={aircraft.manufacturerCode} readOnly />}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
