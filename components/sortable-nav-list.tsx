"use client"

import { Check, GripVertical } from "lucide-react"
import { Reorder, useDragControls } from "framer-motion"
import { cn } from "@/lib/utils"
import type { BottomNavTab, NavigationPreferences } from "@/types/db/stores.types"

interface NavTabItem {
  value: BottomNavTab
  label: string
  icon: React.ComponentType<{ className?: string }>
}

interface SortableNavListProps {
  tabs: NavTabItem[]
  selectedTabs: [BottomNavTab, BottomNavTab, BottomNavTab, BottomNavTab]
  onUpdate: (nav: NavigationPreferences) => void
}

/**
 * One selected (draggable) row. Dragging is gated to the grip handle via
 * `useDragControls` + `dragListener={false}`, so the row's tap-to-remove button
 * still works and you can't start a drag from anywhere on the row.
 */
function SelectedNavRow({
  item,
  onToggle,
}: {
  item: NavTabItem
  onToggle: (tab: BottomNavTab) => void
}) {
  const controls = useDragControls()
  const Icon = item.icon

  return (
    <Reorder.Item
      as="div"
      value={item.value}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.02, boxShadow: "0 12px 28px rgba(0,0,0,0.22)" }}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
      className="flex items-center h-11 rounded-lg bg-card select-none"
    >
      <button
        type="button"
        className="flex items-center gap-3 flex-1 h-full pl-3 min-w-0"
        onClick={() => onToggle(item.value)}
      >
        <Check className="h-4 w-4 text-primary flex-shrink-0" />
        <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span className="text-sm truncate">{item.label}</span>
      </button>
      {/* Drag handle — the only place a drag can start. */}
      <div
        role="button"
        aria-label={`Reorder ${item.label}`}
        className="flex items-center justify-center w-11 h-full cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => controls.start(e)}
      >
        <GripVertical className="h-4 w-4" />
      </div>
    </Reorder.Item>
  )
}

export function SortableNavList({ tabs, selectedTabs, onUpdate }: SortableNavListProps) {
  // Selected first (in order), then the rest.
  const selectedItems = selectedTabs
    .map((key) => tabs.find((t) => t.value === key))
    .filter(Boolean) as NavTabItem[]
  const unselectedItems = tabs.filter((t) => !selectedTabs.includes(t.value))

  const handleToggleTab = (tab: BottomNavTab) => {
    const isSelected = selectedTabs.includes(tab)
    if (isSelected) {
      // Remove — replace with the first available unselected tab.
      const available = tabs.filter((t) => !selectedTabs.includes(t.value) && t.value !== tab)
      if (available.length === 0) return
      const newTabs = selectedTabs.map((t) => (t === tab ? available[0].value : t)) as [
        BottomNavTab,
        BottomNavTab,
        BottomNavTab,
        BottomNavTab,
      ]
      onUpdate({ bottomNavTabs: newTabs })
    } else {
      // Add — replace the last selected tab.
      const newTabs = [...selectedTabs] as [BottomNavTab, BottomNavTab, BottomNavTab, BottomNavTab]
      newTabs[3] = tab
      onUpdate({ bottomNavTabs: newTabs })
    }
  }

  // `updateNavigation` updates state optimistically, so driving Reorder straight
  // off the prop stays smooth (the new order is reflected on the next render).
  const handleReorder = (order: BottomNavTab[]) => {
    if (order.length !== selectedTabs.length) return
    onUpdate({
      bottomNavTabs: order as [BottomNavTab, BottomNavTab, BottomNavTab, BottomNavTab],
    })
  }

  return (
    <div className="select-none">
      <Reorder.Group
        as="div"
        axis="y"
        values={selectedTabs}
        onReorder={handleReorder}
        className={cn("space-y-1")}
      >
        {selectedItems.map((item) => (
          <SelectedNavRow key={item.value} item={item} onToggle={handleToggleTab} />
        ))}
      </Reorder.Group>

      {unselectedItems.length > 0 && <div className="border-t border-border my-2" />}

      <div className="space-y-1">
        {unselectedItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.value}
              type="button"
              className="flex items-center gap-3 h-11 w-full pl-3 rounded-lg text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
              onClick={() => handleToggleTab(item.value)}
            >
              <div className="h-4 w-4 flex-shrink-0" />
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span className="text-sm">{item.label}</span>
            </button>
          )
        })}
      </div>

      <p className="pt-3 text-xs text-muted-foreground">
        These four tabs appear in the bottom tab bar on mobile and the navigation pill on desktop.
        Drag the handle to reorder, or tap to swap one out.
      </p>
    </div>
  )
}
