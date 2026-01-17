"use client"

import { useState } from "react"
import { PageContainer } from "@/components/page-container"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RefreshCw, AlertCircle, CheckCircle2, XCircle } from "lucide-react"
import { useDiscrepancies } from "@/hooks/data"
import { DiscrepancyCard, DiscrepancyResolutionDialog } from "@/components/roster"
import type { Discrepancy, DiscrepancyType } from "@/types/entities/roster.types"
import { cn } from "@/lib/utils"

type FilterType = "all" | "unresolved" | "resolved" | DiscrepancyType

export default function DiscrepanciesPage() {
  const { discrepancies, isLoading, refresh } = useDiscrepancies()
  const [filterType, setFilterType] = useState<FilterType>("unresolved")
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

  return (
    <PageContainer
      header={
        <header className="flex-none bg-background/95 backdrop-blur-lg border-b border-border z-50">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-between h-12">
              <h1 className="text-lg font-semibold text-foreground">Discrepancies</h1>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => refresh()}
                  disabled={isLoading}
                  title="Refresh"
                >
                  <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                </Button>
              </div>
            </div>
          </div>
        </header>
      }
    >
      <div className="container mx-auto px-3 pt-4 pb-safe space-y-4">
        {/* Status Cards */}
        <div className="grid grid-cols-4 gap-2">
          <Card>
            <CardContent className="pt-4 pb-3 px-3">
              <div className="text-2xl font-bold">{discrepancies.length}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-3">
              <div className="text-2xl font-bold text-red-500">{errorCount}</div>
              <div className="text-xs text-muted-foreground">Errors</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-3">
              <div className="text-2xl font-bold text-yellow-500">{warningCount}</div>
              <div className="text-xs text-muted-foreground">Warnings</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-3">
              <div className="text-2xl font-bold text-green-500">{resolvedCount}</div>
              <div className="text-xs text-muted-foreground">Resolved</div>
            </CardContent>
          </Card>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Filter:</span>
          <Select value={filterType} onValueChange={(value) => setFilterType(value as FilterType)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ({discrepancies.length})</SelectItem>
              <SelectItem value="unresolved">Unresolved ({unresolvedCount})</SelectItem>
              <SelectItem value="resolved">Resolved ({resolvedCount})</SelectItem>
              <SelectItem value="duplicate">Duplicate</SelectItem>
              <SelectItem value="time_mismatch">Time Mismatch</SelectItem>
              <SelectItem value="crew_mismatch">Crew Mismatch</SelectItem>
              <SelectItem value="route_mismatch">Route Mismatch</SelectItem>
              <SelectItem value="missing_in_logbook">Missing in Logbook</SelectItem>
              <SelectItem value="missing_in_schedule">Missing in Schedule</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Empty State */}
        {discrepancies.length === 0 && !isLoading && (
          <Card>
            <CardContent className="pt-8 pb-8 text-center">
              <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 mb-4" />
              <CardTitle className="text-lg mb-2">No Discrepancies</CardTitle>
              <CardDescription>
                Your schedule and logbook are in sync. Discrepancies will appear here when
                detected during schedule imports.
              </CardDescription>
            </CardContent>
          </Card>
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
          <Card>
            <CardContent className="pt-8 pb-8 text-center">
              <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <CardTitle className="text-lg mb-2">No {filterType} discrepancies</CardTitle>
              <CardDescription>Try changing the filter to see more discrepancies.</CardDescription>
            </CardContent>
          </Card>
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
