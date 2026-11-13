"use client"

/**
 * Settings › Navigation: the tab bar, edited AS the tab bar.
 *
 * It was a vertical list of rows with a grip on each — a picture of nothing on
 * screen, so arranging it meant translating a column into a row in your head.
 * Now the editor IS a copy of the bar the pilot will get — the phone's bottom
 * bar (icon over label, equal columns), or the top pill where the nav sits at
 * the top (`useDesktopPill`) — and its tabs are dragged sideways inside it.
 * A × takes one off (down to two); the destinations not in the bar are chips
 * underneath, a tap adding one at the end (up to four).
 *
 * The preview is a GlassContainer like the real bar, so it is the same
 * material, height and radius; it is not a link and takes no navigation.
 */

import { Plus, X } from "lucide-react"
import { Reorder } from "framer-motion"
import { cn } from "@/lib/utils"
import { GlassContainer } from "@/components/ui/glass-container"
import { TAB_CONFIG, NAV_TAB_CHOICES } from "@/components/nav-tab-config"
import { MAX_NAV_TABS, MIN_NAV_TABS } from "@/lib/utils/nav-tabs"
import { useDesktopPill } from "@/hooks/use-is-desktop"
import type { BottomNavTab, NavigationPreferences } from "@/types/db/stores.types"

interface NavBarEditorProps {
  /** The bar as it stands (already normalised: two to four, in order). */
  selectedTabs: BottomNavTab[]
  onUpdate: (nav: NavigationPreferences) => void
}

export function NavBarEditor({ selectedTabs, onUpdate }: NavBarEditorProps) {
  const top = useDesktopPill()
  const canRemove = selectedTabs.length > MIN_NAV_TABS
  const canAdd = selectedTabs.length < MAX_NAV_TABS
  const available = NAV_TAB_CHOICES.filter((t) => !selectedTabs.includes(t))

  const set = (bottomNavTabs: BottomNavTab[]) => onUpdate({ bottomNavTabs })

  return (
    <div className="select-none">
      <div className="pb-2 text-xs font-medium text-muted-foreground">
        {top ? "Top Bar" : "Bottom Bar"} · {selectedTabs.length} of {MAX_NAV_TABS}
      </div>

      {/* The bar itself. Its height, radius and columns are the real bar's:
          60px with a 56px tab on a phone, the 44px pill above it. */}
      <div className={cn("flex", top ? "justify-start" : "justify-center")}>
        <GlassContainer
          cornerRadius={top ? 22 : 30}
          disableTapFeedback
          className={cn(top ? "h-11" : "h-[60px] w-full max-w-[25rem]")}
        >
          <Reorder.Group
            as="div"
            axis="x"
            values={selectedTabs}
            onReorder={set}
            className={cn(
              "grid h-full grid-flow-col items-center px-0.5",
              top ? "auto-cols-[1fr]" : "auto-cols-[minmax(0,1fr)]"
            )}
          >
            {selectedTabs.map((key) => {
              const tab = TAB_CONFIG[key]
              if (!tab) return null
              const Icon = tab.icon
              return (
                <Reorder.Item
                  key={key}
                  as="div"
                  value={key}
                  // A sideways drag reorders; a vertical one still scrolls the
                  // panel (the swipe rows' rule).
                  style={{ touchAction: "pan-y" }}
                  whileDrag={{ scale: 1.06, zIndex: 3 }}
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  className="relative flex min-w-0 cursor-grab active:cursor-grabbing"
                >
                  {top ? (
                    <span className={cn("flex h-10 w-full items-center justify-center gap-1.5 rounded-full text-sm font-medium text-foreground", canRemove ? "pl-3.5 pr-2" : "px-3.5")}>
                      {tab.label}
                      {/* Inline in the pill: a corner badge sat on the glass's
                          edge, which clips. */}
                      {canRemove && <RemoveButton label={tab.label} onRemove={() => set(selectedTabs.filter((t) => t !== key))} />}
                    </span>
                  ) : (
                    <span className="flex h-14 w-full min-w-0 flex-col items-center justify-center gap-1 rounded-full px-0.5 text-foreground">
                      <Icon className="h-5 w-5" />
                      <span className="max-w-full truncate text-[10px] leading-none">{tab.label}</span>
                    </span>
                  )}
                  {!top && canRemove && (
                    <span className="absolute right-0.5 top-0.5 z-[4]">
                      <RemoveButton label={tab.label} onRemove={() => set(selectedTabs.filter((t) => t !== key))} />
                    </span>
                  )}
                </Reorder.Item>
              )
            })}
          </Reorder.Group>
        </GlassContainer>
      </div>

      <p className="pt-2 text-xs text-muted-foreground">
        Drag a tab sideways to move it. {MIN_NAV_TABS} to {MAX_NAV_TABS} tabs.
      </p>

      {available.length > 0 && (
        <>
          <div className="pb-2 pt-4 text-xs font-medium text-muted-foreground">Add a Tab</div>
          <div className="flex flex-wrap gap-2">
            {available.map((key) => {
              const tab = TAB_CONFIG[key]
              const Icon = tab.icon
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!canAdd}
                  onClick={() => set([...selectedTabs, key])}
                  className="control-surface flex h-9 items-center gap-1.5 rounded-full pl-2.5 pr-3 text-sm disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                  {tab.label}
                </button>
              )
            })}
          </div>
          {!canAdd && <p className="pt-2 text-xs text-muted-foreground">Remove a tab to add another.</p>}
        </>
      )}
    </div>
  )
}

/** The × on a tab — a press on it is never the start of a drag. */
function RemoveButton({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Remove ${label}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onRemove}
      className={cn(
        "control-surface relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground",
        "after:absolute after:-inset-2 after:content-['']"
      )}
    >
      <X className="h-3 w-3" strokeWidth={2.5} />
    </button>
  )
}
