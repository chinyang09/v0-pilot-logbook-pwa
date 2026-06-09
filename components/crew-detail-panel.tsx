"use client"

import { useMemo, useRef } from "react"
import { Button } from "@/components/ui/button"
import { GlassContainer } from "@/components/ui/glass-container"
import { useRegisterDetailActions } from "@/hooks/use-page-actions"
import { useCrewForm } from "@/hooks/use-crew-form"
import { CrewFormBody } from "@/components/crew-form-body"
import { Loader2 } from "lucide-react"

interface CrewDetailPanelProps {
  crewId: string
  onUpdated?: () => void
  /** Called when back button is pressed (mobile overlay dismiss) */
  onBack?: () => void
}

export function CrewDetailPanel({ crewId, onUpdated }: CrewDetailPanelProps) {
  const form = useCrewForm({
    id: crewId,
    isNew: false,
    onSaved: () => onUpdated?.(),
  })
  const { crew, isLoading, isEditing, isSaving, setIsEditing, formData } = form

  // Stable refs so the memoised glass action bar always calls the latest handlers
  const saveRef = useRef(form.handleSave)
  saveRef.current = form.handleSave
  const cancelRef = useRef(form.resetForm)
  cancelRef.current = form.resetForm

  const detailActions = useMemo(() => {
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
  }, [isEditing, isSaving, formData.name, setIsEditing])

  useRegisterDetailActions(detailActions, true)

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
      <div className="flex-1 overflow-auto pt-16">
        <div className="px-2 pt-4 pb-safe">
          <CrewFormBody
            formData={formData}
            isEditing={isEditing}
            existingSelfId={form.existingSelfId}
            updateField={form.updateField}
            handleIsMeChange={form.handleIsMeChange}
            toggleRole={form.toggleRole}
          />
        </div>
      </div>
    </div>
  )
}
