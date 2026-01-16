/**
 * Draft Generation Settings Component
 * Allows users to configure automatic draft flight generation
 */

"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Settings, Save, Loader2 } from "lucide-react"
import { getDraftGenerationConfig, saveDraftGenerationConfig } from "@/lib/db"
import type { DraftGenerationConfig } from "@/types/entities/roster.types"
import { DEFAULT_DRAFT_CONFIG } from "@/lib/utils/roster/draft-generator"

interface DraftSettingsProps {
  onSave?: () => void
}

export function DraftSettings({ onSave }: DraftSettingsProps) {
  const [config, setConfig] = useState<DraftGenerationConfig>(DEFAULT_DRAFT_CONFIG)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const savedConfig = await getDraftGenerationConfig()
      setConfig(savedConfig)
    } catch (error) {
      console.error("Failed to load draft config:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      setIsSaving(true)
      await saveDraftGenerationConfig(config)
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 3000)
      onSave?.()
    } catch (error) {
      console.error("Failed to save draft config:", error)
    } finally {
      setIsSaving(false)
    }
  }

  const updateConfig = (updates: Partial<DraftGenerationConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }))
  }

  const updateAutoPopulate = (key: keyof DraftGenerationConfig["autoPopulate"], value: boolean) => {
    setConfig((prev) => ({
      ...prev,
      autoPopulate: {
        ...prev.autoPopulate,
        [key]: value,
      },
    }))
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          <CardTitle>Draft Flight Generation</CardTitle>
        </div>
        <CardDescription>
          Automatically create draft flights from your schedule. Drafts can be edited before finalizing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Trigger Mode */}
        <div className="space-y-3">
          <Label htmlFor="trigger-mode">When to Create Drafts</Label>
          <Select
            value={config.triggerMode}
            onValueChange={(value) =>
              updateConfig({
                triggerMode: value as DraftGenerationConfig["triggerMode"],
              })
            }
          >
            <SelectTrigger id="trigger-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day_of">On flight day (00:00)</SelectItem>
              <SelectItem value="day_before">Day before (18:00)</SelectItem>
              <SelectItem value="report_time">Before report time</SelectItem>
              <SelectItem value="manual">Manual only</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {config.triggerMode === "day_of" &&
              "Drafts created at midnight on the day of the flight"}
            {config.triggerMode === "day_before" &&
              "Drafts created at 6 PM the day before the flight"}
            {config.triggerMode === "report_time" &&
              "Drafts created before your report time"}
            {config.triggerMode === "manual" &&
              "Drafts only created when you manually trigger them"}
          </p>
        </div>

        {/* Hours Before Report */}
        {config.triggerMode === "report_time" && (
          <div className="space-y-3">
            <Label htmlFor="hours-before">Hours Before Report Time</Label>
            <Select
              value={config.hoursBeforeReport.toString()}
              onValueChange={(value) =>
                updateConfig({ hoursBeforeReport: parseInt(value) })
              }
            >
              <SelectTrigger id="hours-before">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 hour</SelectItem>
                <SelectItem value="2">2 hours</SelectItem>
                <SelectItem value="3">3 hours</SelectItem>
                <SelectItem value="4">4 hours</SelectItem>
                <SelectItem value="6">6 hours</SelectItem>
                <SelectItem value="12">12 hours</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Auto-Populate Options */}
        <div className="space-y-3">
          <Label>Auto-Populate Flight Data</Label>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="auto-crew" className="font-normal">
                Crew assignments
              </Label>
              <Switch
                id="auto-crew"
                checked={config.autoPopulate.crew}
                onCheckedChange={(checked) => updateAutoPopulate("crew", checked)}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="auto-scheduled" className="font-normal">
                Scheduled times
              </Label>
              <Switch
                id="auto-scheduled"
                checked={config.autoPopulate.scheduledTimes}
                onCheckedChange={(checked) => updateAutoPopulate("scheduledTimes", checked)}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="auto-actual" className="font-normal">
                Actual times (if available)
              </Label>
              <Switch
                id="auto-actual"
                checked={config.autoPopulate.actualTimes}
                onCheckedChange={(checked) => updateAutoPopulate("actualTimes", checked)}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="auto-flight-number" className="font-normal">
                Flight number
              </Label>
              <Switch
                id="auto-flight-number"
                checked={config.autoPopulate.flightNumber}
                onCheckedChange={(checked) => updateAutoPopulate("flightNumber", checked)}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="auto-aircraft" className="font-normal">
                Aircraft type
              </Label>
              <Switch
                id="auto-aircraft"
                checked={config.autoPopulate.aircraftType}
                onCheckedChange={(checked) => updateAutoPopulate("aircraftType", checked)}
              />
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex items-center gap-2">
          <Button onClick={handleSave} disabled={isSaving} className="flex-1">
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Settings
              </>
            )}
          </Button>
          {showSuccess && (
            <span className="text-sm text-green-600 dark:text-green-400">Saved!</span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
