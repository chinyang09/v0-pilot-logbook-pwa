"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GlassContainer } from "@/components/ui/glass-container"
import { useRegisterDetailActions } from "@/hooks/use-page-actions"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { Switch } from "@/components/ui/switch"
import {
  getPersonnelById,
  updatePersonnel,
  getAllPersonnel,
  type Personnel,
} from "@/lib/db"
import { Loader2, ChevronRight, ChevronLeft } from "lucide-react"
import { mutate } from "swr"
import { CACHE_KEYS } from "@/hooks/data"

const ROLE_OPTIONS = ["PIC", "SIC", "Instructor", "Examiner"] as const

function SettingsRow({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  readOnly = false,
}: {
  label: string
  value: string
  onChange?: (value: string) => void
  placeholder?: string
  type?: string
  readOnly?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-b-0">
      <span className="text-foreground">{label}</span>
      {readOnly ? (
        <span className="text-muted-foreground">{value || "-"}</span>
      ) : (
        <Input
          type={type}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          className="text-right border-0 bg-transparent h-auto p-0 w-auto max-w-[200px] text-muted-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0"
        />
      )}
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
  readOnly = false,
  disabled = false,
}: {
  label: string
  checked: boolean
  onCheckedChange?: (checked: boolean) => void
  readOnly?: boolean
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-b-0">
      <span className={disabled ? "text-muted-foreground" : "text-foreground"}>
        {label}
      </span>
      <Switch
        checked={checked}
        onCheckedChange={readOnly ? undefined : onCheckedChange}
        disabled={readOnly || disabled}
      />
    </div>
  )
}

interface CrewDetailPanelProps {
  crewId: string
  onUpdated?: () => void
  /** Called when back button is pressed (mobile overlay dismiss) */
  onBack?: () => void
}

export function CrewDetailPanel({ crewId, onUpdated, onBack }: CrewDetailPanelProps) {
  const [crew, setCrew] = useState<Personnel | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [existingSelfId, setExistingSelfId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: "",
    crewId: "",
    organization: "",
    roles: [] as ("PIC" | "SIC" | "Instructor" | "Examiner")[],
    licenceNumber: "",
    email: "",
    phone: "",
    comment: "",
    isMe: false,
    favorite: false,
    defaultPIC: false,
    defaultSIC: false,
  })

  const prevCrewIdRef = useRef(crewId);
  useEffect(() => {
    let mounted = true
    const isIdChange = crewId !== prevCrewIdRef.current;
    prevCrewIdRef.current = crewId;

    // Only show loading on first mount, not on subsequent ID changes
    if (!crew) setIsLoading(true)
    if (isIdChange) {
      setIsEditing(false)
      setIsSaving(false)
    }

    const loadData = async () => {
      const allPersonnel = await getAllPersonnel()
      if (!mounted) return
      const selfCrew = allPersonnel.find((p) => p.isMe && p.id !== crewId)
      setExistingSelfId(selfCrew?.id || null)

      try {
        const data = await getPersonnelById(crewId)
        if (!mounted) return
        if (data) {
          setCrew(data)
          setFormData({
            name: data.name || "",
            crewId: data.crewId || "",
            organization: data.organization || "",
            roles: data.roles || [],
            licenceNumber: data.licenceNumber || "",
            email: data.contact?.email || "",
            phone: data.contact?.phone || "",
            comment: data.comment || "",
            isMe: data.isMe || false,
            favorite: data.favorite || false,
            defaultPIC: data.defaultPIC || false,
            defaultSIC: data.defaultSIC || false,
          })
        }
      } catch (error) {
        console.error("Failed to load crew:", error)
      } finally {
        if (mounted) setIsLoading(false)
      }
    }
    loadData()
    return () => { mounted = false }
  }, [crewId])

  const updateField = useCallback(
    (field: string, value: string | boolean | string[]) => {
      setFormData((prev) => ({ ...prev, [field]: value }))
    },
    []
  )

  const handleIsMeChange = useCallback(
    async (checked: boolean) => {
      if (checked && existingSelfId) {
        await updatePersonnel(existingSelfId, { isMe: false })
        setExistingSelfId(null)
      }
      setFormData((prev) => ({ ...prev, isMe: checked }))
    },
    [existingSelfId]
  )

  const handleSave = async () => {
    if (!formData.name.trim()) return

    setIsSaving(true)
    try {
      if (formData.isMe && existingSelfId) {
        await updatePersonnel(existingSelfId, { isMe: false })
      }

      const personnelData = {
        name: formData.name.trim(),
        crewId: formData.crewId.trim() || undefined,
        organization: formData.organization.trim() || undefined,
        roles: formData.roles.length > 0 ? formData.roles : undefined,
        licenceNumber: formData.licenceNumber.trim() || undefined,
        contact:
          formData.email.trim() || formData.phone.trim()
            ? {
                email: formData.email.trim() || undefined,
                phone: formData.phone.trim() || undefined,
              }
            : undefined,
        comment: formData.comment.trim() || undefined,
        isMe: formData.isMe,
        favorite: formData.favorite,
        defaultPIC: formData.defaultPIC,
        defaultSIC: formData.defaultSIC,
      }

      const savedCrew = await updatePersonnel(crewId, personnelData)
      setCrew(savedCrew)
      await mutate(CACHE_KEYS.personnel)
      setIsEditing(false)
      onUpdated?.()
    } catch (error) {
      console.error("Failed to save crew:", error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    if (crew) {
      setFormData({
        name: crew.name || "",
        crewId: crew.crewId || "",
        organization: crew.organization || "",
        roles: crew.roles || [],
        licenceNumber: crew.licenceNumber || "",
        email: crew.contact?.email || "",
        phone: crew.contact?.phone || "",
        comment: crew.comment || "",
        isMe: crew.isMe || false,
        favorite: crew.favorite || false,
        defaultPIC: crew.defaultPIC || false,
        defaultSIC: crew.defaultSIC || false,
      })
    }
    setIsEditing(false)
  }

  const toggleRole = useCallback((role: (typeof ROLE_OPTIONS)[number]) => {
    setFormData((prev) => ({
      ...prev,
      roles: prev.roles.includes(role)
        ? prev.roles.filter((r) => r !== role)
        : [...prev.roles, role],
    }))
  }, [])

  const isDesktop = useIsDesktop()

  // Stable refs for handlers
  const saveRef = useRef(handleSave)
  saveRef.current = handleSave
  const cancelRef = useRef(handleCancel)
  cancelRef.current = handleCancel

  // Register detail panel actions for the desktop floating glass bar
  const detailActions = useMemo(() => {
    if (!isDesktop) return null
    return isEditing ? (
      <>
        <GlassContainer cornerRadius={28}>
          <Button variant="ghost" className="h-14 px-4" onClick={() => cancelRef.current()}>
            Cancel
          </Button>
        </GlassContainer>
        <GlassContainer cornerRadius={28}>
          <Button
            variant="ghost"
            className="h-14 px-4 text-primary font-semibold"
            disabled={!formData.name.trim() || isSaving}
            onClick={() => saveRef.current()}
          >
            {isSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : "Save"}
          </Button>
        </GlassContainer>
      </>
    ) : (
      <GlassContainer cornerRadius={28}>
        <Button
          variant="ghost"
          className="h-14 px-4 text-primary font-semibold"
          onClick={() => setIsEditing(true)}
        >
          Edit
        </Button>
      </GlassContainer>
    )
  }, [isDesktop, isEditing, isSaving, formData.name])

  useRegisterDetailActions(detailActions, isDesktop ?? false)

  // Silent wait: return null to keep previous panel content visible (no flash)
  if (isLoading && !crew) {
    return null
  }

  if (!crew) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Crew member not found
      </div>
    )
  }

  return (
    <div className="h-full relative flex flex-col">
      {/* Header — mobile only, desktop uses floating glass bar */}
      <header className="absolute top-0 left-0 right-0 z-50 bg-background/30 backdrop-blur-xl border-b border-border/50 md:hidden">
        <div className="px-2 h-12 flex items-center">
          <div className="w-16 flex-shrink-0">
            {isEditing ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                className="text-primary h-8 px-2"
              >
                Cancel
              </Button>
            ) : onBack ? (
              <Button variant="ghost" size="icon-sm" onClick={onBack}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
          <h1 className="flex-1 text-center text-lg font-semibold truncate px-2">
            {formData.isMe ? "Self" : formData.name || "Crew Info"}
          </h1>
          <div className="w-16 flex-shrink-0 flex justify-end">
            {isEditing ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSave}
                disabled={!formData.name.trim() || isSaving}
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

      {/* Scrollable Content */}
      <div className="flex-1 overflow-auto pt-12 md:pt-16">
        <div className="px-4 pt-4 pb-safe">
          {/* Main Info Card */}
          <div className="bg-card rounded-xl overflow-hidden mb-6 border border-border">
            <div className="px-4">
              <SettingsRow
                label="Name"
                value={formData.name}
                onChange={(value) => updateField("name", value)}
                placeholder="Required"
                readOnly={!isEditing}
              />
              <SettingsRow
                label="ID"
                value={formData.crewId}
                onChange={(value) => updateField("crewId", value)}
                placeholder="Crew ID"
                readOnly={!isEditing}
              />
              <SettingsRow
                label="Organization"
                value={formData.organization}
                onChange={(value) => updateField("organization", value)}
                placeholder="Company"
                readOnly={!isEditing}
              />
              <SettingsRow
                label="Licence Number"
                value={formData.licenceNumber}
                onChange={(value) => updateField("licenceNumber", value)}
                placeholder="Licence #"
                readOnly={!isEditing}
              />

              {/* Type/Roles */}
              <div className="py-3 border-b border-border">
                <span className="text-foreground block mb-2">Type</span>
                {isEditing ? (
                  <div className="flex flex-wrap gap-2">
                    {ROLE_OPTIONS.map((role) => (
                      <Button
                        key={role}
                        type="button"
                        variant={formData.roles.includes(role) ? "default" : "outline"}
                        size="sm"
                        onClick={() => toggleRole(role)}
                        className="h-8"
                      >
                        {role}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">
                    {formData.roles.length > 0 ? formData.roles.join(", ") : "-"}
                  </span>
                )}
              </div>

              <ToggleRow
                label="This is Me"
                checked={formData.isMe}
                onCheckedChange={handleIsMeChange}
                readOnly={!isEditing}
              />
              {isEditing && existingSelfId && !formData.isMe && (
                <p className="text-xs text-muted-foreground -mt-2 mb-2 px-1">
                  Another crew member is already marked as "Self". Enabling this
                  will remove that designation.
                </p>
              )}

              <SettingsRow
                label="Email"
                value={formData.email}
                onChange={(value) => updateField("email", value)}
                placeholder="email@example.com"
                type="email"
                readOnly={!isEditing}
              />
              <SettingsRow
                label="Phone"
                value={formData.phone}
                onChange={(value) => updateField("phone", value)}
                placeholder="+1 234 567 8900"
                type="tel"
                readOnly={!isEditing}
              />

              {/* Comment */}
              <div className="flex items-center justify-between py-3">
                <span className="text-foreground">Comment</span>
                <div className="flex items-center gap-2">
                  {isEditing ? (
                    <Input
                      value={formData.comment}
                      onChange={(e) => updateField("comment", e.target.value)}
                      placeholder="Add comment"
                      className="text-right border-0 bg-transparent h-auto p-0 w-auto max-w-[150px] text-muted-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0"
                    />
                  ) : (
                    <span className="text-muted-foreground">
                      {formData.comment || "-"}
                    </span>
                  )}
                  {isEditing && (
                    <ChevronRight className="h-5 w-5 text-muted-foreground/50" />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Options Section */}
          <div className="mb-2">
            <span className="text-xs text-muted-foreground uppercase tracking-wider px-4">
              Options
            </span>
          </div>
          <div className="bg-card rounded-xl overflow-hidden border border-border">
            <div className="px-4">
              <ToggleRow
                label="Favorite"
                checked={formData.favorite}
                onCheckedChange={(checked) => updateField("favorite", checked)}
                readOnly={!isEditing}
              />
              <ToggleRow
                label="Default SIC"
                checked={formData.defaultSIC}
                onCheckedChange={(checked) => updateField("defaultSIC", checked)}
                readOnly={!isEditing}
              />
              <ToggleRow
                label="Default PIC"
                checked={formData.defaultPIC}
                onCheckedChange={(checked) => updateField("defaultPIC", checked)}
                readOnly={!isEditing}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
