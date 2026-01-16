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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Shield,
  RefreshCw,
  Plus,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Trash2,
} from "lucide-react"
import { useCurrencies } from "@/hooks/data"
import { CurrencyCard, CurrencyFormDialog } from "@/components/roster"
import type { CurrencyWithStatus, CurrencyStatus } from "@/types/entities/roster.types"
import { cn } from "@/lib/utils"
import { deleteCurrency } from "@/lib/db"

type FilterStatus = "all" | CurrencyStatus

export default function CurrenciesPage() {
  const { currencies, isLoading, refresh } = useCurrencies()
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all")
  const [currencyToDelete, setCurrencyToDelete] = useState<CurrencyWithStatus | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
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

  const handleDelete = async () => {
    if (!currencyToDelete) return

    try {
      setIsDeleting(true)
      await deleteCurrency(currencyToDelete.id)
      await refresh()
      setCurrencyToDelete(null)
    } catch (error) {
      console.error("Failed to delete currency:", error)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <PageContainer
      header={
        <header className="flex-none bg-background/95 backdrop-blur-lg border-b border-border z-50">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-between h-12">
              <h1 className="text-lg font-semibold text-foreground">Currencies & Expiries</h1>
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
                <Button size="sm" onClick={() => setShowAddDialog(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add
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
              <div className="text-2xl font-bold text-green-500">{statusCounts.valid || 0}</div>
              <div className="text-xs text-muted-foreground">Valid</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-3">
              <div className="text-2xl font-bold text-yellow-500">{statusCounts.warning || 0}</div>
              <div className="text-xs text-muted-foreground">Warning</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-3">
              <div className="text-2xl font-bold text-orange-500">{statusCounts.critical || 0}</div>
              <div className="text-xs text-muted-foreground">Critical</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-3">
              <div className="text-2xl font-bold text-red-500">{statusCounts.expired || 0}</div>
              <div className="text-xs text-muted-foreground">Expired</div>
            </CardContent>
          </Card>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Filter:</span>
          <Select value={filterStatus} onValueChange={(value) => setFilterStatus(value as FilterStatus)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ({currencies.length})</SelectItem>
              <SelectItem value="valid">Valid ({statusCounts.valid || 0})</SelectItem>
              <SelectItem value="warning">Warning ({statusCounts.warning || 0})</SelectItem>
              <SelectItem value="critical">Critical ({statusCounts.critical || 0})</SelectItem>
              <SelectItem value="expired">Expired ({statusCounts.expired || 0})</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Empty State */}
        {currencies.length === 0 && !isLoading && (
          <Card>
            <CardContent className="pt-8 pb-8 text-center">
              <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <CardTitle className="text-lg mb-2">No Currencies</CardTitle>
              <CardDescription className="mb-4">
                Add currencies and expiry dates to track your training, medical, and license renewals.
              </CardDescription>
              <Button onClick={() => setShowAddDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Currency
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Currency List */}
        {sortedCurrencies.length > 0 && (
          <div className="space-y-3">
            {sortedCurrencies.map((currency) => (
              <CurrencyCard
                key={currency.id}
                currency={currency}
                onEdit={(c) => setCurrencyToEdit(c)}
                onDelete={(c) => setCurrencyToDelete(c)}
              />
            ))}
          </div>
        )}

        {/* No Results */}
        {currencies.length > 0 && sortedCurrencies.length === 0 && (
          <Card>
            <CardContent className="pt-8 pb-8 text-center">
              <ShieldCheck className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <CardTitle className="text-lg mb-2">No {filterStatus} currencies</CardTitle>
              <CardDescription>Try changing the filter to see more currencies.</CardDescription>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!currencyToDelete} onOpenChange={() => setCurrencyToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Currency</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-semibold">{currencyToDelete?.description}</span>? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="outline" onClick={() => setCurrencyToDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
