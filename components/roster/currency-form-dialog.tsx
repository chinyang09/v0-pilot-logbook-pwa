/**
 * Currency Form Dialog Component
 * Form for adding/editing currency entries
 */

"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Save, Loader2 } from "lucide-react"
import { addCurrency, updateCurrency } from "@/lib/db"
import type { CurrencyWithStatus, CurrencyCode } from "@/types/entities/roster.types"

const PREDEFINED_CURRENCIES: Array<{ code: CurrencyCode; description: string }> = [
  { code: "MEDIC", description: "Medical Certificate" },
  { code: "SEP-E", description: "SEP Exam" },
  { code: "SEP-L", description: "SEP LET" },
  { code: "SEP-W", description: "SEP WET" },
  { code: "OPC320", description: "OPC A320" },
  { code: "ARIR32", description: "AR/IR A320" },
  { code: "RT320", description: "Recurrent Training A320" },
  { code: "OLC320", description: "OLC A320" },
  { code: "CRM", description: "CRM Training" },
  { code: "PASSP", description: "Passport" },
  { code: "LICENCE", description: "Pilot Licence" },
  { code: "LC", description: "Line Check" },
  { code: "PPC", description: "Proficiency Check" },
  { code: "CUSTOM", description: "Custom Currency" },
]

interface CurrencyFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currency?: CurrencyWithStatus | null
  onSaved?: () => void
}

export function CurrencyFormDialog({
  open,
  onOpenChange,
  currency,
  onSaved,
}: CurrencyFormDialogProps) {
  const isEdit = !!currency

  // Form state
  const [currencyCode, setCurrencyCode] = useState<string>("MEDIC")
  const [description, setDescription] = useState("")
  const [expiryDate, setExpiryDate] = useState("")
  const [warningDays, setWarningDays] = useState("30")
  const [criticalDays, setCriticalDays] = useState("7")
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [documentNumber, setDocumentNumber] = useState("")
  const [notes, setNotes] = useState("")
  const [isCustom, setIsCustom] = useState(false)
  const [customDescription, setCustomDescription] = useState("")

  const [isSaving, setIsSaving] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)

  // Load currency data when editing
  useEffect(() => {
    if (currency) {
      setCurrencyCode(currency.code)
      setDescription(currency.description)
      setExpiryDate(currency.expiryDate)
      setWarningDays(currency.warningDays.toString())
      setCriticalDays(currency.criticalDays.toString())
      setAutoUpdate(currency.autoUpdate)
      setDocumentNumber(currency.documentNumber || "")
      setNotes(currency.notes || "")
      setIsCustom(currency.code === "CUSTOM")
      setCustomDescription(currency.code === "CUSTOM" ? currency.description : "")
    } else {
      // Reset for new currency
      const defaultCurrency = PREDEFINED_CURRENCIES[0]
      setCurrencyCode(defaultCurrency.code)
      setDescription(defaultCurrency.description)
      setExpiryDate("")
      setWarningDays("30")
      setCriticalDays("7")
      setAutoUpdate(true)
      setDocumentNumber("")
      setNotes("")
      setIsCustom(false)
      setCustomDescription("")
    }
  }, [currency, open])

  const handleCurrencyCodeChange = (code: string) => {
    setCurrencyCode(code)
    setIsCustom(code === "CUSTOM")

    if (code !== "CUSTOM") {
      const selected = PREDEFINED_CURRENCIES.find((c) => c.code === code)
      if (selected) {
        setDescription(selected.description)
      }
    }
  }

  const handleSave = async () => {
    try {
      setIsSaving(true)

      const finalDescription = isCustom ? customDescription : description

      if (!finalDescription.trim()) {
        alert("Please enter a description")
        return
      }

      if (!expiryDate) {
        alert("Please enter an expiry date")
        return
      }

      const currencyData = {
        code: currencyCode,
        description: finalDescription,
        expiryDate,
        warningDays: parseInt(warningDays) || 30,
        criticalDays: parseInt(criticalDays) || 7,
        autoUpdate,
        documentNumber: documentNumber || undefined,
        notes: notes || undefined,
        lastUpdatedFrom: "manual" as const,
      }

      if (isEdit && currency) {
        await updateCurrency(currency.id, currencyData)
      } else {
        await addCurrency(currencyData)
      }

      setShowSuccess(true)
      setTimeout(() => {
        setShowSuccess(false)
        onOpenChange(false)
        onSaved?.()
      }, 1000)
    } catch (error) {
      console.error("Failed to save currency:", error)
      alert("Failed to save currency")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Currency" : "Add Currency"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update currency and expiry information"
              : "Add a new currency or expiry date to track"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Currency Type */}
          <div className="space-y-2">
            <Label htmlFor="currency-code">Currency Type</Label>
            <Select value={currencyCode} onValueChange={handleCurrencyCodeChange}>
              <SelectTrigger id="currency-code">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PREDEFINED_CURRENCIES.map((curr) => (
                  <SelectItem key={curr.code} value={curr.code}>
                    {curr.code === "CUSTOM" ? "Custom" : `${curr.code} - ${curr.description}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Custom Description */}
          {isCustom && (
            <div className="space-y-2">
              <Label htmlFor="custom-description">Description *</Label>
              <Input
                id="custom-description"
                value={customDescription}
                onChange={(e) => setCustomDescription(e.target.value)}
                placeholder="e.g., Company ID Card, Security Clearance"
              />
            </div>
          )}

          {/* Expiry Date */}
          <div className="space-y-2">
            <Label htmlFor="expiry-date">Expiry Date *</Label>
            <Input
              id="expiry-date"
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
            />
          </div>

          {/* Warning Days */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="warning-days">Warning (days)</Label>
              <Input
                id="warning-days"
                type="number"
                value={warningDays}
                onChange={(e) => setWarningDays(e.target.value)}
                placeholder="30"
              />
            </div>

            {/* Critical Days */}
            <div className="space-y-2">
              <Label htmlFor="critical-days">Critical (days)</Label>
              <Input
                id="critical-days"
                type="number"
                value={criticalDays}
                onChange={(e) => setCriticalDays(e.target.value)}
                placeholder="7"
              />
            </div>
          </div>

          {/* Document Number */}
          <div className="space-y-2">
            <Label htmlFor="document-number">Document/Certificate Number</Label>
            <Input
              id="document-number"
              value={documentNumber}
              onChange={(e) => setDocumentNumber(e.target.value)}
              placeholder="Optional"
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
            />
          </div>

          {/* Auto-update Toggle */}
          <div className="flex items-center justify-between pt-2">
            <div className="space-y-0.5">
              <Label htmlFor="auto-update">Auto-update from schedule</Label>
              <p className="text-xs text-muted-foreground">
                Automatically update expiry date when importing schedule CSV
              </p>
            </div>
            <Switch
              id="auto-update"
              checked={autoUpdate}
              onCheckedChange={setAutoUpdate}
            />
          </div>

          {/* Save Button */}
          <div className="flex items-center gap-2 pt-4">
            <Button onClick={handleSave} disabled={isSaving} className="flex-1">
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : showSuccess ? (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Saved!
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  {isEdit ? "Update" : "Add"} Currency
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
