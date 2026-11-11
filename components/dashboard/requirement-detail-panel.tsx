"use client"

/**
 * One requirement of the legal page — a currency cell — in the DETAIL panel:
 * its state, what the cell's figure is made of, the remedy when it is short,
 * and the way to the page that owns it. It used to unfold under the currency
 * grid, inside the one-screen surface it was squeezing.
 *
 * Opening it does not navigate: the dashboard stays where it was, beside the
 * panel on a tablet and under the overlay on a phone, and the deep link is a
 * deliberate second step.
 */

import { useRouter } from "next/navigation"
import { ReadingPanel } from "@/components/ui/detail-form-panel"
import { FormSection } from "@/components/ui/form-section"
import { ReadOnlyRow } from "@/components/ui/settings-row"
import { ActionRow, ActionStack } from "@/components/ui/action-row"
import type { Requirement, RequirementState } from "@/lib/utils/dashboard/legality"

const STATE_WORD: Record<RequirementState, string> = {
  ok: "Current",
  caution: "Caution",
  fail: "Not met",
  unknown: "Unknown",
}

/** Where a requirement's link goes, in words. */
function destination(href: string): string {
  if (href.includes("selected=")) return "Open Flight"
  if (href.startsWith("/currencies")) return "Open Currencies"
  if (href.startsWith("/logbook")) return "Open Logbook"
  if (href.startsWith("/fdp")) return "Open FDP"
  return "Open"
}

export function RequirementDetailPanel({ requirement }: { requirement: Requirement }) {
  const router = useRouter()
  const { label, state, value, detail, action, href } = requirement
  // A detail row that only repeats the state above ("Status · Not met" twice
  // in one panel) is left out.
  const rows = (detail ?? []).filter((d) => !(d.label === "Status" && d.value === STATE_WORD[state]))
  // "To Do" is for a REMEDY ("2 landings required", "DG expired — renew"). A
  // line that only says the figure again in a sentence — "SEP expires in 5d"
  // under "Now 5d", over "Expires 15 Nov 26" — is the same fact a third time.
  const remedy = action && !action.toLowerCase().endsWith(value.toLowerCase()) ? action : null

  return (
    <ReadingPanel title={label}>
      <FormSection>
        <ReadOnlyRow label="Status" value={STATE_WORD[state]} />
        <ReadOnlyRow label="Now" value={value} />
        {remedy && <ReadOnlyRow label="To Do" value={remedy} />}
      </FormSection>
      {rows.length > 0 && (
        <FormSection title="Detail">
          {rows.map((d) => (
            <ReadOnlyRow key={d.label} label={d.label} value={d.value} />
          ))}
        </FormSection>
      )}
      <ActionStack>
        <ActionRow label={destination(href)} onClick={() => router.push(href)} />
      </ActionStack>
    </ReadingPanel>
  )
}
