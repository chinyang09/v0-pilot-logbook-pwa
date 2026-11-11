"use client"

/**
 * The roster is the LOGBOOK with its duties on — one list of flight and duty
 * cards, one calendar, one + for either. This route is kept so an old link,
 * a bookmark or an installed app's last page still lands somewhere: it turns
 * the duties on and goes to the logbook, carrying a selection across (the
 * roster opened a flight as `flight:<id>` and a duty by its own id; the
 * logbook names a duty `duty:<id>`).
 */

import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { PageLoading } from "@/components/ui/page-loading"
import { dutyRowKey } from "@/lib/utils/logbook-rows"

export default function RosterRedirect() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const selected = searchParams.get("selected")
    const params = new URLSearchParams({ duties: "1" })
    if (selected && !selected.startsWith("__")) {
      params.set("selected", selected.startsWith("flight:") ? selected.slice("flight:".length) : dutyRowKey(selected))
    }
    router.replace(`/logbook?${params.toString()}`, { scroll: false })
  }, [router, searchParams])

  return <PageLoading />
}
