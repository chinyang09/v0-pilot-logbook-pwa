import { Loader2 } from "lucide-react"

export default function AircraftLoading() {
  return (
    <div className="flex flex-col h-[100dvh] bg-background items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-muted-foreground mt-3">Loading aircraft...</p>
    </div>
  )
}
