"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { Check, GripVertical } from "lucide-react"
import { cn } from "@/lib/utils"
import type { BottomNavTab } from "@/types/db/stores.types"
import type { NavigationPreferences } from "@/types/db/stores.types"

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

export function SortableNavList({ tabs, selectedTabs, onUpdate }: SortableNavListProps) {
  // Build ordered list: selected first (in order), then unselected
  const selectedItems = selectedTabs
    .map((key) => tabs.find((t) => t.value === key))
    .filter(Boolean) as NavTabItem[]
  const unselectedItems = tabs.filter((t) => !selectedTabs.includes(t.value))

  // Drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragItemRef = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const startYRef = useRef(0)
  const currentYRef = useRef(0)

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => clearLongPress()
  }, [clearLongPress])

  const handleToggleTab = (tab: BottomNavTab) => {
    const isSelected = selectedTabs.includes(tab)

    if (isSelected) {
      // Remove — replace with first available unselected tab
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
      // Add — replace last selected tab
      const newTabs = [...selectedTabs] as [BottomNavTab, BottomNavTab, BottomNavTab, BottomNavTab]
      newTabs[3] = tab
      onUpdate({ bottomNavTabs: newTabs })
    }
  }

  const getItemCenters = () => {
    const centers: number[] = []
    for (let i = 0; i < selectedItems.length; i++) {
      const el = itemRefs.current.get(i)
      if (el) {
        const rect = el.getBoundingClientRect()
        centers.push(rect.top + rect.height / 2)
      }
    }
    return centers
  }

  const findInsertIndex = (clientY: number) => {
    const centers = getItemCenters()
    for (let i = 0; i < centers.length; i++) {
      if (clientY < centers[i]) return i
    }
    return centers.length - 1
  }

  const handlePointerDown = (e: React.PointerEvent, index: number) => {
    // Only on the grip handle and for selected items
    if (index >= selectedItems.length) return
    e.preventDefault()

    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    startYRef.current = e.clientY
    currentYRef.current = e.clientY
    dragItemRef.current = index

    // Long press to activate drag
    longPressTimer.current = setTimeout(() => {
      setDragIndex(index)
      setOverIndex(index)
      setIsDragging(true)

      // Haptic feedback if available
      if (navigator.vibrate) navigator.vibrate(30)
    }, 300)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    currentYRef.current = e.clientY

    // Cancel long press if moved too far before it triggered
    if (!isDragging && longPressTimer.current) {
      const dist = Math.abs(e.clientY - startYRef.current)
      if (dist > 8) clearLongPress()
      return
    }

    if (!isDragging || dragIndex === null) return

    // Find which position the dragged item should land
    const newOver = findInsertIndex(e.clientY)
    if (newOver !== overIndex) {
      setOverIndex(newOver)
    }

    // Move the dragged element via React state
    setDragOffset(e.clientY - startYRef.current)
  }

  const handlePointerUp = () => {
    clearLongPress()

    if (isDragging && dragIndex !== null && overIndex !== null && dragIndex !== overIndex) {
      // Reorder
      const newOrder = [...selectedTabs]
      const [moved] = newOrder.splice(dragIndex, 1)
      newOrder.splice(overIndex, 0, moved)
      onUpdate({
        bottomNavTabs: newOrder as [BottomNavTab, BottomNavTab, BottomNavTab, BottomNavTab],
      })
    }

    setDragOffset(0)
    setDragIndex(null)
    setOverIndex(null)
    setIsDragging(false)
    dragItemRef.current = null
  }

  return (
    <div ref={containerRef} className="space-y-1 select-none">
      {/* Selected tabs — draggable */}
      {selectedItems.map((tab, index) => {
        const Icon = tab.icon
        const isBeingDragged = isDragging && dragIndex === index
        const isOverTarget = isDragging && overIndex === index && dragIndex !== index

        return (
          <div
            key={tab.value}
            ref={(el) => {
              if (el) itemRefs.current.set(index, el)
              else itemRefs.current.delete(index)
            }}
            className={cn(
              "flex items-center h-11 rounded-lg transition-colors select-none",
              isBeingDragged && "opacity-70 bg-primary/10 shadow-lg z-50 relative",
              isOverTarget && "border-t-2 border-primary",
              !isBeingDragged && !isOverTarget && "border-t-2 border-transparent"
            )}
            style={isBeingDragged ? { transform: `translateY(${dragOffset}px)` } : undefined}
          >
            <button
              type="button"
              className="flex items-center gap-3 flex-1 h-full pl-3"
              onClick={() => handleToggleTab(tab.value)}
            >
              <Check className="h-4 w-4 text-primary flex-shrink-0" />
              <span className="text-sm">{tab.label}</span>
            </button>
            <div
              className="flex items-center justify-center w-11 h-full cursor-grab active:cursor-grabbing touch-none"
              onPointerDown={(e) => handlePointerDown(e, index)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              <GripVertical className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        )
      })}

      {/* Separator */}
      {unselectedItems.length > 0 && <div className="border-t border-border my-2" />}

      {/* Unselected tabs — tap to toggle */}
      {unselectedItems.map((tab) => {
        const Icon = tab.icon
        return (
          <button
            key={tab.value}
            type="button"
            className="flex items-center gap-3 h-11 w-full pl-3 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
            onClick={() => handleToggleTab(tab.value)}
          >
            <div className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm">{tab.label}</span>
          </button>
        )
      })}

      <p className="text-xs text-muted-foreground pt-2">
        Choose up to 4 tabs for your bottom navigation bar. Long press the drag handle to reorder.
      </p>
    </div>
  )
}
