"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GlassTextButton } from "@/components/ui/glass-icon-button"
import { SettingsRow } from "@/components/ui/settings-row"
import { FormSection } from "@/components/ui/form-section"
import { useRegisterDetailActions } from "@/hooks/use-page-actions"
import {
  addCustomAircraftToDatabase,
  type NormalizedAircraft,
} from "@/lib/db/stores/reference/aircraft.store"
import { Loader2 } from "lucide-react"
import { submitAircraftToServer } from "@/lib/submissions/submit"
import { getAircraftType } from "@/lib/db/stores/reference/aircraft-types.store"
import type { AircraftType } from "@/types/entities/aircraft-type.types"
import { formatAircraftType } from "@/lib/utils/aircraft-type-utils"
import { useAircraftTypeSearch } from "@/hooks/use-aircraft-type-search"

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

  const {
    typeSearchQuery, setTypeSearchQuery,
    typeSearchResults, selectedType, setSelectedType,
    showTypeSearch, setShowTypeSearch,
    handleSelectType, resetTypeSearch,
  } = useAircraftTypeSearch()

  // Reset all transient state when aircraft identity changes (hot-swap)
  const prevRegRef = useRef(aircraft.registration);
  useEffect(() => {
    if (aircraft.registration === prevRegRef.current) return;
    prevRegRef.current = aircraft.registration;
    setIsEditing(false);
    setIsSaving(false);
    resetTypeSearch();
  }, [aircraft.registration, resetTypeSearch]);

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

  // Wrap handleSelectType to also update formData
  const onSelectType = useCallback((type: AircraftType) => {
    handleSelectType(type)
    setFormData((prev) => ({ ...prev, typecode: type.designator }))
  }, [handleSelectType])

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

  // Stable refs for handlers to avoid re-render loops
  const saveRef = useRef(handleSave)
  saveRef.current = handleSave
  const cancelRef = useRef(handleCancel)
  cancelRef.current = handleCancel

  // Register detail panel actions for the floating glass bar
  const detailActions = useMemo(() => {
    return isEditing ? (
      <>
        <GlassTextButton onClick={() => cancelRef.current()}>
          Cancel
        </GlassTextButton>
        <GlassTextButton
          primary
          disabled={!formData.registration.trim() || isSaving}
          onClick={() => saveRef.current()}
        >
          {isSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : "Save"}
        </GlassTextButton>
      </>
    ) : (
      <GlassTextButton primary onClick={() => setIsEditing(true)}>
        Edit
      </GlassTextButton>
    )
  }, [isEditing, isSaving, formData.registration])

  useRegisterDetailActions(detailActions, true)

  return (
    <div className="h-full relative flex flex-col">
      <div className="flex-1 overflow-y-auto pt-chrome">
        <div className="px-2 pt-4 pb-safe space-y-4">
          <FormSection title="Details">
            <SettingsRow
              label="Registration"
              value={formData.registration}
              onChange={(value) => updateField("registration", value)}
              placeholder="e.g. 9V-TNK"
              readOnly={!isEditing}
              uppercase
            />

            {isEditing ? (
              <div className="px-4 py-3.5 row-divider">
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
                    className="text-right border-0 bg-transparent dark:bg-transparent shadow-none rounded-none md:text-base h-auto p-0 w-auto max-w-[150px] text-muted-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0 uppercase"
                  />
                </div>
                {showTypeSearch && typeSearchResults.length > 0 && (
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border bg-background">
                    {typeSearchResults.map((type) => (
                      <button
                        key={type.designator}
                        type="button"
                        onClick={() => onSelectType(type)}
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
          </FormSection>

          {displayType ? (
            <FormSection title="Type Information">
              <SettingsRow label="Description" value={displayType.description} readOnly />
              <SettingsRow label="WTC" value={displayType.wtc} readOnly />
              <SettingsRow label="WTG" value={displayType.wtg} readOnly />
              <SettingsRow label="Manufacturer" value={displayType.manufacturer} readOnly />
              <SettingsRow
                label="Category"
                value={`${displayType.category} · ${displayType.engineCount} × ${displayType.engineType}`}
                readOnly
              />
            </FormSection>
          ) : (
            (aircraft.shortDescription || aircraft.wtc || aircraft.wtg || aircraft.manufacturerCode) && (
              <FormSection title="Type Information">
                {aircraft.shortDescription && <SettingsRow label="Description" value={aircraft.shortDescription} readOnly />}
                {aircraft.wtc && <SettingsRow label="WTC" value={aircraft.wtc} readOnly />}
                {aircraft.wtg && <SettingsRow label="WTG" value={aircraft.wtg} readOnly />}
                {aircraft.manufacturerCode && <SettingsRow label="Manufacturer" value={aircraft.manufacturerCode} readOnly />}
              </FormSection>
            )
          )}
        </div>
      </div>
    </div>
  )
}
