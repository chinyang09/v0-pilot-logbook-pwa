"use client"

import { useState, useMemo } from "react"
import { useSessionState } from "@/hooks/use-session-state"
import { PageContainer } from "@/components/page-container"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { GlassIconButton } from "@/components/ui/glass-icon-button"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { FilterChips } from "@/components/ui/filter-chips"
import { RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react"
import { useDiscrepancies } from "@/hooks/data"
import { DiscrepancyCard, DiscrepancyResolutionDialog } from "@/components/roster"
import type { Discrepancy, DiscrepancyType } from "@/types/entities/roster.types"
import { cn } from "@/lib/utils"

type FilterType = "all" | "unresolved" | "resolved" | DiscrepancyType

export default function DiscrepanciesPage() {
  const { discrepancies, isLoading, refresh } = useDiscrepancies()
  const [filterType, setFilterType] = useSessionState<FilterType>("discrepancies:filter", "unresolved")
  const [discrepancyToResolve, setDiscrepancyToResolve] = useState<Discrepancy | null>(null)

  // Filter discrepancies
  const filteredDiscrepancies = discrepancies.filter((d) => {
    if (filterType === "all") return true
    if (filterType === "unresolved") return !d.resolved
    if (filterType === "resolved") return d.resolved
    return d.type === filterType
  })

  // Sort by creation date (newest first)
  const sortedDiscrepancies = [...filteredDiscrepancies].sort(
    (a, b) => b.createdAt - a.createdAt
  )

  // Counts by status
  const unresolvedCount = discrepancies.filter((d) => !d.resolved).length
  const resolvedCount = discrepancies.filter((d) => d.resolved).length

  // Counts by severity (unresolved only)
  const unresolvedDiscrepancies = discrepancies.filter((d) => !d.resolved)
  const errorCount = unresolvedDiscrepancies.filter((d) => d.severity === "error").length
  const warningCount = unresolvedDiscrepancies.filter((d) => d.severity === "warning").length
  const infoCount = unresolvedDiscrepancies.filter((d) => d.severity === "info").length

  // Glass action buttons for the floating header bar
  const discrepancyActions = useMemo(() => (
    <GlassIconButton ariaLabel="Refresh discrepancies" onClick={() => refresh()} disabled={isLoading}>
      <RefreshCw className={cn("h-5 w-5", isLoading && "animate-spin")} />
    </GlassIconButton>
  ), [refresh, isLoading])

  useRegisterMainActions(discrepancyActions, true)

  return (
    <PageContainer
    >
      <div className="px-4 pt-4 pb-safe space-y-4">
        {/* Status Cards — first three are unresolved by severity, last is
            resolved, so the four numbers always sum to the total (the old
            Total/Errors/Warnings/Resolved mix left `info` uncounted). */}
        <div className="grid grid-cols-4 gap-2">
          <Card>
            <CardContent className="pt-4 pb-3 px-3">
              <div className="text-2xl font-bold text-status-error">{errorCount}</div>
              <div className="text-xs text-muted-foreground">Errors</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-3">
              <div className="text-2xl font-bold text-status-warning">{warningCount}</div>
              <div className="text-xs text-muted-foreground">Warnings</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-3">
              <div className="text-2xl font-bold text-status-info">{infoCount}</div>
              <div className="text-xs text-muted-foreground">Info</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-3">
              <div className="text-2xl font-bold text-status-valid">{resolvedCount}</div>
              <div className="text-xs text-muted-foreground">Resolved</div>
            </CardContent>
          </Card>
        </div>

        {/* Filter */}
        <FilterChips<FilterType>
          value={filterType}
          onChange={setFilterType}
          options={[
            { value: "unresolved", label: "Unresolved", count: unresolvedCount },
            { value: "resolved", label: "Resolved", count: resolvedCount },
            { value: "all", label: "All", count: discrepancies.length },
            { value: "duplicate", label: "Duplicate" },
            { value: "time_mismatch", label: "Time" },
            { value: "crew_mismatch", label: "Crew" },
            { value: "route_mismatch", label: "Route" },
            { value: "missing_in_logbook", label: "Missing in Logbook" },
            { value: "missing_in_schedule", label: "Missing in Schedule" },
            { value: "stale_report", label: "Stale Report" },
          ]}
        />

        {/* First-load skeleton */}
        {isLoading && discrepancies.length === 0 && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        )}

        {/* Empty State */}
        {discrepancies.length === 0 && !isLoading && (
          <EmptyState
            icon={CheckCircle2}
            iconClassName="text-status-valid/60"
            title="No Discrepancies"
            description="Your schedule and logbook are in sync. Discrepancies will appear here when detected during schedule imports."
          />
        )}

        {/* Discrepancy List */}
        {sortedDiscrepancies.length > 0 && (
          <div className="space-y-3">
            {sortedDiscrepancies.map((discrepancy) => (
              <DiscrepancyCard
                key={discrepancy.id}
                discrepancy={discrepancy}
                onResolve={(d) => setDiscrepancyToResolve(d)}
                onReopen={async (d) => {
                  // Import the unresolve function
                  const { unresolveDiscrepancy } = await import("@/lib/db")
                  await unresolveDiscrepancy(d.id)
                  await refresh()
                }}
              />
            ))}
          </div>
        )}

        {/* No Results */}
        {discrepancies.length > 0 && sortedDiscrepancies.length === 0 && (
          <EmptyState
            icon={AlertCircle}
            title={`No ${filterType.replace(/_/g, " ")} discrepancies`}
            description="Try changing the filter to see more discrepancies."
          />
        )}
      </div>

      {/* Resolution Dialog */}
      <DiscrepancyResolutionDialog
        open={!!discrepancyToResolve}
        onOpenChange={(open) => !open && setDiscrepancyToResolve(null)}
        discrepancy={discrepancyToResolve}
        onResolved={refresh}
      />
    </PageContainer>
  )
}
