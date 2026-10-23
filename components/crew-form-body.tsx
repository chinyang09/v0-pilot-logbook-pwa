"use client"

import { Button } from "@/components/ui/button"
import { FormSection } from "@/components/ui/form-section"
import { SettingsRow, ToggleRow } from "@/components/ui/settings-row"
import { usePreferences } from "@/components/providers/preferences-provider"
import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { seatOf, withLoggingPreferences } from "@/lib/utils/roster/pilot-role"
import {
  CREW_ROLE_OPTIONS,
  type CrewFormData,
  type CrewRole,
} from "@/hooks/use-crew-form"

/**
 * Presentational crew form body shared by the crew detail panel and the
 * full-page crew route. Uses the shared FormSection + settings rows so it
 * matches the flight form's sectioned layout, and like every other record it
 * is always editable — there is no read-only view behind an Edit button.
 */
export function CrewFormBody({
  formData,
  existingSelfId,
  updateField,
  handleIsMeChange,
  toggleRole,
}: {
  formData: CrewFormData
  existingSelfId: string | null
  updateField: (field: keyof CrewFormData, value: string | boolean | string[] | null) => void
  handleIsMeChange: (checked: boolean) => void
  toggleRole: (role: CrewRole) => void
}) {
  const { preferences } = usePreferences()
  const effective = withLoggingPreferences(formData, preferences.logging)
  const seat = seatOf(effective)
  const pfRole = effective?.pfRole ?? "SIC"
  const seatLabel =
    seat === "captain"
      ? "Captain — logged PIC"
      : seat === "first_officer"
        ? `First Officer — ${pfRole} when flying`
        : "Not set"

  return (
    <div className="space-y-4">
      <FormSection title="Details">
        <SettingsRow
          label="Name"
          value={formData.name}
          onChange={(v) => updateField("name", v)}
          placeholder="Required"
          required
        />
        <SettingsRow
          label="ID"
          value={formData.crewId}
          onChange={(v) => updateField("crewId", v)}
          placeholder="Crew ID"
        />
        <SettingsRow
          label="Organization"
          value={formData.organization}
          onChange={(v) => updateField("organization", v)}
          placeholder="Company"
        />
        <SettingsRow
          label="Licence Number"
          value={formData.licenceNumber}
          onChange={(v) => updateField("licenceNumber", v)}
          placeholder="Licence #"
        />

        {/* Type / roles */}
        <div className="px-4 py-3.5 row-divider">
          <span className="text-foreground block mb-2">Type</span>
          <div className="flex flex-wrap gap-2">
            {CREW_ROLE_OPTIONS.map((role) => (
              <Button
                key={role}
                type="button"
                variant={formData.roles.includes(role) ? "default" : "outline"}
                size="sm"
                aria-pressed={formData.roles.includes(role)}
                onClick={() => toggleRole(role)}
              >
                {role}
              </Button>
            ))}
          </div>
        </div>

        <ToggleRow
          label="This is Me"
          // Said under the switch rather than as a warning paragraph: with the
          // card always editable, that paragraph sat on every other person's
          // card permanently.
          description={
            !formData.isMe && existingSelfId ? "Your own card. Turning this on moves it here." : "Your own card"
          }
          checked={formData.isMe}
          onCheckedChange={handleIsMeChange}
        />
      </FormSection>

      {/* The seat and the PF convention are a USER setting now (Settings ›
          Logging, synced): one place to set them, and never a fixed rule.
          What the card still carries is read only as their fallback. */}
      {formData.isMe && (
        <FormSection title="Logging">
          <Link
            href="/settings?selected=logging"
            className="flex items-center justify-between px-4 py-3.5 row-divider hover:bg-secondary/50"
          >
            <span>
              <span className="block text-foreground">Seat and logged role</span>
              <span className="block text-xs text-muted-foreground">
                {seatLabel}. Set in Settings › Logging.
              </span>
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          </Link>
        </FormSection>
      )}

      <FormSection title="Contact">
        <SettingsRow
          label="Email"
          value={formData.email}
          onChange={(v) => updateField("email", v)}
          placeholder="email@example.com"
          type="email"
        />
        <SettingsRow
          label="Phone"
          value={formData.phone}
          onChange={(v) => updateField("phone", v)}
          placeholder="+1 234 567 8900"
          type="tel"
        />
        <SettingsRow
          label="Comment"
          value={formData.comment}
          onChange={(v) => updateField("comment", v)}
          placeholder="Add comment"
        />
      </FormSection>

      <FormSection title="Options">
        <ToggleRow
          label="Favorite"
          checked={formData.favorite}
          onCheckedChange={(checked) => updateField("favorite", checked)}
        />
      </FormSection>
    </div>
  )
}
