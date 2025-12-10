"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Clock, Plane, MapPin, Moon, Navigation, LandPlot } from "lucide-react"

interface Stats {
  totalFlights: number
  totalTime: number
  picTime: number
  nightTime: number
  ifrTime: number
  totalLandings: number
  uniqueAircraft: number
  uniqueAirports: number
}

interface StatsDashboardProps {
  stats: Stats
}

export function StatsDashboard({ stats }: StatsDashboardProps) {
  const statCards = [
    {
      label: "Total Time",
      value: `${stats.totalTime.toFixed(1)}h`,
      icon: Clock,
      color: "text-primary",
    },
    {
      label: "Total Flights",
      value: stats.totalFlights.toString(),
      icon: Plane,
      color: "text-accent",
    },
    {
      label: "PIC Time",
      value: `${stats.picTime.toFixed(1)}h`,
      icon: Navigation,
      color: "text-chart-4",
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
      value: stats.totalLandings.toString(),
      icon: LandPlot,
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
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {statCards.map((stat) => (
        <Card key={stat.label} className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg bg-secondary ${stat.color}`}>
                <stat.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
