import { Loader2 } from "lucide-react"

/**
 * The single route-level loading state — used by every `loading.tsx` and by the
 * keep-alive Suspense fallback so all tabs share one first-paint behavior
 * (previously: two tabs flashed blank, two showed different spinners).
 */
export function PageLoading() {
  return (
    <div className="flex flex-1 min-h-[60vh] items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}

/**
 * The same state for a DETAIL PANEL, which already has its height from the
 * pane it fills (so no `min-h`) and no background of its own.
 *
 * The aircraft, airports and crew pages each carried their own copy of a
 * hand-rolled ring (`border-2 border-primary border-t-transparent`) — the same
 * markup three times, and a different spinner from the one every route-level
 * load shows. Waiting for a pane looked like a different kind of waiting
 * depending on which tab you were on.
 */
export function PanelLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}
