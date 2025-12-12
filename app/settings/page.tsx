"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { getUserPreferences, saveUserPreferences, getDefaultFieldOrder } from "@/lib/indexed-db"
import { ArrowUp, ArrowDown, Eye, EyeOff } from "lucide-react"

type SectionKey = "flight" | "time" | "crew" | "landings" | "approaches" | "notes"

const fieldLabels: Record<string, string> = {
  date: "Date",
  flightNumber: "Flight No",
  aircraft: "Aircraft",
  from: "From",
  to: "To",
  out: "Out",
  off: "Off",
  on: "On",
  in: "In",
  total: "Total",
  night: "Night",
  p1us: "P1 U/S",
  sic: "SIC",
  xc: "Cross Country",
  ifr: "IFR",
  actualInst: "Actual Inst",
  simInst: "Sim Inst",
  pf: "Pilot Flying",
  pic: "PIC/P1",
  sic: "SIC/P2",
  observer: "Observer",
  dayTO: "Day T/O",
  dayLdg: "Day Ldg",
  nightTO: "Night T/O",
  nightLdg: "Night Ldg",
  autolands: "Autolands",
  app1: "Approach 1",
  app2: "Approach 2",
  holds: "Holds",
  remarks: "Remarks",
  ipcIcc: "IPC/ICC",
}

export default function SettingsPage() {
  const [fieldOrder, setFieldOrder] = useState<Record<SectionKey, string[]>>({
    flight: [],
    time: [],
    crew: [],
    landings: [],
    approaches: [],
    notes: [],
  })
  const [visibleFields, setVisibleFields] = useState<Record<string, boolean>>({})
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    loadPreferences()
  }, [])

  const loadPreferences = async () => {
    const prefs = await getUserPreferences()
    if (prefs) {
      setFieldOrder(prefs.fieldOrder)
      setVisibleFields(prefs.visibleFields)
    } else {
      const defaultOrder = await getDefaultFieldOrder()
      setFieldOrder(defaultOrder)
      // All fields visible by default
      const defaultVisible: Record<string, boolean> = {}
      Object.values(defaultOrder)
        .flat()
        .forEach((field) => {
          defaultVisible[field] = true
        })
      setVisibleFields(defaultVisible)
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await saveUserPreferences({ fieldOrder, visibleFields })
      alert("Settings saved!")
    } catch (error) {
      console.error("Failed to save settings:", error)
      alert("Failed to save settings")
    } finally {
      setIsSaving(false)
    }
  }

  const moveField = (section: SectionKey, index: number, direction: "up" | "down") => {
    const newOrder = [...fieldOrder[section]]
    const targetIndex = direction === "up" ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= newOrder.length) return

    const temp = newOrder[index]
    newOrder[index] = newOrder[targetIndex]
    newOrder[targetIndex] = temp

    setFieldOrder({ ...fieldOrder, [section]: newOrder })
  }

  const toggleFieldVisibility = (fieldId: string) => {
    setVisibleFields({ ...visibleFields, [fieldId]: !visibleFields[fieldId] })
  }

  const sections: { key: SectionKey; title: string }[] = [
    { key: "flight", title: "Flight Section" },
    { key: "time", title: "Time Section" },
    { key: "crew", title: "Crew Section" },
    { key: "landings", title: "Landings Section" },
    { key: "approaches", title: "Approaches Section" },
    { key: "notes", title: "Notes Section" },
  ]

  return (
    <div className="container max-w-2xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Field Configuration</h1>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Customize the order and visibility of fields in the flight entry form. Changes will take effect immediately
        after saving.
      </p>

      {sections.map((section) => (
        <Card key={section.key} className="p-4">
          <h2 className="text-lg font-semibold mb-4">{section.title}</h2>
          <div className="space-y-2">
            {fieldOrder[section.key].map((fieldId, index) => (
              <div key={fieldId} className="flex items-center gap-3 p-2 bg-secondary/30 rounded-lg">
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => moveField(section.key, index, "up")}
                    disabled={index === 0}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => moveField(section.key, index, "down")}
                    disabled={index === fieldOrder[section.key].length - 1}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>

                <span className="flex-1 text-sm font-medium">{fieldLabels[fieldId] || fieldId}</span>

                <div className="flex items-center gap-2">
                  {visibleFields[fieldId] ? (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  )}
                  <Switch checked={visibleFields[fieldId]} onCheckedChange={() => toggleFieldVisibility(fieldId)} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}

      <Button onClick={handleSave} disabled={isSaving} className="w-full">
        {isSaving ? "Saving..." : "Save Changes"}
      </Button>
    </div>
  )
}
