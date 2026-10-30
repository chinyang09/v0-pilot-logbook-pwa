/**
 * An import note's DETAIL — what was noted, the values on either side, and its
 * resolution — in the detail panel, beside the notes on a tablet and as the
 * full-screen overlay on a phone. The note opens the way a flight or a
 * currency does.
 *
 * It replaces the resolution sheet, which covered the very list the note was
 * chosen from, and the card's own inline boxes, which put every note's detail
 * in the list at once. An open note's commit is Resolve, in the detail header
 * where every other detail form keeps its Save; a handled one shows how it was
 * handled and offers Reopen.
 */

"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check } from "lucide-react"
import { ActionRow, ActionStack } from "@/components/ui/action-row"
import { DetailFormPanel } from "@/components/ui/detail-form-panel"
import { FormSection } from "@/components/ui/form-section"
import { ReadOnlyRow, SettingsRow } from "@/components/ui/settings-row"
import { resolveDiscrepancy, unresolveDiscrepancy } from "@/lib/db"
import { cn } from "@/lib/utils"
import { flightFieldLabel } from "@/lib/utils/field-labels"
import type { Discrepancy } from "@/types/entities/roster.types"
import {
  DISCREPANCY_TYPE_CONFIG,
  RESOLUTION_LABELS,
  SEVERITY_CONFIG,
  STAMP,
} from "./discrepancy-card"

const RESOLUTION_OPTIONS = [
  {
    value: "keep_logbook",
    label: "Keep Logbook Entry",
    description: "Use the values from your logbook, discard schedule data",
  },
  {
    value: "keep_schedule",
    label: "Keep Schedule Entry",
    description: "Use the values from your schedule, update logbook if needed",
  },
  {
    value: "merged",
    label: "Merge Both",
    description: "Combine information from both sources",
  },
  {
    value: "ignored",
    label: "Ignore",
    description: "Mark as resolved without taking action",
  },
] as const

/** Key the panel on the note's id, so a different note starts a fresh form. */
export function DiscrepancyDetailPanel({
  discrepancy,
  onChanged,
  onClose,
}: {
  discrepancy: Discrepancy
  /** After a resolve or reopen; resolves once the page has the row back. */
  onChanged: () => Promise<unknown> | void
  /** Deselect the note (Cancel). */
  onClose: () => void
}) {
  const router = useRouter()
  const [resolution, setResolution] = useState<NonNullable<Discrepancy["resolvedBy"]>>("keep_logbook")
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const type = DISCREPANCY_TYPE_CONFIG[discrepancy.type]
  const severity = SEVERITY_CONFIG[discrepancy.severity]
  const open = !discrepancy.resolved

  const run = async (action: () => Promise<unknown>, failure: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await action()
      await onChanged()
    } catch (err) {
      console.error("[Discrepancies] Updating a note failed:", err)
      setError(failure)
    } finally {
      setBusy(false)
    }
  }

  return (
    <DetailFormPanel
      title={type.label}
      dirty={open}
      canSave
      saving={busy}
      saveLabel="Resolve"
      error={error}
      onSave={() =>
        run(() => resolveDiscrepancy(discrepancy.id, resolution, notes.trim() || undefined), "Couldn't resolve this. Try again.")
      }
      onCancel={onClose}
    >
      <FormSection title="Note">
        <p className="row-divider px-4 py-3.5 text-sm text-foreground">
          {discrepancy.message || type.description}
        </p>
        <ReadOnlyRow label="Severity" value={severity.label} />
        {discrepancy.field && <ReadOnlyRow label="Field" value={flightFieldLabel(discrepancy.field)} />}
        {discrepancy.scheduleValue && <ReadOnlyRow label="Company" value={String(discrepancy.scheduleValue)} />}
        {discrepancy.logbookValue && <ReadOnlyRow label="Logbook" value={String(discrepancy.logbookValue)} />}
        <ReadOnlyRow label="Noted" value={STAMP.format(new Date(discrepancy.createdAt))} />
      </FormSection>

      {discrepancy.flightLogId && (
        <ActionStack>
          <ActionRow
            label="Open Flight"
            onClick={() => router.push(`/logbook?selected=${encodeURIComponent(discrepancy.flightLogId!)}`)}
          />
        </ActionStack>
      )}

      {open ? (
        <>
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
        </>
      ) : (
        <FormSection title="Handled">
          <ReadOnlyRow
            label="Resolution"
            value={discrepancy.resolvedBy ? RESOLUTION_LABELS[discrepancy.resolvedBy] : "Resolved"}
          />
          {discrepancy.resolvedAt != null && (
            <ReadOnlyRow label="On" value={STAMP.format(new Date(discrepancy.resolvedAt))} />
          )}
          {discrepancy.resolutionNotes && <ReadOnlyRow label="Notes" value={discrepancy.resolutionNotes} />}
        </FormSection>
      )}
      {!open && (
        <ActionStack>
          <ActionRow
            disabled={busy}
            label={busy ? "Reopening…" : "Reopen"}
            onClick={() => run(() => unresolveDiscrepancy(discrepancy.id), "Couldn't reopen this. Try again.")}
          />
        </ActionStack>
      )}
    </DetailFormPanel>
  )
}
