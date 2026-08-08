"use client"

import { useMemo, useRef } from "react"
import { ScrollIndicator } from "@/components/ui/scroll-indicator"
import { Button } from "@/components/ui/button"
import { GlassTextButton } from "@/components/ui/glass-icon-button"
import { useRegisterDetailActions } from "@/hooks/use-page-actions"
import { useCrewForm } from "@/hooks/use-crew-form"
import { CrewFormBody } from "@/components/crew-form-body"
import type { Personnel } from "@/types/entities/crew.types"
import { Loader2 } from "lucide-react"

interface CrewDetailPanelProps {
  crewId: string
  /** New-entry mode: renders the form in create state (used by desktop [+]). */
  isNew?: boolean
  onUpdated?: (saved?: Personnel | null) => void
  /** Called when back button is pressed (mobile overlay dismiss) */
  onBack?: () => void
  /** New-entry mode only: dismiss the create form without saving. */
  onCancelNew?: () => void
}

export function CrewDetailPanel({ crewId, isNew = false, onUpdated, onCancelNew }: CrewDetailPanelProps) {
  const form = useCrewForm({
    id: crewId,
    isNew,
    onSaved: (saved) => onUpdated?.(saved),
  })
  const { crew, isLoading, isEditing, isSaving, setIsEditing, formData } = form

  // Stable refs so the memoised glass action bar always calls the latest handlers
  const saveRef = useRef(form.handleSave)
  saveRef.current = form.handleSave
  // In new-entry mode Cancel dismisses the create form; otherwise it reverts edits.
  const cancelRef = useRef<() => void>(form.resetForm)
  cancelRef.current = isNew ? (onCancelNew ?? (() => {})) : form.resetForm

  const detailActions = useMemo(() => {
    return isEditing ? (
      <>
        <GlassTextButton onClick={() => cancelRef.current()}>
          Cancel
        </GlassTextButton>
        <GlassTextButton
          primary
          disabled={!formData.name.trim() || isSaving}
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
  }, [isEditing, isSaving, formData.name, setIsEditing])

  useRegisterDetailActions(detailActions, true)

  // Silent wait: return null to keep previous panel content visible (no flash)
  if (isLoading && !crew && !isNew) {
    return null
  }

  if (!crew && !isNew) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Crew member not found
      </div>
    )
  }

  return (
    <div className="h-full relative flex flex-col">
      <div className="flex-1 overflow-auto overscroll-contain scrollbar-hide">
        <ScrollIndicator />
        <div className="h-chrome-top" />
        <div className="px-panel pt-4">
          <CrewFormBody
            formData={formData}
            isEditing={isEditing}
            existingSelfId={form.existingSelfId}
            updateField={form.updateField}
            handleIsMeChange={form.handleIsMeChange}
            toggleRole={form.toggleRole}
          />
        </div>
        <div className="h-chrome-bottom" />
      </div>
    </div>
  )
}
