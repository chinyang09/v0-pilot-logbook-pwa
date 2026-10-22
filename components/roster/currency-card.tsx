/**
 * One currency as a ROW of a grouped list — name over its code, the days left
 * over the expiry date.
 *
 * It was a card per currency, ~210px each (icon tile, a title with a badge,
 * an "Expires:" line, a "days remaining" line, a thresholds strip, an
 * "Auto-update enabled" badge), so a pilot's ten documents were five screens
 * of scrolling to answer one question: what runs out next. As rows they fit
 * one phone screen. The thresholds, notes and the auto-update switch are
 * settings OF the currency, not facts about it — they live in the editor a
 * tap away.
 */

import { memo } from "react"
import type { CurrencyWithStatus, CurrencyStatus } from "@/types/entities/roster.types"
import { SwipeableCard, type SwipeAction } from "@/components/swipeable-card"
import { ShieldAlert, ShieldCheck, ShieldX, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatYMDMedium as formatDate } from "@/lib/utils/date"

/**
 * The icon carries the state on every row — never colour alone. Only a
 * FLAGGED row tints its figure: tinting the met ones too would paint the whole
 * list and leave the one that needs attention nothing to stand out against
 * (the dashboard's currency band follows the same rule).
 */
const STATUS: Record<CurrencyStatus, { icon: typeof ShieldCheck; text: string; label: string }> = {
  valid: { icon: ShieldCheck, text: "text-status-valid", label: "Valid" },
  warning: { icon: ShieldAlert, text: "text-status-warning", label: "Expiring soon" },
  critical: { icon: ShieldAlert, text: "text-status-critical", label: "Critical" },
  expired: { icon: ShieldX, text: "text-status-error", label: "Expired" },
}

/**
 * The figure a pilot reads: days left, or that it has gone. Past a year it is
 * years — "2888d" is a number to work out, "7.9y" is an answer.
 */
export function daysFigure(days: number): string {
  if (days < 0) return "Expired"
  if (days === 0) return "Today"
  if (days >= 365) return `${(days / 365).toFixed(1)}y`
  return `${days}d`
}

interface CurrencyCardProps {
  currency: CurrencyWithStatus
  onEdit?: (currency: CurrencyWithStatus) => void
  onDelete?: (currency: CurrencyWithStatus) => void
}

export const CurrencyCard = memo(function CurrencyCard({ currency, onEdit, onDelete }: CurrencyCardProps) {
  const status = STATUS[currency.status]
  const Icon = status.icon
  const flagged = currency.status !== "valid"

  // A tap opens the editor, so the swipe panel carries only what a tap cannot.
  const actions: SwipeAction[] = onDelete
    ? [
        {
          icon: <Trash2 className="h-5 w-5" />,
          ariaLabel: "Delete",
          variant: "destructive",
          onClick: () => onDelete(currency),
        },
      ]
    : []

  const subtitle = [currency.code !== "CUSTOM" ? currency.code : null, currency.documentNumber]
    .filter(Boolean)
    .join(" · ")

  return (
    <SwipeableCard
      id={`currency-${currency.id}`}
      variant="row"
      separated
      actions={actions}
      onClick={onEdit ? () => onEdit(currency) : undefined}
    >
      <div
        className={cn("flex items-center gap-3 px-4 py-2", onEdit && "cursor-pointer")}
        aria-label={`${currency.description}, ${status.label}, ${daysFigure(currency.daysRemaining)}, expires ${formatDate(currency.expiryDate)}`}
      >
        <Icon className={cn("h-5 w-5 shrink-0", status.text)} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium leading-snug text-foreground">
            {currency.description}
          </p>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="shrink-0 text-right">
          <p
            className={cn(
              "text-[15px] font-semibold leading-snug tabular-nums",
              flagged ? status.text : "text-foreground"
            )}
          >
            {daysFigure(currency.daysRemaining)}
          </p>
          <p className="text-xs tabular-nums text-muted-foreground">{formatDate(currency.expiryDate)}</p>
        </div>
      </div>
    </SwipeableCard>
  )
})
