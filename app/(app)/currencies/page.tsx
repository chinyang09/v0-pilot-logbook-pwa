"use client"

import { useState, useMemo } from "react"
import { useSessionState } from "@/hooks/use-session-state"
import { PageContainer } from "@/components/page-container"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { GlassIconButton } from "@/components/ui/glass-icon-button"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { FilterChips } from "@/components/ui/filter-chips"
import {
  Shield,
  RefreshCw,
  Plus,
  ShieldCheck,
} from "lucide-react"
import { useCurrencies } from "@/hooks/data"
import { CurrencyCard, CurrencyFormDialog } from "@/components/roster"
import type { CurrencyWithStatus, CurrencyStatus } from "@/types/entities/roster.types"
import { cn } from "@/lib/utils"
import { deleteCurrency } from "@/lib/db"

type FilterStatus = "all" | CurrencyStatus

export default function CurrenciesPage() {
  const { currencies, isLoading, refresh } = useCurrencies()
  const [filterStatus, setFilterStatus] = useSessionState<FilterStatus>("currencies:filter", "all")
  const [currencyToEdit, setCurrencyToEdit] = useState<CurrencyWithStatus | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)

  // Filter currencies by status
  const filteredCurrencies =
    filterStatus === "all"
      ? currencies
      : currencies.filter((c) => c.status === filterStatus)

  // Sort by expiry date (earliest first)
  const sortedCurrencies = [...filteredCurrencies].sort((a, b) => {
    return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()
  })

  // Status counts
  const statusCounts = currencies.reduce(
    (acc, curr) => {
      acc[curr.status] = (acc[curr.status] || 0) + 1
      return acc
    },
    {} as Record<CurrencyStatus, number>
  )

  const handleDelete = async (currency: CurrencyWithStatus) => {
    try {
      await deleteCurrency(currency.id)
      await refresh()
    } catch (error) {
      console.error("Failed to delete currency:", error)
    }
  }

  // Glass action buttons for the floating header bar
  const currencyActions = useMemo(() => (
    <>
      <GlassIconButton ariaLabel="Refresh currencies" onClick={() => refresh()} disabled={isLoading}>
        <RefreshCw className={cn("h-5 w-5", isLoading && "animate-spin")} />
      </GlassIconButton>
      <GlassIconButton ariaLabel="Add currency" onClick={() => setShowAddDialog(true)}>
        <Plus className="h-5 w-5" />
      </GlassIconButton>
    </>
  ), [refresh, isLoading])

  useRegisterMainActions(currencyActions, true)

  return (
    <PageContainer
    >
      <div className="px-4 pt-4 pb-safe space-y-4">
        {/* Status Cards */}
        <div className="grid grid-cols-4 gap-2">
          <Card>
            <CardContent className="pt-4 pb-3 px-3">
              <div className="text-2xl font-bold text-status-valid">{statusCounts.valid || 0}</div>
              <div className="text-xs text-muted-foreground">Valid</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-3">
              <div className="text-2xl font-bold text-status-warning">{statusCounts.warning || 0}</div>
              <div className="text-xs text-muted-foreground">Warning</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-3">
              <div className="text-2xl font-bold text-status-critical">{statusCounts.critical || 0}</div>
              <div className="text-xs text-muted-foreground">Critical</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-3">
              <div className="text-2xl font-bold text-status-error">{statusCounts.expired || 0}</div>
              <div className="text-xs text-muted-foreground">Expired</div>
            </CardContent>
          </Card>
        </div>

        {/* Filter */}
        <FilterChips<FilterStatus>
          value={filterStatus}
          onChange={setFilterStatus}
          options={[
            { value: "all", label: "All", count: currencies.length },
            { value: "valid", label: "Valid", count: statusCounts.valid || 0 },
            { value: "warning", label: "Warning", count: statusCounts.warning || 0 },
            { value: "critical", label: "Critical", count: statusCounts.critical || 0 },
            { value: "expired", label: "Expired", count: statusCounts.expired || 0 },
          ]}
        />

        {/* First-load skeleton */}
        {isLoading && currencies.length === 0 && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        )}

        {/* Empty State */}
        {currencies.length === 0 && !isLoading && (
          <EmptyState
            icon={Shield}
            title="No Currencies"
            description="Add currencies and expiry dates to track your training, medical, and license renewals."
            action={
              <Button size="sm" onClick={() => setShowAddDialog(true)}>
                <Plus className="h-4 w-4" />
                Add Currency
              </Button>
            }
          />
        )}

        {/* Currency List */}
        {sortedCurrencies.length > 0 && (
          <div className="space-y-3">
            {sortedCurrencies.map((currency) => (
              <CurrencyCard
                key={currency.id}
                currency={currency}
                onEdit={(c) => setCurrencyToEdit(c)}
                onDelete={(c) => handleDelete(c)}
              />
            ))}
          </div>
        )}

        {/* No Results */}
        {currencies.length > 0 && sortedCurrencies.length === 0 && (
          <EmptyState
            icon={ShieldCheck}
            title={`No ${filterStatus} currencies`}
            description="Try changing the filter to see more currencies."
          />
        )}
      </div>

      {/* Add/Edit Dialog */}
      <CurrencyFormDialog
        open={showAddDialog || !!currencyToEdit}
        onOpenChange={(open) => {
          if (!open) {
            setShowAddDialog(false)
            setCurrencyToEdit(null)
          }
        }}
        currency={currencyToEdit}
        onSaved={refresh}
      />
    </PageContainer>
  )
}
