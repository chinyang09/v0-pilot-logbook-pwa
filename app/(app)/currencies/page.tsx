"use client"

import { useState, useMemo } from "react"
import { useSessionState } from "@/hooks/use-session-state"
import { PageContainer } from "@/components/page-container"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { GlassIconButton } from "@/components/ui/glass-icon-button"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { FilterChips } from "@/components/ui/filter-chips"
import {
  Shield,
  RefreshCw,
  Plus,
  ShieldCheck,
} from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
import { LIST_ITEM_TRANSITION } from "@/lib/motion"
import { useCurrencies } from "@/hooks/data"
import { CurrencyCard, CurrencyFormDialog } from "@/components/roster"
import type { CurrencyWithStatus, CurrencyStatus } from "@/types/entities/roster.types"
import { cn } from "@/lib/utils"
import { deleteCurrency, restoreCurrency } from "@/lib/db"
import { showUndoToast } from "@/lib/utils/undo-toast"

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
      showUndoToast(`${currency.code || "Currency"} deleted`, async () => {
        await restoreCurrency(currency.id)
        await refresh()
      })
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
      <div className="px-panel pt-4 space-y-4">
        {/* The counts live on the filter chips below. A row of four status
            cards above them printed the same four numbers twice, and painted
            "0 Expired" in the alarm red on a pilot with nothing expired. With
            nothing tracked yet there is nothing to filter, so no chips. */}
        {currencies.length > 0 && (
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
        )}

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
            title="No currencies yet"
            description="Add currencies and expiry dates to track your training, medical, and license renewals."
            action={
              // Outline, like every other empty state's add button.
              <Button variant="outline" size="sm" onClick={() => setShowAddDialog(true)}>
                <Plus className="h-4 w-4" />
                Add currency
              </Button>
            }
          />
        )}

        {/* Currency List — items fade/slide on filter changes and deletes so
            the list moves like the logbook instead of hard-cutting. */}
        {sortedCurrencies.length > 0 && (
          <div className="space-y-3">
            <AnimatePresence initial={false} mode="popLayout">
              {sortedCurrencies.map((currency) => (
                <motion.div
                  key={currency.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={LIST_ITEM_TRANSITION}
                >
                  <CurrencyCard
                    currency={currency}
                    onEdit={(c) => setCurrencyToEdit(c)}
                    onDelete={(c) => handleDelete(c)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
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
