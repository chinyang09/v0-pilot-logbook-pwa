"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Clock, Plane, MapPin, Moon, Navigation, LandPlot, Users, Timer } from "lucide-react"

interface Stats {
  totalFlights: number
  blockTime: number
  flightTime: number
  p1Time: number
  p2Time: number
  p1usTime: number
  dualTime: number
  nightTime: number
  ifrTime: number
  totalDayLandings: number
  totalNightLandings: number
  uniqueAircraft: number
  uniqueAirports: number
}

interface StatsDashboardProps {
  stats: Stats
}

export function StatsDashboard({ stats }: StatsDashboardProps) {
  const statCards = [
    {
      label: "Block Time",
      value: `${stats.blockTime.toFixed(1)}h`,
      icon: Timer,
      color: "text-primary",
    },
    {
      label: "Flight Time",
      value: `${stats.flightTime.toFixed(1)}h`,
      icon: Clock,
      color: "text-accent",
    },
    {
      label: "P1 (PIC)",
      value: `${stats.p1Time.toFixed(1)}h`,
      icon: Navigation,
      color: "text-chart-4",
    },
    {
      label: "P2 (SIC)",
      value: `${stats.p2Time.toFixed(1)}h`,
      icon: Users,
      color: "text-chart-2",
    },
    {
      label: "Night Time",
      value: `${stats.nightTime.toFixed(1)}h`,
      icon: Moon,
      color: "text-chart-3",
    },
    {
      label: "IFR Time",
      value: `${stats.ifrTime.toFixed(1)}h`,
      icon: Navigation,
      color: "text-chart-5",
    },
    {
      label: "Landings",
      value: `${stats.totalDayLandings + stats.totalNightLandings}`,
      subValue: stats.totalNightLandings > 0 ? `(${stats.totalNightLandings} night)` : undefined,
      icon: LandPlot,
      color: "text-muted-foreground",
    },
    {
      label: "Flights",
      value: stats.totalFlights.toString(),
      icon: Plane,
      color: "text-muted-foreground",
    },
    {
      label: "Aircraft",
      value: stats.uniqueAircraft.toString(),
      icon: Plane,
      color: "text-muted-foreground",
    },
    {
      label: "Airports",
      value: stats.uniqueAirports.toString(),
      icon: MapPin,
      color: "text-muted-foreground",
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {statCards.map((stat) => (
        <Card key={stat.label} className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg bg-secondary ${stat.color}`}>
                <stat.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">
                  {stat.value}
                  {stat.subValue && (
                    <span className="text-xs font-normal text-muted-foreground ml-1">{stat.subValue}</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
