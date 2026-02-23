"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageContainer } from "@/components/page-container"
import {
  getAircraftByRegistrationFromDB,
  addCustomAircraftToDatabase,
  type NormalizedAircraft,
} from "@/lib/db"
import { ArrowLeft, Loader2 } from "lucide-react"
import { submitAircraftToServer } from "@/lib/submissions/submit"
import { getAircraftType, searchAircraftTypes } from "@/lib/db/stores/reference/aircraft-types.store"
import type { AircraftType } from "@/types/entities/aircraft-type.types"
import { formatAircraftType } from "@/lib/utils/aircraft-type-utils"
import { useIsDesktop } from "@/hooks/use-is-desktop"

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

export default function AircraftDetailPage() {
  const params = useParams()
  const router = useRouter()
  const registration = decodeURIComponent(params.registration as string)
  const isDesktop = useIsDesktop()

  const [aircraft, setAircraft] = useState<NormalizedAircraft | null>(null)
  const [typeInfo, setTypeInfo] = useState<AircraftType | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const [formData, setFormData] = useState({
    registration: "",
    typecode: "",
    icao24: "",
    operator: "",
  })

  const [typeSearchQuery, setTypeSearchQuery] = useState("")
  const [typeSearchResults, setTypeSearchResults] = useState<AircraftType[]>([])
  const [selectedType, setSelectedType] = useState<AircraftType | null>(null)
  const [showTypeSearch, setShowTypeSearch] = useState(false)

  // When switching to desktop view, redirect to aircraft page with selection
  useEffect(() => {
    if (isDesktop && registration) {
      router.replace(`/aircraft?selected=${encodeURIComponent(registration)}`)
    }
  }, [isDesktop, registration, router])

  useEffect(() => {
    const loadAircraft = async () => {
      setIsLoading(true)
      setIsEditing(false)
      try {
        const found = await getAircraftByRegistrationFromDB(registration)
        if (found) {
          setAircraft(found)
          setFormData({
            registration: found.registration,
            typecode: found.typecode || "",
            icao24: found.icao24 || "",
            operator: found.operator || "",
          })
          if (found.typecode) {
            const info = await getAircraftType(found.typecode)
            setTypeInfo(info)
          } else {
            setTypeInfo(null)
          }
        } else {
          setAircraft(null)
          setTypeInfo(null)
        }
      } catch (error) {
        console.error("[Aircraft Detail Page] Failed to load:", error)
      } finally {
        setIsLoading(false)
      }
    }
    loadAircraft()
  }, [registration])

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
        shortDescription: finalTypeInfo?.description || aircraft?.shortDescription || "",
        wtc: finalTypeInfo?.wtc || aircraft?.wtc || "",
        wtg: finalTypeInfo?.wtg || aircraft?.wtg || "",
        manufacturerCode: finalTypeInfo?.manufacturer || aircraft?.manufacturerCode || "",
        source: "fr24",
      })

      submitAircraftToServer({
        submissionId,
        registration: formData.registration.trim().toUpperCase(),
        typecode: formData.typecode.trim().toUpperCase(),
        icao24: formData.icao24.trim(),
        operator: formData.operator.trim(),
      })

      const found = await getAircraftByRegistrationFromDB(formData.registration)
      if (found) {
        setAircraft(found)
        if (found.typecode) {
          const info = await getAircraftType(found.typecode)
          setTypeInfo(info)
        }
      }

      setSelectedType(null)
      setIsEditing(false)
    } catch (error) {
      console.error("Failed to save aircraft:", error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    if (isEditing && aircraft) {
      setFormData({
        registration: aircraft.registration,
        typecode: aircraft.typecode || "",
        icao24: aircraft.icao24 || "",
        operator: aircraft.operator || "",
      })
      setSelectedType(null)
      setIsEditing(false)
    } else {
      router.back()
    }
  }

  const displayType = selectedType || typeInfo

  if (isLoading) {
    return (
      <div className="h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <PageContainer
      header={
        <header className="bg-background/30 backdrop-blur-xl border-b border-border/50 z-50">
          <div className="container mx-auto px-3">
            <div className="flex items-center justify-between h-12">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                className="text-primary h-8 px-2"
              >
                {isEditing ? "Cancel" : <ArrowLeft className="h-4 w-4" />}
              </Button>
              <h1 className="text-lg font-semibold truncate px-2">
                {!aircraft
                  ? "Aircraft Not Found"
                  : formData.registration || "Aircraft"}
                {aircraft && formData.typecode && (
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
          </div>
        </header>
      }
    >
      <div className="container mx-auto px-3 pt-4 pb-safe">
        {!aircraft ? (
          <p className="text-center text-muted-foreground py-12">
            Aircraft not found: {registration}
          </p>
        ) : (
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
        )}
      </div>
    </PageContainer>
  )
}
