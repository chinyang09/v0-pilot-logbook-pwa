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
import { DetailFormPanel } from "@/components/ui/detail-form-panel"
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
  if (href.startsWith("/currencies")) return "Open currencies"
  if (href.startsWith("/logbook")) return "Open logbook"
  if (href.startsWith("/fdp")) return "Open FDP"
  return "Open"
}

export function RequirementDetailPanel({ requirement }: { requirement: Requirement }) {
  const router = useRouter()
  const { label, state, value, detail, action, href } = requirement

  return (
    <DetailFormPanel
      title={label}
      dirty={false}
      canSave={false}
      saving={false}
      onSave={() => {}}
      onCancel={() => {}}
    >
      <FormSection>
        <ReadOnlyRow label="Status" value={STATE_WORD[state]} />
        <ReadOnlyRow label="Reads" value={value} />
        {action && <ReadOnlyRow label="To do" value={action} />}
      </FormSection>
      {detail && detail.length > 0 && (
        <FormSection title="Detail">
          {detail.map((d) => (
            <ReadOnlyRow key={d.label} label={d.label} value={d.value} />
          ))}
        </FormSection>
      )}
      <ActionStack>
        <ActionRow label={destination(href)} onClick={() => router.push(href)} />
      </ActionStack>
    </DetailFormPanel>
  )
}
