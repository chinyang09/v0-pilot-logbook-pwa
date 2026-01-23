"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import { useDebounce } from "@/hooks/use-debounce"

export interface UseSearchableListOptions<T> {
  /** All items to search/filter */
  items: T[]
  /** Search function that filters items based on query */
  searchFn: (items: T[], query: string) => T[]
  /** Optional sort function */
  sortFn?: (a: T, b: T) => number
  /** Items per page for pagination (default: 50) */
  itemsPerPage?: number
  /** Debounce delay in ms (default: 150) */
  debounceDelay?: number
  /** Whether data is loading */
  isLoading?: boolean
}

export interface UseSearchableListReturn<T> {
  /** Current search query */
  searchQuery: string
  /** Set search query */
  setSearchQuery: (query: string) => void
  /** Debounced search query */
  debouncedSearchQuery: string
  /** Filtered and paginated items */
  displayedItems: T[]
  /** Total items after filtering */
  totalFilteredCount: number
  /** Number of items currently displayed */
  displayCount: number
  /** Whether there are more items to load */
  hasMore: boolean
  /** Ref for infinite scroll observer target */
  observerTarget: React.RefObject<HTMLDivElement>
  /** Whether currently loading */
  isLoading: boolean
  /** Manually set display count */
  setDisplayCount: (count: number | ((prev: number) => number)) => void
}

export function useSearchableList<T>({
  items,
  searchFn,
  sortFn,
  itemsPerPage = 50,
  debounceDelay = 150,
  isLoading = false,
}: UseSearchableListOptions<T>): UseSearchableListReturn<T> {
  const [searchQuery, setSearchQuery] = useState("")
  const debouncedSearchQuery = useDebounce(searchQuery, debounceDelay)
  const [displayCount, setDisplayCount] = useState(itemsPerPage)
  const observerTarget = useRef<HTMLDivElement>(null)

  // Filter and sort items
  const filteredItems = useMemo(() => {
    let result = items

    // Apply search filter
    if (debouncedSearchQuery.trim()) {
      result = searchFn(result, debouncedSearchQuery)
    }

    // Apply sort
    if (sortFn) {
      result = [...result].sort(sortFn)
    }

    return result
  }, [items, debouncedSearchQuery, searchFn, sortFn])

  // Paginate filtered items
  const displayedItems = useMemo(() => {
    return filteredItems.slice(0, displayCount)
  }, [filteredItems, displayCount])

  const hasMore = displayCount < filteredItems.length

  // Setup intersection observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoading && hasMore) {
          setDisplayCount((prev) => Math.min(prev + itemsPerPage, filteredItems.length))
        }
      },
      { threshold: 0.1 }
    )

    const target = observerTarget.current
    if (target) {
      observer.observe(target)
    }

    return () => {
      if (target) {
        observer.unobserve(target)
      }
    }
  }, [isLoading, hasMore, itemsPerPage, filteredItems.length])

  // Reset display count when search query changes
  useEffect(() => {
    setDisplayCount(itemsPerPage)
  }, [searchQuery, itemsPerPage])

  return {
    searchQuery,
    setSearchQuery,
    debouncedSearchQuery,
    displayedItems,
    totalFilteredCount: filteredItems.length,
    displayCount,
    hasMore,
    observerTarget,
    isLoading,
    setDisplayCount,
  }
}
