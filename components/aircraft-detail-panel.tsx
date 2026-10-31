"use client"

import { AircraftTypeSuggestions } from "@/components/aircraft-type-suggestions"
import { CODE_INPUT_PROPS } from "@/lib/utils/input-props"
import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { Input } from "@/components/ui/input"
import { DetailFormPanel } from "@/components/ui/detail-form-panel"
import { SettingsRow } from "@/components/ui/settings-row"
import { FormSection } from "@/components/ui/form-section"
import {
  addCustomAircraftToDatabase,
  type NormalizedAircraft,
} from "@/lib/db/stores/reference/aircraft.store"
import { submitAircraftToServer } from "@/lib/submissions/submit"
import { getAircraftType } from "@/lib/db/stores/reference/aircraft-types.store"
import type { AircraftType } from "@/types/entities/aircraft-type.types"
import { useAircraftTypeSearch } from "@/hooks/use-aircraft-type-search"
import { CheckRow } from "@/components/check-row"
import { useAircraftWhereabouts, whereaboutsValue } from "@/hooks/use-aircraft-whereabouts"
import { usePreferences } from "@/components/providers/preferences-provider"
import { formatClockDisplay } from "@/lib/utils/time"

interface AircraftDetailPanelProps {
  /** Aircraft data from the parent's SWR hook (reactive) */
  aircraft: NormalizedAircraft
  /** Called after saving changes — parent should refresh SWR cache */
  onUpdated?: () => void
  /** Called when back button is pressed (mobile overlay dismiss) */
  onBack?: () => void
}

type AircraftFields = { registration: string; typecode: string; icao24: string; operator: string }

const fieldsOf = (a: NormalizedAircraft): AircraftFields => ({
  registration: a.registration,
  typecode: a.typecode || "",
  icao24: a.icao24 || "",
  operator: a.operator || "",
})

const FIELD_KEYS = ["registration", "typecode", "icao24", "operator"] as const

/**
 * An aircraft in the detail panel — the same `DetailFormPanel` a crew card, a
 * currency or a duty opens in: the registration as the title, every field
 * editable in place, and Cancel / Save in the header only once something
 * differs from the stored record. It was the last record behind a read-only
 * view and an Edit button.
 */
export function AircraftDetailPanel({ aircraft, onUpdated }: AircraftDetailPanelProps) {
  const [typeInfo, setTypeInfo] = useState<AircraftType | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const stored = useMemo(() => fieldsOf(aircraft), [aircraft])
  const [formData, setFormData] = useState<AircraftFields>(stored)

  const {
    typeSearchQuery, setTypeSearchQuery,
    typeSearchResults, selectedType, setSelectedType,
    showTypeSearch, setShowTypeSearch,
    handleSelectType, resetTypeSearch,
  } = useAircraftTypeSearch()

  // Follow the record underneath the form (a sync, an enrichment landing):
  // every field the pilot has not touched takes the stored value, and an edit
  // in progress is kept. Another aircraft (hot-swap) starts clean.
  const baseRef = useRef(stored)
  const prevRegRef = useRef(aircraft.registration)
  useEffect(() => {
    const base = baseRef.current
    baseRef.current = stored
    if (aircraft.registration !== prevRegRef.current) {
      prevRegRef.current = aircraft.registration
      setFormData(stored)
      setIsSaving(false)
      resetTypeSearch()
      return
    }
    setFormData((prev) => {
      const next = { ...prev }
      for (const k of FIELD_KEYS) if (prev[k] === base[k]) next[k] = stored[k]
      return next
    })
  }, [stored, aircraft.registration, resetTypeSearch])

  // Look up ICAO type info from Dexie
  useEffect(() => {
    const typecode = aircraft.typecode
    if (typecode) {
      getAircraftType(typecode).then(setTypeInfo)
    } else {
      setTypeInfo(null)
    }
  }, [aircraft.typecode])

  const updateField = useCallback((field: keyof AircraftFields, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }, [])

  // Wrap handleSelectType to also update formData
  const onSelectType = useCallback((type: AircraftType) => {
    handleSelectType(type)
    setFormData((prev) => ({ ...prev, typecode: type.designator }))
  }, [handleSelectType])

  const isDirty = FIELD_KEYS.some((k) => formData[k].trim() !== stored[k].trim())

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
      setShowTypeSearch(false)
      onUpdated?.()
    } catch (error) {
      console.error("Failed to save aircraft:", error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setFormData(stored)
    setSelectedType(null)
    setShowTypeSearch(false)
  }

  const displayType = selectedType || typeInfo
  const canSave = !!formData.registration.trim()

  return (
    <DetailFormPanel
      title={aircraft.registration || "Aircraft"}
      dirty={isDirty}
      canSave={canSave}
      saving={isSaving}
      status={canSave ? null : "A registration is needed to save."}
      onSave={() => void handleSave()}
      onCancel={handleCancel}
    >
      <FormSection title="Details">
        <SettingsRow
          label="Registration"
          value={formData.registration}
          onChange={(value) => updateField("registration", value)}
          placeholder="e.g. 9V-TNK"
          uppercase
        />

        <div className="px-4 py-3.5 row-divider">
          <div className="flex items-center justify-between">
            <span className="text-foreground">Type Code</span>
            <Input
              value={formData.typecode}
              {...CODE_INPUT_PROPS}
              aria-label="Type code"
              onChange={(e) => {
                const val = e.target.value.toUpperCase()
                updateField("typecode", val)
                setTypeSearchQuery(val)
                setShowTypeSearch(true)
                if (!val) setSelectedType(null)
              }}
              onFocus={() => {
                if (formData.typecode && !typeSearchQuery) setTypeSearchQuery(formData.typecode)
              }}
              placeholder="e.g. A359"
              className="text-right border-0 bg-transparent dark:bg-transparent shadow-none rounded-none md:text-base h-auto p-0 w-auto max-w-[150px] text-muted-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0 uppercase"
            />
          </div>
          {showTypeSearch && (
            <AircraftTypeSuggestions results={typeSearchResults} onSelect={onSelectType} />
          )}
        </div>

        <SettingsRow
          label="ICAO24"
          value={formData.icao24}
          onChange={(value) => updateField("icao24", value)}
          placeholder="Hex address"
        />
        <SettingsRow
          label="Operator"
          value={formData.operator}
          onChange={(value) => updateField("operator", value)}
          placeholder="Operator"
        />
      </FormSection>

      {/* Where it is now — checked on a tap, never stored. */}
      {aircraft.registration && <AircraftNowSection registration={aircraft.registration} />}

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
    </DetailFormPanel>
  )
}

/**
 * The aeroplane's last flight — landed, in the air or not yet left, and the
 * gate it arrives at — and, once checked, the one it flies next. Asked of now,
 * on a tap.
 */
function AircraftNowSection({ registration }: { registration: string }) {
  const { preferences } = usePreferences()
  const separator = preferences.display.clockSeparator
  const { state, check } = useAircraftWhereabouts(registration)
  const next = state?.status === "done" ? state.whereabouts.next : null
  const nextAt = next?.scheduledDeparture
  return (
    <FormSection title="Now">
      <CheckRow
        label="Last Flight"
        value={whereaboutsValue(state, separator)}
        loading={state?.status === "loading"}
        onCheck={() => void check()}
      />
      {next && (
        <SettingsRow
          label="Next Flight"
          value={[
            next.flightNumber,
            next.destination && `to ${next.destination.iata || next.destination.icao}`,
            nextAt && `${formatClockDisplay(nextAt.slice(11, 16), separator)}Z`,
          ]
            .filter(Boolean)
            .join(" · ")}
          readOnly
        />
      )}
    </FormSection>
  )
}
