/**
 * Add or edit a currency (a document or check that expires).
 *
 * The same form shell as every other entity form — a full-screen sheet over
 * the content region with grouped rows and Cancel/Save (`RegionSheet`). It was
 * a centred modal of boxed inputs with a full-width button, which read as a
 * different app from the crew, aircraft and duty forms beside it.
 */

"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { FormSection } from "@/components/ui/form-section"
import { RegionSheet } from "@/components/ui/region-sheet"
import { SelectRow, SettingsRow, ToggleRow } from "@/components/ui/settings-row"
import { useBackDismiss } from "@/hooks/use-back-dismiss"
import { addCurrency, updateCurrency } from "@/lib/db"
import type { CurrencyWithStatus, CurrencyCode } from "@/types/entities/roster.types"

const PREDEFINED_CURRENCIES: Array<{ code: CurrencyCode; description: string }> = [
  { code: "MEDIC", description: "Medical Certificate" },
  { code: "SEP-E", description: "SEP Exam" },
  { code: "SEP-L", description: "SEP LET" },
  { code: "SEP-W", description: "SEP WET" },
  { code: "OPC320", description: "OPC A320" },
  { code: "ARIR32", description: "AR/IR A320" },
  { code: "RT320", description: "Recurrent Training A320" },
  { code: "OLC320", description: "OLC A320" },
  { code: "CRM", description: "CRM Training" },
  { code: "PASSP", description: "Passport" },
  { code: "LICENCE", description: "Pilot Licence" },
  { code: "LC", description: "Line Check" },
  { code: "PPC", description: "Proficiency Check" },
  { code: "CUSTOM", description: "Custom Currency" },
]

/** The trigger is right-aligned in a row beside its label: the name, not "CODE - name". */
const TYPE_OPTIONS = PREDEFINED_CURRENCIES.map((c) => ({
  value: c.code as string,
  label: c.code === "CUSTOM" ? "Custom" : c.description,
}))

interface CurrencyFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currency?: CurrencyWithStatus | null
  onSaved?: () => void
}

export function CurrencyFormDialog({ open, onOpenChange, currency, onSaved }: CurrencyFormDialogProps) {
  if (!open) return null
  // Mounted only while open and keyed on the record, so every open seeds the
  // form from scratch through `useState` initialisers. The reset effect this
  // replaces was a cascading render on every open, and keyed on the currency
  // OBJECT it clobbered an edit in progress whenever a sync handed back a
  // fresh row.
  return (
    <CurrencyForm
      key={currency?.id ?? "new"}
      currency={currency ?? null}
      onClose={() => onOpenChange(false)}
      onSaved={onSaved}
    />
  )
}

function CurrencyForm({
  currency,
  onClose,
  onSaved,
}: {
  currency: CurrencyWithStatus | null
  onClose: () => void
  onSaved?: () => void
}) {
  const dismiss = useBackDismiss(true, onClose)

  const [currencyCode, setCurrencyCode] = useState<string>(() => currency?.code ?? PREDEFINED_CURRENCIES[0].code)
  const [customDescription, setCustomDescription] = useState(() =>
    currency?.code === "CUSTOM" ? currency.description : "",
  )
  const [expiryDate, setExpiryDate] = useState(() => currency?.expiryDate ?? "")
  const [warningDays, setWarningDays] = useState(() => String(currency?.warningDays ?? 30))
  const [criticalDays, setCriticalDays] = useState(() => String(currency?.criticalDays ?? 7))
  const [autoUpdate, setAutoUpdate] = useState(() => currency?.autoUpdate ?? true)
  const [documentNumber, setDocumentNumber] = useState(() => currency?.documentNumber ?? "")
  const [notes, setNotes] = useState(() => currency?.notes ?? "")
  const [saving, setSaving] = useState(false)
  // Inline, not `alert()`: a native alert blocks the page, reads as a system
  // fault rather than a missing field, and is not shown at all in some
  // installed-PWA contexts.
  const [error, setError] = useState<string | null>(null)

  const isCustom = currencyCode === "CUSTOM"
  // A predefined code's description is the table's; an existing record keeps
  // its own wording when its code is unchanged (an import may have named it).
  const description = isCustom
    ? customDescription
    : currency && currency.code === currencyCode
      ? currency.description
      : (PREDEFINED_CURRENCIES.find((c) => c.code === currencyCode)?.description ?? "")

  const missing: string[] = []
  if (!description.trim()) missing.push("a description")
  if (!expiryDate) missing.push("an expiry date")
  const blockedReason = missing.length ? `Needs ${missing.join(" and ")}` : null
  const canSave = !blockedReason && !saving

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const data = {
        code: currencyCode,
        description: description.trim(),
        expiryDate,
        warningDays: parseInt(warningDays) || 30,
        criticalDays: parseInt(criticalDays) || 7,
        autoUpdate,
        documentNumber: documentNumber.trim() || undefined,
        notes: notes.trim() || undefined,
        lastUpdatedFrom: "manual" as const,
      }
      if (currency) await updateCurrency(currency.id, data)
      else await addCurrency(data)
      onSaved?.()
      dismiss()
    } catch (err) {
      console.error("Failed to save currency:", err)
      setError("Couldn't save this currency. Try again.")
      setSaving(false)
    }
  }

  return (
    <RegionSheet
      titleId="currency-dialog-title"
      title={currency ? "Edit currency" : "Add currency"}
      onDismiss={dismiss}
      footer={
        <>
          {error ? (
            <p className="mr-auto min-w-0 text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : (
            blockedReason && (
              <p className="mr-auto min-w-0 text-xs text-muted-foreground" role="status">
                {blockedReason}
              </p>
            )
          )}
          <Button variant="ghost" onClick={() => dismiss()}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <FormSection title="Currency">
        <SelectRow label="Type" value={currencyCode} onValueChange={setCurrencyCode} options={TYPE_OPTIONS} />
        {isCustom && (
          <SettingsRow
            label="Description"
            value={customDescription}
            onChange={setCustomDescription}
            placeholder="Company ID"
            required
          />
        )}
        <SettingsRow
          label="Expires"
          value={expiryDate}
          onChange={setExpiryDate}
          type="date"
          required
          swipeToClear={false}
        />
      </FormSection>

      <FormSection title="Alerts">
        <SettingsRow
          label="Warning"
          description="Days before expiry"
          value={warningDays}
          onChange={setWarningDays}
          inputMode="numeric"
          placeholder="30"
        />
        <SettingsRow
          label="Critical"
          description="Days before expiry"
          value={criticalDays}
          onChange={setCriticalDays}
          inputMode="numeric"
          placeholder="7"
        />
      </FormSection>

      <FormSection title="Details">
        <SettingsRow
          label="Document no."
          value={documentNumber}
          onChange={setDocumentNumber}
          placeholder="Optional"
        />
        <SettingsRow label="Notes" value={notes} onChange={setNotes} placeholder="Optional" />
        <ToggleRow
          label="Update from schedule"
          description="Take the expiry from an imported schedule report"
          checked={autoUpdate}
          onCheckedChange={setAutoUpdate}
        />
      </FormSection>
    </RegionSheet>
  )
}
