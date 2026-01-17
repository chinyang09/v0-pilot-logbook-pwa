/**
 * Currency Card Component
 * Displays currency/expiry information with visual status indicators
 */

import type { CurrencyWithStatus, CurrencyStatus } from "@/types/entities/roster.types"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Shield,
  ShieldAlert,
  ShieldX,
  ShieldCheck,
  Calendar,
  Clock,
  Edit,
  Trash2,
  FileText,
} from "lucide-react"
import { cn } from "@/lib/utils"

const STATUS_CONFIG: Record<
  CurrencyStatus,
  {
    icon: typeof Shield
    bg: string
    text: string
    border: string
    label: string
  }
> = {
  valid: {
    icon: ShieldCheck,
    bg: "bg-green-500/10",
    text: "text-green-500",
    border: "border-green-500/20",
    label: "Valid",
  },
  warning: {
    icon: ShieldAlert,
    bg: "bg-yellow-500/10",
    text: "text-yellow-500",
    border: "border-yellow-500/20",
    label: "Expiring Soon",
  },
  critical: {
    icon: ShieldAlert,
    bg: "bg-orange-500/10",
    text: "text-orange-500",
    border: "border-orange-500/20",
    label: "Critical",
  },
  expired: {
    icon: ShieldX,
    bg: "bg-red-500/10",
    text: "text-red-500",
    border: "border-red-500/20",
    label: "Expired",
  },
}

interface CurrencyCardProps {
  currency: CurrencyWithStatus
  onEdit?: (currency: CurrencyWithStatus) => void
  onDelete?: (currency: CurrencyWithStatus) => void
  compact?: boolean
}

export function CurrencyCard({ currency, onEdit, onDelete, compact = false }: CurrencyCardProps) {
  const config = STATUS_CONFIG[currency.status]
  const Icon = config.icon

  const formatDate = (dateString: string) => {
    const date = new Date(dateString + "T00:00:00")
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  const getDaysText = (days: number) => {
    if (days < 0) return `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`
    if (days === 0) return "Expires today"
    if (days === 1) return "Expires tomorrow"
    return `${days} days remaining`
  }

  if (compact) {
    return (
      <div
        className={cn(
          "flex items-center gap-3 p-2 rounded-lg bg-secondary/30 transition-colors",
          config.border
        )}
      >
        <div className={cn("p-2 rounded-lg", config.bg, config.text)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{currency.description}</div>
          <div className="text-xs text-muted-foreground">{getDaysText(currency.daysRemaining)}</div>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-secondary/50">
          {formatDate(currency.expiryDate)}
        </span>
      </div>
    )
  }

  return (
    <Card className={cn("overflow-hidden transition-all hover:shadow-md", config.border)}>
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          <div className={cn("p-2.5 rounded-xl", config.bg, config.text)}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-base">{currency.description}</h3>
              <Badge variant="outline" className={cn("text-xs", config.text)}>
                {config.label}
              </Badge>
            </div>
            {currency.code !== "CUSTOM" && (
              <p className="text-xs text-muted-foreground font-mono">{currency.code}</p>
            )}
          </div>
          <div className="flex gap-1">
            {onEdit && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onEdit(currency)}
                title="Edit currency"
              >
                <Edit className="h-3.5 w-3.5" />
              </Button>
            )}
            {onDelete && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onDelete(currency)}
                title="Delete currency"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Expiry Information */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Expires:</span>
            <span className="font-medium">{formatDate(currency.expiryDate)}</span>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className={cn("font-medium", config.text)}>{getDaysText(currency.daysRemaining)}</span>
          </div>
        </div>

        {/* Thresholds */}
        <div className="mt-3 pt-3 border-t border-border/50">
          <div className="flex gap-2 text-xs text-muted-foreground">
            <span>Warning: {currency.warningDays}d</span>
            <span>•</span>
            <span>Critical: {currency.criticalDays}d</span>
          </div>
        </div>

        {/* Additional Details */}
        {(currency.documentNumber || currency.notes) && (
          <div className="mt-3 space-y-1">
            {currency.documentNumber && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileText className="h-3 w-3" />
                <span>{currency.documentNumber}</span>
              </div>
            )}
            {currency.notes && (
              <p className="text-xs text-muted-foreground mt-1">{currency.notes}</p>
            )}
          </div>
        )}

        {/* Auto-update Badge */}
        {currency.autoUpdate && (
          <div className="mt-2">
            <Badge variant="secondary" className="text-xs">
              Auto-update enabled
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
