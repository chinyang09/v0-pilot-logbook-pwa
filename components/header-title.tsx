"use client"

import { usePathname } from "next/navigation"
import { DETAIL_TITLE_KEY, useHeaderTitle } from "@/lib/layout/header-title"

/**
 * The small title the header carries once a panel's large title has scrolled
 * under it — the middle cell of a `.header-bar-grid`, so it is centred over
 * its panel when there is room and pushed aside (then truncated) by the
 * action buttons when there is not. It never overlaps them: the grid gives the
 * buttons their full width first.
 *
 * It is always mounted and only fades, so showing it changes no layout.
 * `aria-hidden`: the large title is the heading a screen reader reads; this
 * copy is for the eye. Tapping it scrolls the panel back to the top, as the
 * bar around it already does.
 */
export function HeaderTitle({ slot, onClick }: { slot: "main" | "detail"; onClick: () => void }) {
  const pathname = usePathname()
  const entry = useHeaderTitle(slot === "main" ? pathname : DETAIL_TITLE_KEY)
  const shown = !!entry?.collapsed
  return (
    <div
      aria-hidden
      data-header-title
      className="flex h-full min-w-0 cursor-pointer items-center justify-center px-3"
      onClick={onClick}
    >
      <span
        className="truncate text-[15px] font-semibold leading-tight transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none"
        style={{ opacity: shown ? 1 : 0, transform: shown ? "none" : "translateY(6px)" }}
      >
        {entry?.title ?? ""}
      </span>
    </div>
  )
}
