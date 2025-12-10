"use client"

import { SyncStatus } from "./sync-status"
import { Plane } from "lucide-react"

export function Header() {
  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-lg border-b border-border">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Plane className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="font-bold text-foreground">SkyLog</h1>
            <p className="text-xs text-muted-foreground">Pilot Logbook</p>
          </div>
        </div>
        <SyncStatus />
      </div>
    </header>
  )
}
