"use client"

import { usePreferences } from "@/components/providers/preferences-provider"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Monitor, Clock, Plane, Loader2 } from "lucide-react"
import type { DisplayPreferences, AutoFillPreferences } from "@/types/db/stores.types"

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

export default function SettingsPage() {
  const { preferences, isLoading, updateDisplay, updateAutoFill, updateDutyTimeDefaults } = usePreferences()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6 pb-safe">
      <h1 className="text-2xl font-bold">Settings</h1>

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
  )
}
