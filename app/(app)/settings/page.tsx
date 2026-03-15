"use client"

import type React from "react"
import { useCallback, useEffect, useMemo } from "react"
import { usePreferences } from "@/components/providers/preferences-provider"
import { PageContainer } from "@/components/page-container"
import { StandardPageHeader } from "@/components/standard-page-header"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { SortableNavList } from "@/components/sortable-nav-list"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import {
  Monitor, Clock, Plane, Loader2, Sun, Moon, Laptop,
  LayoutDashboard, Book, Calendar, Users, MapPin, Award,
  Settings, UserCircle, Navigation, ChevronRight, ChevronLeft,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"
import type { DisplayPreferences, AutoFillPreferences, ThemePreference, BottomNavTab } from "@/types/db/stores.types"

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

type SectionKey = "appearance" | "navigation" | "display" | "autofill" | "duty"

interface SectionDef {
  key: SectionKey
  label: string
  icon: React.ComponentType<{ className?: string }>
  description: string
}

const SECTIONS: SectionDef[] = [
  { key: "appearance", label: "Appearance", icon: Sun, description: "Theme" },
  { key: "navigation", label: "Navigation", icon: Navigation, description: "Bottom tab bar" },
  { key: "display", label: "Display Options", icon: Monitor, description: "Time, airport, coordinate format" },
  { key: "autofill", label: "Auto-Fill Fields", icon: Clock, description: "Auto-populate time fields" },
  { key: "duty", label: "Duty Time Defaults", icon: Plane, description: "Report and debrief times" },
]

// ─── Detail panel wrapper with frosted header ───────────────

function SettingsDetailPanel({ title, onBack, children }: {
  title: string
  onBack: () => void
  children: React.ReactNode
}) {
  return (
    <div className="h-full relative">
      <header className="absolute top-0 left-0 right-0 z-50 bg-background/30 backdrop-blur-xl">
        <div className="px-2 h-12 flex items-center">
          <div className="w-16 flex-shrink-0">
            <Button variant="ghost" size="icon" onClick={onBack} className="lg:hidden h-8 w-8">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
          <h1 className="flex-1 text-center text-lg font-semibold truncate px-2">{title}</h1>
          <div className="w-16 flex-shrink-0" />
        </div>
      </header>
      <div className="h-full overflow-auto pt-12">
        {children}
      </div>
    </div>
  )
}

// ─── Detail panel content for each section ──────────────────

function AppearanceSection({ preferences, updateDisplay }: {
  preferences: ReturnType<typeof usePreferences>["preferences"]
  updateDisplay: ReturnType<typeof usePreferences>["updateDisplay"]
}) {
  const { setTheme } = useTheme()
  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Appearance</h2>
        <p className="text-sm text-muted-foreground">Choose your preferred theme.</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {([
          { value: "light" as ThemePreference, label: "Light", icon: Sun },
          { value: "dark" as ThemePreference, label: "Dark", icon: Moon },
          { value: "system" as ThemePreference, label: "System", icon: Laptop },
        ]).map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setTheme(value)
              updateDisplay({ theme: value })
            }}
            className={cn(
              "flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-colors",
              preferences.display.theme === value
                ? "border-primary bg-primary/10"
                : "border-border hover:border-primary/50"
            )}
          >
            <Icon className="h-6 w-6" />
            <span className="text-sm font-medium">{label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function NavigationSection({ preferences, updateNavigation }: {
  preferences: ReturnType<typeof usePreferences>["preferences"]
  updateNavigation: ReturnType<typeof usePreferences>["updateNavigation"]
}) {
  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Navigation</h2>
        <p className="text-sm text-muted-foreground">Choose up to 4 tabs to show on your navigation bar.</p>
      </div>
      <SortableNavList
        tabs={ALL_NAV_TABS}
        selectedTabs={preferences.navigation.bottomNavTabs}
        onUpdate={updateNavigation}
      />
    </div>
  )
}

function DisplaySection({ preferences, updateDisplay }: {
  preferences: ReturnType<typeof usePreferences>["preferences"]
  updateDisplay: ReturnType<typeof usePreferences>["updateDisplay"]
}) {
  return (
    <div className="p-4 space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Display Options</h2>
        <p className="text-sm text-muted-foreground">Configure how times, airports, and coordinates are displayed.</p>
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label>Time Format</Label>
          <p className="text-xs text-muted-foreground">How duration and block times are shown</p>
        </div>
        <Select
          value={preferences.display.timeFormat}
          onValueChange={(value: DisplayPreferences["timeFormat"]) => updateDisplay({ timeFormat: value })}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="24h">24h (2:30)</SelectItem>
            <SelectItem value="24h-padded">24h (02:30)</SelectItem>
            <SelectItem value="12h">12h (2:30 PM)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label>Use Zulu Time (UTC)</Label>
          <p className="text-xs text-muted-foreground">Display all times in UTC</p>
        </div>
        <Switch
          checked={preferences.display.useZuluTime}
          onCheckedChange={(checked) => updateDisplay({ useZuluTime: checked })}
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label>Airport Identifier</Label>
          <p className="text-xs text-muted-foreground">Preferred airport code display</p>
        </div>
        <Select
          value={preferences.display.airportIdentifier}
          onValueChange={(value: DisplayPreferences["airportIdentifier"]) => updateDisplay({ airportIdentifier: value })}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="icao">ICAO (WSSS)</SelectItem>
            <SelectItem value="iata">IATA (SIN)</SelectItem>
            <SelectItem value="both">Both (WSSS/SIN)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label>Coordinate Format</Label>
          <p className="text-xs text-muted-foreground">How lat/lon coordinates are displayed</p>
        </div>
        <Select
          value={preferences.display.coordinateFormat}
          onValueChange={(value: DisplayPreferences["coordinateFormat"]) => updateDisplay({ coordinateFormat: value })}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="decimal">Decimal (1.3521)</SelectItem>
            <SelectItem value="dms">DMS (1°21&apos;8&quot;N)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function AutoFillSection({ preferences, updateAutoFill }: {
  preferences: ReturnType<typeof usePreferences>["preferences"]
  updateAutoFill: ReturnType<typeof usePreferences>["updateAutoFill"]
}) {
  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Auto-Fill Time Fields</h2>
        <p className="text-sm text-muted-foreground">
          Choose which time fields are automatically populated when logging a flight.
          Manually entered values are never overwritten.
        </p>
      </div>
      <div className="space-y-4">
        {AUTO_FILL_FIELDS.map((field) => (
          <div key={field.key} className="flex items-center justify-between">
            <div className="space-y-0.5 flex-1 mr-4">
              <Label className="text-sm">{field.label}</Label>
              <p className="text-xs text-muted-foreground">{field.description}</p>
            </div>
            <Switch
              checked={preferences.autoFill[field.key]}
              onCheckedChange={(checked) => updateAutoFill({ [field.key]: checked })}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function DutyTimeSection({ preferences, updateDutyTimeDefaults }: {
  preferences: ReturnType<typeof usePreferences>["preferences"]
  updateDutyTimeDefaults: ReturnType<typeof usePreferences>["updateDutyTimeDefaults"]
}) {
  return (
    <div className="p-4 space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Duty Time Defaults</h2>
        <p className="text-sm text-muted-foreground">Default report and debrief times used for duty period calculations.</p>
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label>Minutes Before Scheduled OUT</Label>
          <p className="text-xs text-muted-foreground">Report time before departure</p>
        </div>
        <Input
          type="number"
          min={0}
          max={240}
          className="w-[100px]"
          value={preferences.dutyTimeDefaults.minutesBeforeOut}
          onChange={(e) => {
            const val = Number.parseInt(e.target.value, 10)
            if (!Number.isNaN(val) && val >= 0 && val <= 240) {
              updateDutyTimeDefaults({ minutesBeforeOut: val })
            }
          }}
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label>Minutes After IN</Label>
          <p className="text-xs text-muted-foreground">Debrief time after arrival</p>
        </div>
        <Input
          type="number"
          min={0}
          max={240}
          className="w-[100px]"
          value={preferences.dutyTimeDefaults.minutesAfterIn}
          onChange={(e) => {
            const val = Number.parseInt(e.target.value, 10)
            if (!Number.isNaN(val) && val >= 0 && val <= 240) {
              updateDutyTimeDefaults({ minutesAfterIn: val })
            }
          }}
        />
      </div>
    </div>
  )
}

// ─── Main page ──────────────────────────────────────────────

export default function SettingsPage() {
  const prefs = usePreferences()
  const { preferences, isLoading } = prefs
  const { selectedId, setSelectedId, setDetailContent, setHasDetailSupport } = useDetailPanel()
  const isDesktop = useIsDesktop()

  // Register detail support
  useEffect(() => {
    setHasDetailSupport(true)
    return () => setHasDetailSupport(false)
  }, [setHasDetailSupport])

  const handleBack = useCallback(() => setSelectedId(null), [setSelectedId])

  // Build detail content for a given section
  const renderSection = useCallback((key: SectionKey) => {
    const section = SECTIONS.find((s) => s.key === key)
    if (!section) return null
    const wrap = (content: React.ReactNode) => (
      <SettingsDetailPanel title={section.label} onBack={handleBack}>
        {content}
      </SettingsDetailPanel>
    )
    switch (key) {
      case "appearance":
        return wrap(<AppearanceSection preferences={preferences} updateDisplay={prefs.updateDisplay} />)
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
  }, [preferences, prefs, handleBack])

  // Sync detail panel when selection or preferences change
  useEffect(() => {
    const sectionKey = (selectedId as SectionKey) || null
    if (sectionKey && SECTIONS.find((s) => s.key === sectionKey)) {
      setDetailContent(renderSection(sectionKey))
    } else if (!sectionKey && isDesktop) {
      // Auto-select first section on desktop
      setSelectedId("appearance")
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
      <PageContainer header={<StandardPageHeader title="Settings" />}>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer header={<StandardPageHeader title="Settings" />}>
      <div className="pt-1">
        {SECTIONS.map((section) => {
          const Icon = section.icon
          const isActive = selectedId === section.key
          return (
            <button
              key={section.key}
              type="button"
              className={cn(
                "flex items-center w-full px-4 py-3.5 text-left transition-colors border-b border-border/50",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-secondary/50"
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
      </div>
    </PageContainer>
  )
}
