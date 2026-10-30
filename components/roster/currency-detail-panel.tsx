/**
 * A currency (a document or check that expires), in the DETAIL panel.
 *
 * Selecting one on the currencies page opens it beside the list on a tablet
 * and as the full-screen detail overlay on a phone — the way a flight, a crew
 * member or an aircraft opens. It used to be a sheet over the whole content
 * region, which covered the very list it was chosen from. Adding one opens the
 * same panel empty.
 *
 * The form holds a DRAFT (`useDraft`): only what the pilot has changed, over
 * the live record, so a pull landing while it is open moves every field they
 * have not touched.
 */

"use client"

import { useMemo, useState } from "react"
import { FormSection } from "@/components/ui/form-section"
import { DateRow } from "@/components/ui/date-row"
import { DetailFormPanel } from "@/components/ui/detail-form-panel"
import { SelectRow, SettingsRow, ToggleRow } from "@/components/ui/settings-row"
import { useDraft } from "@/hooks/use-draft"
import { addCurrency, updateCurrency } from "@/lib/db"
import type { Currency, CurrencyWithStatus, CurrencyCode } from "@/types/entities/roster.types"

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

interface CurrencyFields {
  code: string
  customDescription: string
  expiryDate: string
  warningDays: string
  criticalDays: string
  autoUpdate: boolean
  documentNumber: string
  notes: string
}

function fieldsOf(currency: CurrencyWithStatus | null): CurrencyFields {
  return {
    code: currency?.code ?? PREDEFINED_CURRENCIES[0].code,
    customDescription: currency?.code === "CUSTOM" ? currency.description : "",
    expiryDate: currency?.expiryDate ?? "",
    warningDays: String(currency?.warningDays ?? 30),
    criticalDays: String(currency?.criticalDays ?? 7),
    autoUpdate: currency?.autoUpdate ?? true,
    documentNumber: currency?.documentNumber ?? "",
    notes: currency?.notes ?? "",
  }
}

/**
 * `currency` null is a NEW one. Key the panel on the record's id (or "new"),
 * so a different currency starts a fresh draft.
 */
export function CurrencyDetailPanel({
  currency,
  onSaved,
  onCancelNew,
}: {
  currency: CurrencyWithStatus | null
  /** After a save; resolves once the page has the stored row back. */
  onSaved: (saved: Currency) => Promise<unknown> | void
  /** New only: close the empty form. */
  onCancelNew?: () => void
}) {
  const isNew = !currency
  const base = useMemo(() => fieldsOf(currency), [currency])
  // A code the list does not know — a company code an import brought in —
  // is offered as its own option. Without it the select had nothing to show
  // and the Type row read blank; mapping it to "Custom" instead would rewrite
  // the stored code on the next save and stop the schedule import matching it.
  const typeOptions = useMemo(
    () =>
      currency && !TYPE_OPTIONS.some((o) => o.value === currency.code)
        ? [{ value: currency.code, label: currency.description || currency.code }, ...TYPE_OPTIONS]
        : TYPE_OPTIONS,
    [currency]
  )
  const { values, set, reset, dirty } = useDraft(base)
  const [saving, setSaving] = useState(false)
  // Inline, not `alert()`: a native alert blocks the page and reads as a
  // system fault rather than a missing field.
  const [error, setError] = useState<string | null>(null)

  const isCustom = values.code === "CUSTOM"
  // A predefined code's description is the table's; an existing record keeps
  // its own wording when its code is unchanged (an import may have named it).
  const description = isCustom
    ? values.customDescription
    : currency && currency.code === values.code
      ? currency.description
      : (PREDEFINED_CURRENCIES.find((c) => c.code === values.code)?.description ?? "")

  const missing: string[] = []
  if (!description.trim()) missing.push("a description")
  if (!values.expiryDate) missing.push("an expiry date")
  const blockedReason = missing.length ? `Needs ${missing.join(" and ")}` : null

  const save = async () => {
    if (blockedReason || saving) return
    setSaving(true)
    setError(null)
    try {
      const data = {
        code: values.code,
        description: description.trim(),
        expiryDate: values.expiryDate,
        warningDays: parseInt(values.warningDays) || 30,
        criticalDays: parseInt(values.criticalDays) || 7,
        autoUpdate: values.autoUpdate,
        documentNumber: values.documentNumber.trim() || undefined,
        notes: values.notes.trim() || undefined,
        lastUpdatedFrom: "manual" as const,
      }
      const saved = currency ? await updateCurrency(currency.id, data) : await addCurrency(data)
      if (!saved) throw new Error("Currency not found")
      await onSaved(saved)
      reset()
    } catch (err) {
      console.error("Failed to save currency:", err)
      setError("Couldn't save this currency. Try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <DetailFormPanel
      title={isNew ? "New currency" : currency.description}
      dirty={isNew || dirty}
      canSave={!blockedReason}
      saving={saving}
      status={blockedReason}
      error={error}
      onSave={save}
      onCancel={() => {
        setError(null)
        if (isNew) onCancelNew?.()
        else reset()
      }}
    >
      <FormSection title="Currency">
        <SelectRow label="Type" value={values.code} onValueChange={(v) => set("code", v)} options={typeOptions} />
        {isCustom && (
          <SettingsRow
            label="Description"
            value={values.customDescription}
            onChange={(v) => set("customDescription", v)}
            placeholder="Company ID"
            required
          />
        )}
        <DateRow
          label="Expires"
          value={values.expiryDate}
          onChange={(v) => set("expiryDate", v)}
          required
          futureYears={15}
        />
      </FormSection>

      <FormSection title="Alerts">
        <SettingsRow
          label="Warning"
          description="Days before expiry"
          value={values.warningDays}
          onChange={(v) => set("warningDays", v)}
          inputMode="numeric"
          placeholder="30"
        />
        <SettingsRow
          label="Critical"
          description="Days before expiry"
          value={values.criticalDays}
          onChange={(v) => set("criticalDays", v)}
          inputMode="numeric"
          placeholder="7"
        />
      </FormSection>

      <FormSection title="Details">
        <SettingsRow
          label="Document No."
          value={values.documentNumber}
          onChange={(v) => set("documentNumber", v)}
          placeholder="Optional"
        />
        <SettingsRow label="Notes" value={values.notes} onChange={(v) => set("notes", v)} placeholder="Optional" />
        <ToggleRow
          label="Update From Schedule"
          description="From imported schedule reports."
          checked={values.autoUpdate}
          onCheckedChange={(v) => set("autoUpdate", v)}
        />
      </FormSection>
    </DetailFormPanel>
  )
}
