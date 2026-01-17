"use client"

import { useState, useEffect } from "react"
import { PageContainer } from "@/components/page-container"
import { SyncStatus } from "@/components/sync-status"
import { StatsDashboard } from "@/components/stats-dashboard"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent } from "@/components/ui/card"
import { syncService } from "@/lib/sync"
import { useAuth } from "@/components/providers/auth-provider"
import { UserMenu } from "@/components/user-menu"
import { useFlights, useFlightStats, refreshAllData, useDBReady, useExpiringCurrencies } from "@/hooks/data"
import { useUnresolvedDiscrepancies } from "@/hooks/data/use-discrepancies"
import { RefreshCw, AlertCircle, Plane, Calendar, TrendingUp, Loader2, ShieldAlert } from "lucide-react"
import { formatHHMMDisplay, minutesToHHMM } from "@/lib/utils/time"
import Link from "next/link"
import { cn } from "@/lib/utils"

export default function Dashboard() {
  const { user, isLoading: authLoading, isAuthenticated } = useAuth()
  const { isReady: dbReady, isLoading: dbLoading } = useDBReady()
  const { flights, isLoading: flightsLoading } = useFlights()
  const { stats, isLoading: statsLoading, refresh: refreshStats } = useFlightStats()
  const { expiringCurrencies, isLoading: currenciesLoading } = useExpiringCurrencies()
  const { unresolvedDiscrepancies, isLoading: discrepanciesLoading } = useUnresolvedDiscrepancies()

  const [isSyncing, setIsSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = syncService.onDataChanged(() => {
      refreshAllData()
    })
    return unsubscribe
  }, [])

  const handleManualSync = async () => {
    if (!navigator.onLine) {
      setSyncError("You are offline. Sync will happen when connection is restored.")
      return
    }

    setIsSyncing(true)
    setSyncError(null)
    try {
      await syncService.fullSync()
      await refreshAllData()
    } catch (error) {
      console.error("Manual sync failed:", error)
      setSyncError("Sync failed. Please try again.")
    } finally {
      setIsSyncing(false)
    }
  }

  // Show loading state while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  // Don't render if not authenticated (redirect happens in AuthProvider)
  if (!isAuthenticated) {
    return null
  }

  const isLoading = dbLoading || !dbReady
  const recentFlights = flights.slice(0, 5)
  const thisMonth = new Date().toISOString().slice(0, 7)
  const thisMonthFlights = flights.filter((f) => f.date.startsWith(thisMonth))

  return (
    <PageContainer
      header={
        <header className="flex-none bg-background/80 backdrop-blur-xl border-b border-border/50 z-50">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-between h-12">
              <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
              <div className="flex items-center gap-2">
                <SyncStatus />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleManualSync}
                  disabled={isSyncing || isLoading}
                  className="h-8 w-8 p-0"
                >
                  <RefreshCw className={cn("h-4 w-4", isSyncing && "animate-spin")} />
                </Button>
                <UserMenu />
              </div>
            </div>
          </div>
        </header>
      }
    >
      {
        <div className="container mx-auto px-4 pt-4 pb-safe space-y-6">
          {" "}
          {syncError && (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1">{syncError}</span>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSyncError(null)}>
                Dismiss
              </Button>
            </div>
          )}
          {/* Welcome Message */}
          {user && (
            <div className="text-muted-foreground">
              Welcome back, <span className="text-foreground font-medium">{user.callsign}</span>
            </div>
          )}
          {/* Overview Section */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">Overview</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleManualSync}
                disabled={isSyncing || isLoading}
                className="gap-2"
              >
                <RefreshCw className={cn("h-4 w-4", isSyncing && "animate-spin")} />
                {isSyncing ? "Syncing..." : "Sync"}
              </Button>
            </div>
            {statsLoading || isLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 rounded-xl" />
                ))}
              </div>
            ) : (
              <StatsDashboard stats={stats} />
            )}
          </section>
          {/* This Month Summary */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-4">This Month</h2>
            <div className="grid grid-cols-2 gap-4">
              <Card className="bg-card border-border">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary">
                      <Plane className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-foreground">{thisMonthFlights.length}</p>
                      <p className="text-xs text-muted-foreground">Flights</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-card border-border">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-chart-2/10 text-chart-2">
                      <TrendingUp className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-foreground font-mono">
                        {minutesToHHMM(
                          thisMonthFlights.reduce((acc, f) => {
                            const [h, m] = (f.blockTime || "00:00").split(":").map(Number)
                            return acc + h * 60 + m
                          }, 0),
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">Flight Hours</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>

          {/* Currency Warnings */}
          {expiringCurrencies.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground">Currency Warnings</h2>
                <Link href="/currencies">
                  <Button variant="ghost" size="sm" className="gap-2">
                    <ShieldAlert className="h-4 w-4" />
                    View All
                  </Button>
                </Link>
              </div>
              <div className="space-y-2">
                {expiringCurrencies.slice(0, 3).map((currency) => {
                  const isExpired = currency.daysRemaining < 0
                  const isCritical = currency.status === "critical"
                  const bgColor = isExpired
                    ? "bg-red-500/10 border-red-500/20"
                    : isCritical
                      ? "bg-orange-500/10 border-orange-500/20"
                      : "bg-yellow-500/10 border-yellow-500/20"
                  const textColor = isExpired
                    ? "text-red-500"
                    : isCritical
                      ? "text-orange-500"
                      : "text-yellow-500"

                  return (
                    <Card key={currency.id} className={cn("border", bgColor)}>
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <ShieldAlert className={cn("h-4 w-4 flex-shrink-0", textColor)} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">
                                {currency.description}
                              </p>
                              <p className={cn("text-xs", textColor)}>
                                {isExpired
                                  ? `Expired ${Math.abs(currency.daysRemaining)} day${Math.abs(currency.daysRemaining) === 1 ? "" : "s"} ago`
                                  : currency.daysRemaining === 0
                                    ? "Expires today"
                                    : currency.daysRemaining === 1
                                      ? "Expires tomorrow"
                                      : `${currency.daysRemaining} days remaining`}
                              </p>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-xs text-muted-foreground">
                              {new Date(currency.expiryDate + "T00:00:00").toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
                {expiringCurrencies.length > 3 && (
                  <p className="text-center text-sm text-muted-foreground">
                    +{expiringCurrencies.length - 3} more expiring soon
                  </p>
                )}
              </div>
            </section>
          )}

          {/* Discrepancy Warnings */}
          {unresolvedDiscrepancies.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground">Discrepancies</h2>
                <Link href="/discrepancies">
                  <Button variant="ghost" size="sm" className="gap-2">
                    <AlertCircle className="h-4 w-4" />
                    View All
                  </Button>
                </Link>
              </div>
              <div className="space-y-2">
                {unresolvedDiscrepancies.slice(0, 3).map((discrepancy) => {
                  const severityColors = {
                    error: {
                      bg: "bg-red-500/10 border-red-500/20",
                      text: "text-red-500",
                    },
                    warning: {
                      bg: "bg-yellow-500/10 border-yellow-500/20",
                      text: "text-yellow-500",
                    },
                    info: {
                      bg: "bg-blue-500/10 border-blue-500/20",
                      text: "text-blue-500",
                    },
                  }
                  const colors = severityColors[discrepancy.severity]

                  const typeLabels: Record<string, string> = {
                    duplicate: "Duplicate Flight",
                    time_mismatch: "Time Mismatch",
                    crew_mismatch: "Crew Mismatch",
                    route_mismatch: "Route Mismatch",
                    missing_in_logbook: "Missing in Logbook",
                    missing_in_schedule: "Missing in Schedule",
                  }

                  return (
                    <Card key={discrepancy.id} className={cn("border", colors.bg)}>
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <AlertCircle className={cn("h-4 w-4 flex-shrink-0", colors.text)} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">
                                {typeLabels[discrepancy.type] || discrepancy.type}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {discrepancy.message || "Detected during schedule import"}
                              </p>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className={cn("text-xs font-medium uppercase", colors.text)}>
                              {discrepancy.severity}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
                {unresolvedDiscrepancies.length > 3 && (
                  <p className="text-center text-sm text-muted-foreground">
                    +{unresolvedDiscrepancies.length - 3} more to resolve
                  </p>
                )}
              </div>
            </section>
          )}

          {/* Recent Flights Preview */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">Recent Flights</h2>
              <Link href="/logbook">
                <Button variant="ghost" size="sm" className="gap-2">
                  <Calendar className="h-4 w-4" />
                  View All
                </Button>
              </Link>
            </div>
            {flightsLoading || isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 rounded-xl" />
                ))}
              </div>
            ) : recentFlights.length === 0 ? (
              <Card className="bg-card border-border">
                <CardContent className="p-6 text-center">
                  <Plane className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-muted-foreground">No flights logged yet</p>
                  <Link href="/new-flight">
                    <Button className="mt-4" size="sm">
                      Log Your First Flight
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {recentFlights.map((flight) => (
                  <Card key={flight.id} className="bg-card border-border">
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="text-sm">
                            <span className="font-semibold text-foreground">{flight.departureIcao}</span>
                            <span className="text-muted-foreground mx-2">→</span>
                            <span className="font-semibold text-foreground">{flight.arrivalIcao}</span>
                          </div>
                          {flight.flightNumber && (
                            <span className="text-xs text-muted-foreground">{flight.flightNumber}</span>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-mono text-foreground">{formatHHMMDisplay(flight.flightTime)}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(flight.date).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </div>
      }
    </PageContainer>
  )
}
