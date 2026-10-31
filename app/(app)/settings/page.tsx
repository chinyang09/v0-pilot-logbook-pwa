"use client"

import type React from "react"
import { ReadingPanel } from "@/components/ui/detail-form-panel"
import { useCallback, useEffect, useState } from "react"
import { usePersonnel } from "@/hooks/data/use-crew"
import { pickSelfCard } from "@/lib/utils/self-card"
import { seatOf, withLoggingPreferences, type Seat } from "@/lib/utils/roster/pilot-role"
import { usePreferences } from "@/components/providers/preferences-provider"
import { PageContainer } from "@/components/page-container"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { FormSection } from "@/components/ui/form-section"
import { SettingsRow, ToggleRow, SelectRow } from "@/components/ui/settings-row"
import { DateRow } from "@/components/ui/date-row"
import { PageLoading } from "@/components/ui/page-loading"
import { SortableNavList } from "@/components/sortable-nav-list"
import { AppearanceSettings } from "@/components/appearance-settings"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import {
  Monitor, Clock, Plane, Sun,
  LayoutDashboard, Book, Calendar, Users, MapPin, Award,
  Settings, UserCircle, Navigation, ChevronRight, NotebookPen,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { LOGBOOK_AUTHORITIES, OFFERED_AUTHORITIES, TIME_CATEGORIES, categoryLabel, roleLabel, type LogbookAuthority } from "@/lib/utils/logbook-rules"
import type { DisplayPreferences, AutoFillPreferences, BottomNavTab } from "@/types/db/stores.types"

// ─── Data ────────────────────────────────────────────────────

/** How each Auto-fill switch fills its category. The NAME is the logbook rules' (`logbook-rules.ts`). */
const AUTO_FILL_HOW: Record<keyof AutoFillPreferences, string> = {
  night: "From the sun at both airports.",
  pic: "Block time, as PIC.",
  sic: "Block time, as co-pilot.",
  p1us: "Block time, as PIC under supervision.",
  dualRcvd: "Block time, under instruction.",
  dualGiven: "Block time, as instructor.",
  multiPilot: "Block time, on a two-pilot type or crew.",
  solo: "Block time, as PIC alone. Never on a two-pilot type.",
  xc: "Block time, when the airports differ.",
  ifr: "Flight time, every flight.",
  actualInst: "Flight time, every flight.",
  simInst: "Flight time, every flight.",
}

const ALL_NAV_TABS: Array<{ value: BottomNavTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { value: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { value: "logbook", label: "Logbook", icon: Book },
  { value: "roster", label: "Roster", icon: Calendar },
  { value: "aircraft", label: "Aircraft", icon: Plane },
  { value: "crew", label: "Crew", icon: Users },
  { value: "airports", label: "Airports", icon: MapPin },
  { value: "currencies", label: "Currencies", icon: Award },
  { value: "settings", label: "Settings", icon: Settings },
  { value: "account", label: "Account", icon: UserCircle },
]

type SectionKey = "appearance" | "logging" | "navigation" | "display" | "autofill" | "duty"

interface SectionDef {
  key: SectionKey
  label: string
  icon: React.ComponentType<{ className?: string }>
  description: string
}

const SECTIONS: SectionDef[] = [
  { key: "appearance", label: "Appearance", icon: Sun, description: "Mode and palette" },
  { key: "logging", label: "Logging", icon: NotebookPen, description: "Seat, role and airline" },
  { key: "navigation", label: "Navigation", icon: Navigation, description: "Bottom tab bar" },
  { key: "display", label: "Display Options", icon: Monitor, description: "Times, airports, coordinates" },
  { key: "autofill", label: "Auto-Fill Fields", icon: Clock, description: "Times filled in for you" },
  { key: "duty", label: "Duty Time Defaults", icon: Plane, description: "Report and debrief times" },
]

// ─── Detail panel content for each section ──────────────────

/**
 * The seat and the PF convention — what every new and imported flight is
 * logged as. A USER setting: it syncs, and it is the pilot's own choice, never
 * a fixed rule (PICUS in particular is creditable only under an operator's
 * supervision method). Until it is set here, the "This is me" crew card's
 * values answer, which is where these lived before (`withLoggingPreferences`).
 */
function LoggingSection({ preferences, updateLogging }: {
  preferences: ReturnType<typeof usePreferences>["preferences"]
  updateLogging: ReturnType<typeof usePreferences>["updateLogging"]
}) {
  const { personnel } = usePersonnel()
  const self = pickSelfCard(personnel ?? [])
  const effective = withLoggingPreferences(self, preferences.logging)
  const seat = seatOf(effective)
  const pfRole = effective?.pfRole ?? "SIC"
  const pfRoleFrom = effective?.pfRoleFrom ?? ""
  const authority = preferences.logging.authority

  return (
    <ReadingPanel title="Logging" description="How new and imported flights are logged. Synced to every device.">
      <FormSection>
        <SelectRow<LogbookAuthority>
          label="Logbook Rules"
          description={`${LOGBOOK_AUTHORITIES.find((a) => a.value === authority)?.description}. Names only; figures never change.`}
          value={authority}
          onValueChange={(v) => updateLogging({ authority: v })}
          options={OFFERED_AUTHORITIES.map((a) => ({ value: a.value, label: a.label }))}
        />
        <SelectRow<Seat | "unset">
          label="My Seat"
          description={
            seat === "captain"
              ? "Logged PIC, flying or monitoring."
              : seat === "first_officer"
                ? "Logged SIC when monitoring."
                : "Sets the role new flights start with."
          }
          value={seat ?? "unset"}
          onValueChange={(v) => v !== "unset" && updateLogging({ seat: v })}
          options={[
            ...(seat ? [] : [{ value: "unset" as const, label: "Not Set" }]),
            { value: "captain", label: "Captain" },
            { value: "first_officer", label: "First Officer" },
          ]}
        />
        {seat === "first_officer" && (
          <SelectRow<"SIC" | "PICUS">
            label="When Pilot Flying, Log As"
            description="PICUS only where your operator allows it."
            value={pfRole}
            onValueChange={(v) => updateLogging({ pfRole: v })}
            options={[
              { value: "SIC", label: roleLabel("SIC", authority) },
              { value: "PICUS", label: roleLabel("PICUS", authority) },
            ]}
          />
        )}
        {seat === "first_officer" && pfRole === "PICUS" && (
          <DateRow
            label="PICUS From"
            description="Your check-out. Earlier legs log as SIC."
            value={pfRoleFrom}
            // "" states "no date" outright, so a date left on the crew card
            // does not show through.
            onChange={(v) => updateLogging({ pfRoleFrom: v })}
            placeholder="Not Set"
            clearable
          />
        )}
        <AirlineRow value={preferences.logging.airline} onCommit={(airline) => updateLogging({ airline })} />
        <SelectRow<"pf" | "pm">
          label="New Flights Start As"
          description="For flights you add. Imports keep the report's."
          value={preferences.logging.newFlightPilotFlying ? "pf" : "pm"}
          onValueChange={(v) => updateLogging({ newFlightPilotFlying: v === "pf" })}
          options={[
            { value: "pf", label: "Pilot Flying" },
            { value: "pm", label: "Pilot Monitoring" },
          ]}
        />
      </FormSection>
    </ReadingPanel>
  )
}

/**
 * The pilot's airline by IATA code. Held as a draft while typed and saved on
 * leaving the field — a synced setting written per keystroke would send "T"
 * and then "TR" to every device.
 */
function AirlineRow({ value, onCommit }: { value: string | null; onCommit: (airline: string | null) => void }) {
  const [draft, setDraft] = useState(value ?? "")
  const [seen, setSeen] = useState(value)
  // Follow the stored value when it changes underneath (another device).
  if (seen !== value) {
    setSeen(value)
    setDraft(value ?? "")
  }
  const code = draft.trim().toUpperCase()
  const valid = code === "" || /^[A-Z0-9]{2}$/.test(code)
  return (
    <SettingsRow
      label="Airline"
      description={
        valid
          ? "Prefixes flight numbers: 288 → TR288."
          : "Two letters or digits, e.g. TR, 3K."
      }
      value={draft}
      onChange={(v) => setDraft(v.toUpperCase().slice(0, 2))}
      onBlur={() => {
        if (valid && (code || null) !== value) onCommit(code || null)
      }}
      placeholder="TR"
      uppercase
      maxLength={2}
    />
  )
}

function NavigationSection({ preferences, updateNavigation }: {
  preferences: ReturnType<typeof usePreferences>["preferences"]
  updateNavigation: ReturnType<typeof usePreferences>["updateNavigation"]
}) {
  return (
    <ReadingPanel title="Navigation" description="Up to 4 tabs in the tab bar.">
      <FormSection>
        <div className="p-3">
          <SortableNavList
            tabs={ALL_NAV_TABS}
            selectedTabs={preferences.navigation.bottomNavTabs}
            onUpdate={updateNavigation}
          />
        </div>
      </FormSection>
    </ReadingPanel>
  )
}

function DisplaySection({ preferences, updateDisplay }: {
  preferences: ReturnType<typeof usePreferences>["preferences"]
  updateDisplay: ReturnType<typeof usePreferences>["updateDisplay"]
}) {
  return (
    <ReadingPanel title="Display Options" description="How times, airports and coordinates appear.">

      <FormSection>
        <SelectRow<DisplayPreferences["timeFormat"]>
          label="Time Format"
          description="Durations never show AM/PM."
          value={preferences.display.timeFormat}
          onValueChange={(value) => updateDisplay({ timeFormat: value })}
          options={[
            { value: "24h", label: "24h (2:30)" },
            { value: "24h-padded", label: "24h (02:30)" },
            { value: "12h", label: "12h Clock (2:30 PM)" },
          ]}
        />
        <SelectRow<DisplayPreferences["clockSeparator"]>
          label="Clock Times"
          description="Durations keep the colon."
          value={preferences.display.clockSeparator}
          onValueChange={(value) => updateDisplay({ clockSeparator: value })}
          options={[
            { value: "colon", label: "With Colon (02:30)" },
            { value: "none", label: "No Colon (0230)" },
          ]}
        />
        <ToggleRow
          label="Use Zulu Time (UTC)"
          description="Show all times in UTC."
          checked={preferences.display.useZuluTime}
          onCheckedChange={(checked) => updateDisplay({ useZuluTime: checked })}
        />
        <SelectRow<DisplayPreferences["airportIdentifier"]>
          label="Airport Identifier"
          description="Code shown for airports."
          value={preferences.display.airportIdentifier}
          onValueChange={(value) => updateDisplay({ airportIdentifier: value })}
          options={[
            { value: "icao", label: "ICAO (WSSS)" },
            { value: "iata", label: "IATA (SIN)" },
            { value: "both", label: "Both (WSSS/SIN)" },
          ]}
        />
        <SelectRow<DisplayPreferences["coordinateFormat"]>
          label="Coordinate Format"
          description="Latitude and longitude."
          value={preferences.display.coordinateFormat}
          onValueChange={(value) => updateDisplay({ coordinateFormat: value })}
          options={[
            { value: "decimal", label: "Decimal (1.3521)" },
            { value: "dms", label: "DMS (1°21'8\"N)" },
          ]}
        />
      </FormSection>
    </ReadingPanel>
  )
}

function AutoFillSection({ preferences, updateAutoFill }: {
  preferences: ReturnType<typeof usePreferences>["preferences"]
  updateAutoFill: ReturnType<typeof usePreferences>["updateAutoFill"]
}) {
  return (
    <ReadingPanel title="Auto-Fill Fields" description="Times filled in for you. What you enter is never overwritten.">
      <FormSection>
        {TIME_CATEGORIES.map((category) => (
          <ToggleRow
            key={category.autoFill}
            label={categoryLabel(category, preferences.logging.authority).label}
            description={AUTO_FILL_HOW[category.autoFill]}
            checked={preferences.autoFill[category.autoFill]}
            onCheckedChange={(checked) => updateAutoFill({ [category.autoFill]: checked })}
          />
        ))}
      </FormSection>
    </ReadingPanel>
  )
}

function DutyTimeSection({ preferences, updateDutyTimeDefaults }: {
  preferences: ReturnType<typeof usePreferences>["preferences"]
  updateDutyTimeDefaults: ReturnType<typeof usePreferences>["updateDutyTimeDefaults"]
}) {
  const regulation = preferences.dutyTimeDefaults.regulationType ?? "CAAS"
  return (
    <ReadingPanel title="Duty Time Defaults" description="Used to work out duty periods.">

      <FormSection>
        <SelectRow<"CAAS" | "FAA" | "EASA">
          label="Regulation"
          description="Rules for FDP limits and rest."
          value={regulation}
          onValueChange={(v) => updateDutyTimeDefaults({ regulationType: v })}
          options={[
            { value: "CAAS", label: "CAAS" },
            { value: "FAA", label: "FAA" },
            { value: "EASA", label: "EASA" },
          ]}
        />
        <MinutesRow
          label="Report"
          description="Minutes before scheduled OUT."
          minutes={preferences.dutyTimeDefaults.minutesBeforeOut}
          onCommit={(minutesBeforeOut) => updateDutyTimeDefaults({ minutesBeforeOut })}
        />
        <MinutesRow
          label="Debrief"
          description="Minutes after IN."
          minutes={preferences.dutyTimeDefaults.minutesAfterIn}
          onCommit={(minutesAfterIn) => updateDutyTimeDefaults({ minutesAfterIn })}
        />
      </FormSection>
    </ReadingPanel>
  )
}

/**
 * A minutes field that can be EDITED. Bound straight to the stored value, it
 * refused the empty string a backspace produces, so "60" could not be cleared
 * to type "45" — and every keystroke on the way was a saved, synced figure
 * (deleting "30" stored 3). It edits a draft and commits once, when the field
 * is left; a blank or out-of-range draft puts the stored figure back.
 */
function MinutesRow({
  label,
  description,
  minutes,
  onCommit,
}: {
  label: string
  description: string
  minutes: number
  onCommit: (minutes: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <SettingsRow
      label={label}
      description={description}
      inputMode="numeric"
      swipeToClear={false}
      value={draft ?? String(minutes)}
      onChange={(v) => setDraft(v.replace(/\D/g, "").slice(0, 3))}
      onBlur={() => {
        const val = draft === null ? Number.NaN : Number.parseInt(draft, 10)
        if (!Number.isNaN(val) && val <= 240 && val !== minutes) onCommit(val)
        setDraft(null)
      }}
    />
  )
}

// ─── Main page ──────────────────────────────────────────────

export default function SettingsPage() {
  const prefs = usePreferences()
  const { preferences, isLoading } = prefs
  const { selectedId, setSelectedId, setDetailContent } = useDetailPanel()
  const isDesktop = useIsDesktop()

  // Clear stale keep-alive page actions
  useRegisterMainActions(null, true)

  // Build detail content for a given section
  const renderSection = useCallback((key: SectionKey) => {
    const section = SECTIONS.find((s) => s.key === key)
    if (!section) return null
    switch (key) {
      case "appearance":
        return <AppearanceSettings />
      case "logging":
        return <LoggingSection preferences={preferences} updateLogging={prefs.updateLogging} />
      case "navigation":
        return <NavigationSection preferences={preferences} updateNavigation={prefs.updateNavigation} />
      case "display":
        return <DisplaySection preferences={preferences} updateDisplay={prefs.updateDisplay} />
      case "autofill":
        return <AutoFillSection preferences={preferences} updateAutoFill={prefs.updateAutoFill} />
      case "duty":
        return <DutyTimeSection preferences={preferences} updateDutyTimeDefaults={prefs.updateDutyTimeDefaults} />
      default:
        return null
    }
  }, [preferences, prefs])

  // Sync detail panel when selection or preferences change
  useEffect(() => {
    const sectionKey = (selectedId as SectionKey) || null
    if (sectionKey && SECTIONS.find((s) => s.key === sectionKey)) {
      setDetailContent(renderSection(sectionKey))
    } else if (!sectionKey && isDesktop) {
      // Auto-select first section on desktop so the panel isn't empty.
      // explicit:false — this is a programmatic default, so it must not write
      // ?selected= or mark the route explicitly selected; either would pop the
      // full-screen mobile overlay when the viewport shrinks below the split
      // breakpoint (iPad Split View / window resize).
      setSelectedId("appearance", { explicit: false })
    } else if (!sectionKey) {
      // Nothing chosen (a phone, where no panel shows beside the list): the
      // shell's own placeholder answers.
      setDetailContent(null)
    }
  }, [selectedId, isDesktop, renderSection, setDetailContent, setSelectedId])

  if (isLoading) {
    return (
      <PageContainer title="Settings">
        <PageLoading />
      </PageContainer>
    )
  }

  return (
    <PageContainer title="Settings">
      <div className="px-panel pt-4">
        <FormSection>
          {SECTIONS.map((section) => {
            const Icon = section.icon
            // The highlight says which section the panel BESIDE the list is
            // showing. A phone has no such panel — the list is all there is
            // once a section closes — so a lit row there pointed at nothing.
            const isActive = isDesktop && selectedId === section.key
            return (
              <button
                key={section.key}
                type="button"
                className={cn(
                  "flex items-center w-full px-4 py-3.5 text-left transition-colors row-divider",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-secondary/50 active:bg-secondary/50"
                )}
                onClick={() => setSelectedId(section.key)}
              >
                <Icon className={cn("h-4 w-4 mr-3 flex-shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{section.label}</div>
                  <div className="text-xs text-muted-foreground truncate">{section.description}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 ml-2" />
              </button>
            )
          })}
        </FormSection>
      </div>
    </PageContainer>
  )
}
