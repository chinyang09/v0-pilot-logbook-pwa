import type { LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/**
 * The single empty-state card used across list pages (currencies,
 * discrepancies, roster, FDP, flight list) so empty screens share one layout,
 * icon size, and type scale.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  iconClassName,
  className,
}: {
  icon: LucideIcon
  title: string
  description?: string
  /** Optional CTA rendered under the description (e.g. an "Add" button). */
  action?: React.ReactNode
  /** Override the icon color (default muted) — e.g. a green all-clear check. */
  iconClassName?: string
  className?: string
}) {
  return (
    <Card className={className}>
      <CardContent className="py-12 text-center">
        <Icon className={cn("h-10 w-10 mx-auto mb-3 text-muted-foreground/40", iconClassName)} />
        <p className="text-sm font-medium text-foreground mb-1">{title}</p>
        {description && (
          <p className="text-xs text-muted-foreground max-w-[240px] mx-auto">{description}</p>
        )}
        {action && <div className="mt-4">{action}</div>}
      </CardContent>
    </Card>
  )
}
