/**
 * Resolve an import note — the same form shell as every other edit in the app
 * (`RegionSheet`): the issue as read-only rows, the choice as a list with a
 * check on the selected answer, notes as a row, Cancel/Resolve in the footer.
 *
 * It was a centred modal with a "Current Issue:" box, a dropdown for four
 * answers that each needed a sentence of explanation, a boxed input and two
 * full-width buttons — a web form, where four answers want a list you can see
 * all of at once.
 */

"use client"

import { useState } from "react"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FormSection } from "@/components/ui/form-section"
import { RegionSheet } from "@/components/ui/region-sheet"
import { ReadOnlyRow, SettingsRow } from "@/components/ui/settings-row"
import { useBackDismiss } from "@/hooks/use-back-dismiss"
import { resolveDiscrepancy } from "@/lib/db"
import { cn } from "@/lib/utils"
import type { Discrepancy } from "@/types/entities/roster.types"

const RESOLUTION_OPTIONS = [
  {
    value: "keep_logbook",
    label: "Keep logbook entry",
    description: "Use the values from your logbook, discard schedule data",
  },
  {
    value: "keep_schedule",
    label: "Keep schedule entry",
    description: "Use the values from your schedule, update logbook if needed",
  },
  {
    value: "merged",
    label: "Merge both",
    description: "Combine information from both sources",
  },
  {
    value: "ignored",
    label: "Ignore",
    description: "Mark as resolved without taking action",
  },
] as const

interface DiscrepancyResolutionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  discrepancy: Discrepancy | null
  onResolved?: () => void
}

export function DiscrepancyResolutionDialog({
  open,
  onOpenChange,
  discrepancy,
  onResolved,
}: DiscrepancyResolutionDialogProps) {
  if (!open || !discrepancy) return null
  // Mounted only while open and keyed on the note, so every open starts from
  // a fresh form rather than the last one's answer.
  return (
    <ResolutionForm
      key={discrepancy.id}
      discrepancy={discrepancy}
      onClose={() => onOpenChange(false)}
      onResolved={onResolved}
    />
  )
}

function ResolutionForm({
  discrepancy,
  onClose,
  onResolved,
}: {
  discrepancy: Discrepancy
  onClose: () => void
  onResolved?: () => void
}) {
  const dismiss = useBackDismiss(true, onClose)
  const [resolution, setResolution] = useState<NonNullable<Discrepancy["resolvedBy"]>>("keep_logbook")
  const [notes, setNotes] = useState("")
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resolve = async () => {
    setResolving(true)
    setError(null)
    try {
      await resolveDiscrepancy(discrepancy.id, resolution, notes.trim() || undefined)
      onResolved?.()
      dismiss()
    } catch (err) {
      console.error("Failed to resolve discrepancy:", err)
      setError("Couldn't resolve this. Try again.")
      setResolving(false)
    }
  }

  return (
    <RegionSheet
      titleId="resolve-dialog-title"
      title="Resolve"
      onDismiss={dismiss}
      footer={
        <>
          {error && (
            <p className="mr-auto min-w-0 text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button variant="ghost" onClick={() => dismiss()}>
            Cancel
          </Button>
          <Button onClick={resolve} disabled={resolving}>
            {resolving ? "Resolving…" : "Resolve"}
          </Button>
        </>
      }
    >
      <FormSection title="Issue">
        <p className="row-divider px-4 py-3.5 text-sm text-foreground">
          {discrepancy.message || "Discrepancy detected"}
        </p>
        {discrepancy.field && <ReadOnlyRow label="Field" value={discrepancy.field} />}
        {discrepancy.scheduleValue && <ReadOnlyRow label="Schedule" value={String(discrepancy.scheduleValue)} />}
        {discrepancy.logbookValue && <ReadOnlyRow label="Logbook" value={String(discrepancy.logbookValue)} />}
      </FormSection>

      <FormSection title="Resolution">
        <div role="radiogroup" aria-label="Resolution">
          {RESOLUTION_OPTIONS.map((option) => {
            const selected = option.value === resolution
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setResolution(option.value)}
                className="row-divider flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-muted/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-foreground">{option.label}</span>
                  <span className="block text-xs text-muted-foreground">{option.description}</span>
                </span>
                <Check className={cn("h-5 w-5 shrink-0 text-primary", !selected && "invisible")} aria-hidden />
              </button>
            )
          })}
        </div>
      </FormSection>

      <FormSection title="Notes">
        <SettingsRow label="Notes" value={notes} onChange={setNotes} placeholder="Optional" />
      </FormSection>
    </RegionSheet>
  )
}
