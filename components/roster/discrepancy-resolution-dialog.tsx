/**
 * Discrepancy Resolution Dialog Component
 * Allows users to resolve discrepancies by choosing a resolution method
 */

"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Save, Loader2, FileText, Calendar, Merge, XCircle } from "lucide-react"
import { resolveDiscrepancy } from "@/lib/db"
import type { Discrepancy } from "@/types/entities/roster.types"

const RESOLUTION_OPTIONS = [
  {
    value: "keep_logbook",
    label: "Keep Logbook Entry",
    description: "Use the values from your logbook, discard schedule data",
    icon: FileText,
  },
  {
    value: "keep_schedule",
    label: "Keep Schedule Entry",
    description: "Use the values from your schedule, update logbook if needed",
    icon: Calendar,
  },
  {
    value: "merged",
    label: "Merge Both",
    description: "Combine information from both sources",
    icon: Merge,
  },
  {
    value: "ignored",
    label: "Ignore",
    description: "Mark as resolved without taking action",
    icon: XCircle,
  },
] as const

interface DiscrepancyResolutionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  discrepancy: Discrepancy | null
  onResolved?: () => void
}

export function DiscrepancyResolutionDialog({
  open,
  onOpenChange,
  discrepancy,
  onResolved,
}: DiscrepancyResolutionDialogProps) {
  const [resolution, setResolution] = useState<Discrepancy["resolvedBy"]>("keep_logbook")
  const [notes, setNotes] = useState("")
  const [isResolving, setIsResolving] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)

  const handleResolve = async () => {
    if (!discrepancy || !resolution) return

    try {
      setIsResolving(true)
      await resolveDiscrepancy(discrepancy.id, resolution, notes || undefined)

      setShowSuccess(true)
      setTimeout(() => {
        setShowSuccess(false)
        onOpenChange(false)
        onResolved?.()
        // Reset form
        setResolution("keep_logbook")
        setNotes("")
      }, 1000)
    } catch (error) {
      console.error("Failed to resolve discrepancy:", error)
      alert("Failed to resolve discrepancy")
    } finally {
      setIsResolving(false)
    }
  }

  if (!discrepancy) return null

  const selectedOption = RESOLUTION_OPTIONS.find((opt) => opt.value === resolution)
  const SelectedIcon = selectedOption?.icon || FileText

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Resolve Discrepancy</DialogTitle>
          <DialogDescription>
            Choose how you want to resolve this discrepancy. This action will mark the discrepancy
            as resolved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Discrepancy Info */}
          <div className="p-3 rounded-lg bg-secondary/30 space-y-2">
            <div className="text-sm font-medium">Current Issue:</div>
            <div className="text-sm text-muted-foreground">
              {discrepancy.message || "Discrepancy detected"}
            </div>
            {discrepancy.field && (
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">Field:</span> {discrepancy.field}
              </div>
            )}
            {discrepancy.scheduleValue && (
              <div className="text-xs">
                <span className="font-medium">Schedule:</span>{" "}
                <span className="text-muted-foreground">{discrepancy.scheduleValue}</span>
              </div>
            )}
            {discrepancy.logbookValue && (
              <div className="text-xs">
                <span className="font-medium">Logbook:</span>{" "}
                <span className="text-muted-foreground">{discrepancy.logbookValue}</span>
              </div>
            )}
          </div>

          {/* Resolution Method */}
          <div className="space-y-2">
            <Label htmlFor="resolution-method">Resolution Method</Label>
            <Select
              value={resolution || ""}
              onValueChange={(value) => setResolution(value as Discrepancy["resolvedBy"])}
            >
              <SelectTrigger id="resolution-method">
                <SelectValue>
                  {selectedOption && (
                    <div className="flex items-center gap-2">
                      <SelectedIcon className="h-4 w-4" />
                      {selectedOption.label}
                    </div>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {RESOLUTION_OPTIONS.map((option) => {
                  const OptionIcon = option.icon
                  return (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="flex flex-col py-1">
                        <div className="flex items-center gap-2">
                          <OptionIcon className="h-4 w-4" />
                          <span className="font-medium">{option.label}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{option.description}</span>
                      </div>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            {selectedOption && (
              <p className="text-xs text-muted-foreground">{selectedOption.description}</p>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="resolution-notes">Notes (Optional)</Label>
            <Input
              id="resolution-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any additional notes about this resolution..."
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isResolving}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button onClick={handleResolve} disabled={isResolving || !resolution} className="flex-1">
              {isResolving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Resolving...
                </>
              ) : showSuccess ? (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Resolved!
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Resolve
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
