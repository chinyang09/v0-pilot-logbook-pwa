"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import {
  getPersonnelById,
  updatePersonnel,
  addPersonnel,
  getAllPersonnel,
  type Personnel,
} from "@/lib/db"
import { mutate } from "swr"
import { CACHE_KEYS } from "@/hooks/data"
import { formPatch } from "@/lib/utils/form-patch"
import { pickSelfCard } from "@/lib/utils/self-card"

export const CREW_ROLE_OPTIONS = ["PIC", "SIC", "Instructor", "Examiner"] as const
export type CrewRole = (typeof CREW_ROLE_OPTIONS)[number]

export interface CrewFormData {
  name: string
  crewId: string
  organization: string
  roles: CrewRole[]
  licenceNumber: string
  email: string
  phone: string
  comment: string
  isMe: boolean
  favorite: boolean
  /** Self card: the seat — captain (`defaultPIC`) or first officer
   *  (`defaultSIC`). See `seatOf`. */
  defaultPIC: boolean
  defaultSIC: boolean
  /** Self card, first officer: a flown leg is logged as this. Null = never
   *  set on the card (the old Import Defaults value still applies). */
  pfRole: "SIC" | "PICUS" | null
}

const EMPTY_FORM: CrewFormData = {
  name: "",
  crewId: "",
  organization: "",
  roles: [],
  licenceNumber: "",
  email: "",
  phone: "",
  comment: "",
  isMe: false,
  favorite: false,
  defaultPIC: false,
  defaultSIC: false,
  pfRole: null,
}

function formFromCrew(data: Personnel): CrewFormData {
  return {
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
    pfRole: data.pfRole ?? null,
  }
}

/** The record a crew form describes — one mapping for the save and its baseline. */
function personnelFromForm(formData: CrewFormData) {
  return {
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
    // The seat and the PF convention describe the PILOT, so they only
    // mean anything on the self card.
    defaultPIC: formData.isMe && formData.defaultPIC,
    defaultSIC: formData.isMe && formData.defaultSIC,
    pfRole: formData.isMe ? formData.pfRole : null,
  }
}

/**
 * Shared crew form state + persistence used by both the crew detail panel and
 * the full-page crew route (incl. "new" mode). Navigation/chrome is left to the
 * caller via {@link onSaved}.
 */
export function useCrewForm({
  id,
  isNew,
  onSaved,
}: {
  id: string
  isNew: boolean
  onSaved?: (saved: Personnel | null) => void
}) {
  const [crew, setCrew] = useState<Personnel | null>(null)
  const [isLoading, setIsLoading] = useState(!isNew)
  const [isSaving, setIsSaving] = useState(false)
  const [isEditing, setIsEditing] = useState(isNew)
  const [existingSelfId, setExistingSelfId] = useState<string | null>(null)
  const [formData, setFormData] = useState<CrewFormData>(EMPTY_FORM)

  const prevIdRef = useRef(id)
  useEffect(() => {
    let mounted = true
    const idChanged = id !== prevIdRef.current
    prevIdRef.current = id
    if (idChanged) {
      setIsEditing(isNew)
      setIsSaving(false)
    }
    if (!crew && !isNew) setIsLoading(true)

    const load = async () => {
      const all = await getAllPersonnel()
      if (!mounted) return
      setExistingSelfId(pickSelfCard(all.filter((p) => p.id !== id))?.id || null)
      if (isNew) {
        setIsLoading(false)
        return
      }
      try {
        const data = await getPersonnelById(id)
        if (!mounted) return
        if (data) {
          setCrew(data)
          setFormData(formFromCrew(data))
        }
      } catch (error) {
        console.error("Failed to load crew:", error)
      } finally {
        if (mounted) setIsLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew])

  const updateField = useCallback(
    (field: keyof CrewFormData, value: string | boolean | string[] | null) => {
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

  const toggleRole = useCallback((role: CrewRole) => {
    setFormData((prev) => ({
      ...prev,
      roles: prev.roles.includes(role)
        ? prev.roles.filter((r) => r !== role)
        : [...prev.roles, role],
    }))
  }, [])

  const handleSave = useCallback(async (): Promise<Personnel | null> => {
    if (!formData.name.trim()) return null
    setIsSaving(true)
    try {
      if (formData.isMe) {
        // EVERY other flagged card, not just the one this page found: two
        // devices can each have chosen a different one before syncing.
        const others = (await getAllPersonnel()).filter((p) => p.isMe && p.id !== (crew?.id ?? id))
        for (const other of others) await updatePersonnel(other.id, { isMe: false })
      }
      const personnelData = personnelFromForm(formData)
      let saved: Personnel | null = null
      if (isNew) {
        saved = await addPersonnel(personnelData)
      } else if (crew) {
        // Only what was edited HERE. The card was loaded when the page
        // opened, and saving that whole copy put back anything another device
        // had changed on it since — the same stale-snapshot overwrite the
        // flight form had (see `lib/utils/form-patch.ts`).
        const patch = formPatch(personnelData, personnelFromForm(formFromCrew(crew)))
        saved = Object.keys(patch).length > 0 ? await updatePersonnel(crew.id, patch) : crew
        setCrew(saved)
      } else {
        saved = await updatePersonnel(id, personnelData)
      }

      await mutate(CACHE_KEYS.personnel)
      setIsEditing(false)
      onSaved?.(saved)
      return saved
    } catch (error) {
      console.error("Failed to save crew:", error)
      return null
    } finally {
      setIsSaving(false)
    }
  }, [formData, isNew, crew, id, onSaved])

  const resetForm = useCallback(() => {
    if (crew) setFormData(formFromCrew(crew))
    setIsEditing(false)
  }, [crew])

  return {
    crew,
    isLoading,
    isSaving,
    isEditing,
    setIsEditing,
    existingSelfId,
    formData,
    updateField,
    handleIsMeChange,
    toggleRole,
    handleSave,
    resetForm,
  }
}
