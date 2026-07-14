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
