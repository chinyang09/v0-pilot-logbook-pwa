"use client"

import { Button } from "@/components/ui/button"
import { FormSection } from "@/components/ui/form-section"
import { SelectRow, SettingsRow, ToggleRow } from "@/components/ui/settings-row"
import { usePreferences } from "@/components/providers/preferences-provider"
import { seatOf, type Seat } from "@/lib/utils/roster/pilot-role"
import {
  CREW_ROLE_OPTIONS,
  type CrewFormData,
  type CrewRole,
} from "@/hooks/use-crew-form"

/**
 * Presentational crew form body shared by the crew detail panel and the
 * full-page crew route. Uses the shared FormSection + settings rows so it
 * matches the flight form's sectioned layout.
 */
export function CrewFormBody({
  formData,
  isEditing,
  existingSelfId,
  updateField,
  handleIsMeChange,
  toggleRole,
}: {
  formData: CrewFormData
  isEditing: boolean
  existingSelfId: string | null
  updateField: (field: keyof CrewFormData, value: string | boolean | string[] | null) => void
  handleIsMeChange: (checked: boolean) => void
  toggleRole: (role: CrewRole) => void
}) {
  const { preferences } = usePreferences()
  // A card made before the seat control (an import's profile) still answers
  // from its roles; the old Settings › Import Defaults value answers for the
  // PF convention until the card sets its own.
  const seat = seatOf(formData)
  const pfRole = formData.pfRole ?? preferences.importDefaults?.nonPicPfRole ?? "SIC"
  const setSeat = (next: Seat) => {
    updateField("defaultPIC", next === "captain")
    updateField("defaultSIC", next === "first_officer")
  }

  return (
    <div className="space-y-4">
      <FormSection title="Details">
        <SettingsRow
          label="Name"
          value={formData.name}
          onChange={(v) => updateField("name", v)}
          placeholder="Required"
          readOnly={!isEditing}
          required
        />
        <SettingsRow
          label="ID"
          value={formData.crewId}
          onChange={(v) => updateField("crewId", v)}
          placeholder="Crew ID"
          readOnly={!isEditing}
        />
        <SettingsRow
          label="Organization"
          value={formData.organization}
          onChange={(v) => updateField("organization", v)}
          placeholder="Company"
          readOnly={!isEditing}
        />
        <SettingsRow
          label="Licence Number"
          value={formData.licenceNumber}
          onChange={(v) => updateField("licenceNumber", v)}
          placeholder="Licence #"
          readOnly={!isEditing}
        />

        {/* Type / roles */}
        <div className="px-4 py-3.5 row-divider">
          <span className="text-foreground block mb-2">Type</span>
          {isEditing ? (
            <div className="flex flex-wrap gap-2">
              {CREW_ROLE_OPTIONS.map((role) => (
                <Button
                  key={role}
                  type="button"
                  variant={formData.roles.includes(role) ? "default" : "outline"}
                  size="sm"
                  onClick={() => toggleRole(role)}
                  className="h-8"
                >
                  {role}
                </Button>
              ))}
            </div>
          ) : (
            <span className="text-muted-foreground">
              {formData.roles.length > 0 ? formData.roles.join(", ") : "-"}
            </span>
          )}
        </div>

        <ToggleRow
          label="This is Me"
          checked={formData.isMe}
          onCheckedChange={handleIsMeChange}
          readOnly={!isEditing}
        />
        {isEditing && existingSelfId && !formData.isMe && (
          <p className="text-xs text-muted-foreground px-4 pb-3 -mt-1">
            Another crew member is already marked as &quot;Self&quot;. Enabling this will
            remove that designation.
          </p>
        )}
      </FormSection>

      {/* The pilot's own seat decides what every new and imported flight is
          logged as — see the table in lib/utils/roster/pilot-role.ts. It
          replaces Settings › Import Defaults and the two "Default PIC / SIC"
          toggles, which did nothing on anyone else's card. */}
      {formData.isMe && (
        <FormSection title="Logging">
          <SelectRow<Seat | "unset">
            label="My seat"
            description={
              seat === "captain"
                ? "New flights are logged PIC, flying or monitoring."
                : seat === "first_officer"
                  ? "New flights are logged SIC when monitoring."
                  : "Sets the role new and imported flights start with."
            }
            value={seat ?? "unset"}
            onValueChange={(v) => v !== "unset" && setSeat(v)}
            disabled={!isEditing}
            options={[
              ...(seat ? [] : [{ value: "unset" as const, label: "Not set" }]),
              { value: "captain", label: "Captain" },
              { value: "first_officer", label: "First Officer" },
            ]}
          />
          {seat === "first_officer" && (
            <SelectRow<"SIC" | "PICUS">
              label="When pilot flying, log as"
              description="PICUS only where your operator's supervision method allows it — the captain countersigns it."
              value={pfRole}
              onValueChange={(v) => updateField("pfRole", v)}
              disabled={!isEditing}
              options={[
                { value: "SIC", label: "SIC" },
                { value: "PICUS", label: "PICUS" },
              ]}
            />
          )}
        </FormSection>
      )}

      <FormSection title="Contact">
        <SettingsRow
          label="Email"
          value={formData.email}
          onChange={(v) => updateField("email", v)}
          placeholder="email@example.com"
          type="email"
          readOnly={!isEditing}
        />
        <SettingsRow
          label="Phone"
          value={formData.phone}
          onChange={(v) => updateField("phone", v)}
          placeholder="+1 234 567 8900"
          type="tel"
          readOnly={!isEditing}
        />
        <SettingsRow
          label="Comment"
          value={formData.comment}
          onChange={(v) => updateField("comment", v)}
          placeholder="Add comment"
          readOnly={!isEditing}
        />
      </FormSection>

      <FormSection title="Options">
        <ToggleRow
          label="Favorite"
          checked={formData.favorite}
          onCheckedChange={(checked) => updateField("favorite", checked)}
          readOnly={!isEditing}
        />
      </FormSection>
    </div>
  )
}
