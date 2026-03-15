"use client"

import type React from "react"
import { usePreferences } from "@/components/providers/preferences-provider"
import { PageContainer } from "@/components/page-container"
import { StandardPageHeader } from "@/components/standard-page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Monitor, Clock, Plane, Loader2, Sun, Moon, Laptop,
  LayoutDashboard, Book, Calendar, Users, MapPin, Award, Settings, UserCircle,
  Navigation, ChevronUp, ChevronDown, X,
} from "lucide-react"
import { useTheme } from "next-themes"
import type { DisplayPreferences, AutoFillPreferences, ThemePreference, BottomNavTab } from "@/types/db/stores.types"

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

export default function SettingsPage() {
  const { preferences, isLoading, updateDisplay, updateAutoFill, updateDutyTimeDefaults, updateNavigation } = usePreferences()
  const { setTheme } = useTheme()

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
      <div className="px-4 pt-4 pb-safe space-y-6">

      {/* Appearance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Sun className="h-4 w-4" />
            Appearance
          </CardTitle>
          <CardDescription>
            Choose your preferred theme.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                className={`flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-colors ${
                  preferences.display.theme === value
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="text-xs font-medium">{label}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Navigation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Navigation className="h-4 w-4" />
            Navigation
          </CardTitle>
          <CardDescription>
            Choose 4 tabs to display on the bottom navigation bar. Reorder with arrows.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Selected tabs with reorder */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Selected Tabs</Label>
            {preferences.navigation.bottomNavTabs.map((tabKey, index) => {
              const tabInfo = ALL_NAV_TABS.find((t) => t.value === tabKey)
              if (!tabInfo) return null
              const Icon = tabInfo.icon
              return (
                <div
                  key={tabKey}
                  className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-secondary/50"
                >
                  <Icon className="h-4 w-4 text-primary flex-shrink-0" />
                  <span className="text-sm flex-1">{tabInfo.label}</span>
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={index === 0}
                      onClick={() => {
                        const tabs = [...preferences.navigation.bottomNavTabs] as [BottomNavTab, BottomNavTab, BottomNavTab, BottomNavTab]
                        ;[tabs[index - 1], tabs[index]] = [tabs[index], tabs[index - 1]]
                        updateNavigation({ bottomNavTabs: tabs })
                      }}
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={index === 3}
                      onClick={() => {
                        const tabs = [...preferences.navigation.bottomNavTabs] as [BottomNavTab, BottomNavTab, BottomNavTab, BottomNavTab]
                        ;[tabs[index], tabs[index + 1]] = [tabs[index + 1], tabs[index]]
                        updateNavigation({ bottomNavTabs: tabs })
                      }}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        // Can't remove if only 4 — need to swap with an available tab
                        // Just remove and add first available
                        const currentTabs = preferences.navigation.bottomNavTabs
                        const available = ALL_NAV_TABS.filter((t) => !currentTabs.includes(t.value))
                        if (available.length === 0) return
                        const newTabs = [...currentTabs] as [BottomNavTab, BottomNavTab, BottomNavTab, BottomNavTab]
                        newTabs[index] = available[0].value
                        updateNavigation({ bottomNavTabs: newTabs })
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Available tabs */}
          {(() => {
            const availableTabs = ALL_NAV_TABS.filter(
              (t) => !preferences.navigation.bottomNavTabs.includes(t.value)
            )
            if (availableTabs.length === 0) return null
            return (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Available</Label>
                <div className="flex flex-wrap gap-1.5">
                  {availableTabs.map((tab) => {
                    const Icon = tab.icon
                    return (
                      <button
                        key={tab.value}
                        type="button"
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-sm hover:border-primary/50 hover:bg-primary/5 transition-colors"
                        onClick={() => {
                          // Replace last selected tab with this one
                          // (user can then reorder)
                          // Or: find first "least important" slot to replace
                          // Simple approach: just swap the last tab
                          const newTabs = [...preferences.navigation.bottomNavTabs] as [BottomNavTab, BottomNavTab, BottomNavTab, BottomNavTab]
                          newTabs[3] = tab.value
                          updateNavigation({ bottomNavTabs: newTabs })
                        }}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {tab.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </CardContent>
      </Card>

      {/* Display Options */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Monitor className="h-4 w-4" />
            Display Options
          </CardTitle>
          <CardDescription>
            Configure how times, airports, and coordinates are displayed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Time Format */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Time Format</Label>
              <p className="text-xs text-muted-foreground">How duration and block times are shown</p>
            </div>
            <Select
              value={preferences.display.timeFormat}
              onValueChange={(value: DisplayPreferences["timeFormat"]) =>
                updateDisplay({ timeFormat: value })
              }
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

          {/* Zulu Time */}
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

          {/* Airport Identifier */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Airport Identifier</Label>
              <p className="text-xs text-muted-foreground">Preferred airport code display</p>
            </div>
            <Select
              value={preferences.display.airportIdentifier}
              onValueChange={(value: DisplayPreferences["airportIdentifier"]) =>
                updateDisplay({ airportIdentifier: value })
              }
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

          {/* Coordinate Format */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Coordinate Format</Label>
              <p className="text-xs text-muted-foreground">How lat/lon coordinates are displayed</p>
            </div>
            <Select
              value={preferences.display.coordinateFormat}
              onValueChange={(value: DisplayPreferences["coordinateFormat"]) =>
                updateDisplay({ coordinateFormat: value })
              }
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
        </CardContent>
      </Card>

      {/* Auto-Fill Time Fields */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Auto-Fill Time Fields
          </CardTitle>
          <CardDescription>
            Choose which time fields are automatically populated when logging a flight.
            Manually entered values are never overwritten.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
        </CardContent>
      </Card>

      {/* Duty Time Defaults */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Plane className="h-4 w-4" />
            Duty Time Defaults
          </CardTitle>
          <CardDescription>
            Default report and debrief times used for duty period calculations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
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
        </CardContent>
      </Card>
      </div>
    </PageContainer>
  )
}
