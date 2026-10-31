"use client"

import { DetailFormPanel } from "@/components/ui/detail-form-panel"
import { useCrewForm } from "@/hooks/use-crew-form"
import { CrewFormBody } from "@/components/crew-form-body"
import type { Personnel } from "@/types/entities/crew.types"

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

/**
 * A crew card in the detail panel — the same `DetailFormPanel` a currency or a
 * duty opens in: the person's name as the title, every field editable in
 * place, and Cancel / Save in the header only once something has changed.
 */
export function CrewDetailPanel({ crewId, isNew = false, onUpdated, onCancelNew }: CrewDetailPanelProps) {
  const form = useCrewForm({
    id: crewId,
    isNew,
    onSaved: (saved) => onUpdated?.(saved),
  })
  const { crew, isLoading, isDirty, isSaving, formData } = form

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

  const canSave = !!formData.name.trim()
  return (
    <DetailFormPanel
      title={isNew ? "New Crew Member" : crew?.name || "Crew Member"}
      dirty={isDirty}
      canSave={canSave}
      saving={isSaving}
      status={canSave ? null : "A name is needed to save."}
      onSave={() => void form.handleSave()}
      // In new-entry mode Cancel dismisses the create form; otherwise it
      // puts the card back the way it is stored.
      onCancel={isNew ? (onCancelNew ?? (() => {})) : form.resetForm}
    >
      <CrewFormBody
        formData={formData}
        existingSelfId={form.existingSelfId}
        updateField={form.updateField}
        handleIsMeChange={form.handleIsMeChange}
        toggleRole={form.toggleRole}
      />
    </DetailFormPanel>
  )
}
