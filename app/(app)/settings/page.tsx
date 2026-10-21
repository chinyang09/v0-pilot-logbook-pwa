"use client"

import type React from "react"
import { ScrollIndicator } from "@/components/ui/scroll-indicator"
import { useCallback, useEffect } from "react"
import { usePersonnel } from "@/hooks/data/use-crew"
import { pickSelfCard } from "@/lib/utils/self-card"
import { seatOf, withLoggingPreferences, type Seat } from "@/lib/utils/roster/pilot-role"
import { usePreferences } from "@/components/providers/preferences-provider"
import { PageContainer } from "@/components/page-container"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { FormSection } from "@/components/ui/form-section"
import { SettingsRow, ToggleRow, SelectRow } from "@/components/ui/settings-row"
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
import type { DisplayPreferences, AutoFillPreferences, BottomNavTab } from "@/types/db/stores.types"

// ─── Data ────────────────────────────────────────────────────

const AUTO_FILL_FIELDS: Array<{
  key: keyof AutoFillPreferences
  label: string
  description: string
}> = [
  { key: "night", label: "Night", description: "Calculate night time from solar position" },
  { key: "pic", label: "PIC", description: "Set PIC time equal to block time when role is PIC" },
  { key: "sic", label: "SIC", description: "Set SIC time equal to block time when role is SIC" },
  { key: "p1us", label: "P1u/s (PICUS)", description: "Set PICUS time when role is PICUS" },
  { key: "dualRcvd", label: "Dual Received", description: "Set dual time when role is Dual" },
  { key: "dualGiven", label: "Dual Given", description: "Set instructor time when role is Instructor" },
  { key: "xc", label: "Cross Country", description: "Set XC time to block time when departure differs from arrival" },
  { key: "ifr", label: "IFR", description: "Set IFR time equal to flight time" },
  { key: "actualInst", label: "Actual Instrument", description: "Auto-fill actual instrument time" },
  { key: "simInst", label: "Simulated Instrument", description: "Auto-fill simulated instrument time" },
  { key: "multiPilot", label: "Multi-Pilot", description: "Set multi-pilot time equal to block time" },
  { key: "solo", label: "Solo", description: "Set solo time equal to block time" },
  { key: "ground", label: "Ground", description: "Auto-fill ground training time" },
  { key: "nvg", label: "NVG", description: "Auto-fill night vision goggle time" },
  { key: "sfe", label: "SFI/SFE", description: "Auto-fill simulator flight instructor/examiner time" },
  { key: "flightEngineer", label: "Flight Engineer (SO)", description: "Auto-fill flight engineer / second officer time" },
]

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
  { key: "logging", label: "Logging", icon: NotebookPen, description: "Your seat and the role you log" },
  { key: "navigation", label: "Navigation", icon: Navigation, description: "Bottom tab bar" },
  { key: "display", label: "Display Options", icon: Monitor, description: "Time, airport, coordinate format" },
  { key: "autofill", label: "Auto-Fill Fields", icon: Clock, description: "Auto-populate time fields" },
  { key: "duty", label: "Duty Time Defaults", icon: Plane, description: "Report and debrief times" },
]

// ─── Detail panel wrapper with frosted header ───────────────

function SettingsDetailPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full relative">
      <div className="h-full overflow-auto overscroll-contain scrollbar-hide">
        <ScrollIndicator />
        <div className="h-chrome-top" />
        {children}
        <div className="h-chrome-bottom" />
      </div>
    </div>
  )
}

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

  return (
    <div className="px-panel py-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Logging</h2>
        <p className="text-sm text-muted-foreground">
          The role new and imported flights start with. Saved to your account, so every device logs the same way.
        </p>
      </div>
      <FormSection>
        <SelectRow<Seat | "unset">
          label="My seat"
          description={
            seat === "captain"
              ? "Logged PIC, flying or monitoring."
              : seat === "first_officer"
                ? "Logged SIC when monitoring."
                : "Sets the role new and imported flights start with."
          }
          value={seat ?? "unset"}
          onValueChange={(v) => v !== "unset" && updateLogging({ seat: v })}
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
            onValueChange={(v) => updateLogging({ pfRole: v })}
            options={[
              { value: "SIC", label: "SIC" },
              { value: "PICUS", label: "PICUS" },
            ]}
          />
        )}
        {seat === "first_officer" && pfRole === "PICUS" && (
          <SettingsRow
            label="PICUS from"
            description="Your check-out date. A leg flown before it is logged SIC."
            value={pfRoleFrom}
            // "" states "no date" outright, so a date left on the crew card
            // does not show through.
            onChange={(v) => updateLogging({ pfRoleFrom: v })}
            type="date"
          />
        )}
        <SelectRow<"pf" | "pm">
          label="New flights start as"
          description="A flight you add, or a next leg or return. A recorded flight keeps what was recorded, and an import takes the report's."
          value={preferences.logging.newFlightPilotFlying ? "pf" : "pm"}
          onValueChange={(v) => updateLogging({ newFlightPilotFlying: v === "pf" })}
          options={[
            { value: "pf", label: "Pilot flying" },
            { value: "pm", label: "Pilot monitoring" },
          ]}
        />
      </FormSection>
    </div>
  )
}

function NavigationSection({ preferences, updateNavigation }: {
  preferences: ReturnType<typeof usePreferences>["preferences"]
  updateNavigation: ReturnType<typeof usePreferences>["updateNavigation"]
}) {
  return (
    <div className="px-panel py-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Navigation</h2>
        <p className="text-sm text-muted-foreground">Choose up to 4 tabs for the bottom tab bar (mobile) and the navigation pill (desktop).</p>
      </div>
      <FormSection>
        <div className="p-3">
          <SortableNavList
            tabs={ALL_NAV_TABS}
            selectedTabs={preferences.navigation.bottomNavTabs}
            onUpdate={updateNavigation}
          />
        </div>
      </FormSection>
    </div>
  )
}

function DisplaySection({ preferences, updateDisplay }: {
  preferences: ReturnType<typeof usePreferences>["preferences"]
  updateDisplay: ReturnType<typeof usePreferences>["updateDisplay"]
}) {
  return (
    <div className="px-panel py-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Display Options</h2>
        <p className="text-sm text-muted-foreground">Configure how times, airports, and coordinates are displayed.</p>
      </div>

      <FormSection>
        <SelectRow<DisplayPreferences["timeFormat"]>
          label="Time Format"
          description="Durations as 2:30 or 02:30, or a 12-hour clock for times of day. Durations never show AM/PM."
          value={preferences.display.timeFormat}
          onValueChange={(value) => updateDisplay({ timeFormat: value })}
          options={[
            { value: "24h", label: "24h (2:30)" },
            { value: "24h-padded", label: "24h (02:30)" },
            { value: "12h", label: "12h clock (2:30 PM)" },
          ]}
        />
        <SelectRow<DisplayPreferences["clockSeparator"]>
          label="Clock Times"
          description="How out/off/on/in and other clock times are punctuated. Durations always keep the colon."
          value={preferences.display.clockSeparator}
          onValueChange={(value) => updateDisplay({ clockSeparator: value })}
          options={[
            { value: "colon", label: "With colon (02:30)" },
            { value: "none", label: "No colon (0230)" },
          ]}
        />
        <ToggleRow
          label="Use Zulu Time (UTC)"
          description="Display all times in UTC"
          checked={preferences.display.useZuluTime}
          onCheckedChange={(checked) => updateDisplay({ useZuluTime: checked })}
        />
        <SelectRow<DisplayPreferences["airportIdentifier"]>
          label="Airport Identifier"
          description="Preferred airport code display"
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
          description="How lat/lon coordinates are displayed"
          value={preferences.display.coordinateFormat}
          onValueChange={(value) => updateDisplay({ coordinateFormat: value })}
          options={[
            { value: "decimal", label: "Decimal (1.3521)" },
            { value: "dms", label: "DMS (1°21'8\"N)" },
          ]}
        />
      </FormSection>
    </div>
  )
}

function AutoFillSection({ preferences, updateAutoFill }: {
  preferences: ReturnType<typeof usePreferences>["preferences"]
  updateAutoFill: ReturnType<typeof usePreferences>["updateAutoFill"]
}) {
  return (
    <div className="px-panel py-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Auto-Fill Time Fields</h2>
        <p className="text-sm text-muted-foreground">
          Choose which time fields are automatically populated when logging a flight.
          Manually entered values are never overwritten.
        </p>
      </div>
      <FormSection>
        {AUTO_FILL_FIELDS.map((field) => (
          <ToggleRow
            key={field.key}
            label={field.label}
            description={field.description}
            checked={preferences.autoFill[field.key]}
            onCheckedChange={(checked) => updateAutoFill({ [field.key]: checked })}
          />
        ))}
      </FormSection>
    </div>
  )
}

function DutyTimeSection({ preferences, updateDutyTimeDefaults }: {
  preferences: ReturnType<typeof usePreferences>["preferences"]
  updateDutyTimeDefaults: ReturnType<typeof usePreferences>["updateDutyTimeDefaults"]
}) {
  const regulation = preferences.dutyTimeDefaults.regulationType ?? "CAAS"
  return (
    <div className="px-panel py-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Duty Time Defaults</h2>
        <p className="text-sm text-muted-foreground">Default report and debrief times used for duty period calculations.</p>
      </div>

      <FormSection>
        <SelectRow<"CAAS" | "FAA" | "EASA">
          label="Regulation"
          description="FTL ruleset used for FDP limits & rest"
          value={regulation}
          onValueChange={(v) => updateDutyTimeDefaults({ regulationType: v })}
          options={[
            { value: "CAAS", label: "CAAS" },
            { value: "FAA", label: "FAA" },
            { value: "EASA", label: "EASA" },
          ]}
        />
        <SettingsRow
          label="Minutes Before Scheduled OUT"
          description="Report time before departure"
          type="number"
          inputMode="numeric"
          swipeToClear={false}
          value={String(preferences.dutyTimeDefaults.minutesBeforeOut)}
          onChange={(v) => {
            const val = Number.parseInt(v, 10)
            if (!Number.isNaN(val) && val >= 0 && val <= 240) {
              updateDutyTimeDefaults({ minutesBeforeOut: val })
            }
          }}
        />
        <SettingsRow
          label="Minutes After IN"
          description="Debrief time after arrival"
          type="number"
          inputMode="numeric"
          swipeToClear={false}
          value={String(preferences.dutyTimeDefaults.minutesAfterIn)}
          onChange={(v) => {
            const val = Number.parseInt(v, 10)
            if (!Number.isNaN(val) && val >= 0 && val <= 240) {
              updateDutyTimeDefaults({ minutesAfterIn: val })
            }
          }}
        />
      </FormSection>
    </div>
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
    const wrap = (content: React.ReactNode) => (
      <SettingsDetailPanel>
        {content}
      </SettingsDetailPanel>
    )
    switch (key) {
      case "appearance":
        return wrap(<AppearanceSettings />)
      case "logging":
        return wrap(<LoggingSection preferences={preferences} updateLogging={prefs.updateLogging} />)
      case "navigation":
        return wrap(<NavigationSection preferences={preferences} updateNavigation={prefs.updateNavigation} />)
      case "display":
        return wrap(<DisplaySection preferences={preferences} updateDisplay={prefs.updateDisplay} />)
      case "autofill":
        return wrap(<AutoFillSection preferences={preferences} updateAutoFill={prefs.updateAutoFill} />)
      case "duty":
        return wrap(<DutyTimeSection preferences={preferences} updateDutyTimeDefaults={prefs.updateDutyTimeDefaults} />)
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
      setDetailContent(
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p>Select a setting to configure</p>
        </div>
      )
    }
  }, [selectedId, isDesktop, renderSection, setDetailContent, setSelectedId])

  if (isLoading) {
    return (
      <PageContainer>
        <PageLoading />
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <div className="px-4 pt-4">
        <FormSection>
          {SECTIONS.map((section) => {
            const Icon = section.icon
            const isActive = selectedId === section.key
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
