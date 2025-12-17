"use client"

import type React from "react"

import { useState, useMemo, useRef, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { SyncStatus } from "@/components/sync-status"
import { BottomNavbar } from "@/components/bottom-navbar"
import { PWAInstallPrompt } from "@/components/pwa-install-prompt"
import { usePersonnel } from "@/hooks/use-indexed-db"
import { deletePersonnel } from "@/lib/indexed-db"
import { Search, Loader2, User, Plus, ArrowLeft, Trash2 } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { mutate } from "swr"
import { CACHE_KEYS } from "@/hooks/use-indexed-db"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

const ITEMS_PER_PAGE = 50
const SWIPE_THRESHOLD = 80

function SwipeableCrewCard({
  crew,
  onSelect,
  onDelete,
  isSelectMode,
}: {
  crew: {
    id: string
    name: string
    crewId?: string
    organization?: string
    roles?: string[]
    isMe?: boolean
  }
  onSelect: () => void
  onDelete: () => void
  isSelectMode: boolean
}) {
  const [swipeX, setSwipeX] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)
  const startX = useRef(0)
  const startY = useRef(0)
  const isHorizontalSwipe = useRef<boolean | null>(null)

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    isHorizontalSwipe.current = null
    setIsSwiping(true)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isSwiping) return

    const currentX = e.touches[0].clientX
    const currentY = e.touches[0].clientY
    const diffX = currentX - startX.current
    const diffY = currentY - startY.current

    if (isHorizontalSwipe.current === null && (Math.abs(diffX) > 10 || Math.abs(diffY) > 10)) {
      isHorizontalSwipe.current = Math.abs(diffX) > Math.abs(diffY)
    }

    if (isHorizontalSwipe.current) {
      if (diffX < 0) {
        setSwipeX(Math.max(diffX, -SWIPE_THRESHOLD))
      } else if (swipeX < 0) {
        setSwipeX(Math.min(0, swipeX + diffX))
      }
    }
  }

  const handleTouchEnd = () => {
    setIsSwiping(false)
    if (swipeX < -SWIPE_THRESHOLD / 2) {
      setSwipeX(-SWIPE_THRESHOLD)
    } else {
      setSwipeX(0)
    }
  }

  const handleClick = () => {
    if (swipeX < 0) {
      setSwipeX(0)
    } else {
      onSelect()
    }
  }

  const displayName = crew.isMe ? "Self" : crew.name

  return (
    <div className="relative overflow-hidden rounded-lg">
      {/* Delete button behind */}
      <div
        className={cn(
          "absolute inset-y-0 right-0 flex items-center transition-opacity",
          swipeX < 0 ? "opacity-100" : "opacity-0",
        )}
        style={{ width: SWIPE_THRESHOLD }}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-full w-full rounded-none bg-destructive text-destructive-foreground"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 className="h-5 w-5" />
        </Button>
      </div>

      {/* Card */}
      <button
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={cn(
          "w-full text-left bg-card border border-border rounded-lg p-3 hover:bg-accent transition-all",
          !isSwiping && "transition-transform duration-200",
        )}
        style={{ transform: `translateX(${swipeX}px)` }}
      >
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <User className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-semibold text-foreground">{displayName}</span>
              {crew.crewId && (
                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{crew.crewId}</span>
              )}
              {crew.isMe && <span className="text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded">Me</span>}
            </div>

            {crew.organization && <div className="text-sm text-muted-foreground">{crew.organization}</div>}

            {crew.roles && crew.roles.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {crew.roles.map((role) => (
                  <span key={role} className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                    {role}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </button>
    </div>
  )
}

export default function CrewPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fieldType = searchParams.get("field") // 'pic', 'sic', or 'other'
  const returnUrl = searchParams.get("return") || "/new-flight"

  const { personnel, isLoading } = usePersonnel()
  const [searchQuery, setSearchQuery] = useState("")
  const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE)
  const [deleteTarget, setDeleteTarget] = useState<(typeof personnel)[0] | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const observerTarget = useRef<HTMLDivElement>(null)

  const sortedPersonnel = useMemo(() => {
    const sorted = [...personnel].sort((a, b) => {
      // Self always first
      if (a.isMe && !b.isMe) return -1
      if (!a.isMe && b.isMe) return 1
      // Favorites next
      if (a.favorite && !b.favorite) return -1
      if (!a.favorite && b.favorite) return 1
      // Then alphabetical
      return (a.name || "").localeCompare(b.name || "")
    })
    return sorted
  }, [personnel])

  const filteredPersonnel = useMemo(() => {
    if (!searchQuery.trim()) {
      return sortedPersonnel.slice(0, displayCount)
    }
    const query = searchQuery.toLowerCase()
    return sortedPersonnel
      .filter(
        (p) =>
          p.name?.toLowerCase().includes(query) ||
          p.crewId?.toLowerCase().includes(query) ||
          p.organization?.toLowerCase().includes(query) ||
          p.roles?.some((r) => r.toLowerCase().includes(query)),
      )
      .slice(0, displayCount)
  }, [sortedPersonnel, searchQuery, displayCount])

  const hasSelf = useMemo(() => personnel.some((p) => p.isMe), [personnel])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoading) {
          setDisplayCount((prev) => Math.min(prev + ITEMS_PER_PAGE, personnel.length))
        }
      },
      { threshold: 0.1 },
    )

    const target = observerTarget.current
    if (target) observer.observe(target)

    return () => {
      if (target) observer.unobserve(target)
    }
  }, [isLoading, personnel.length])

  useEffect(() => {
    setDisplayCount(ITEMS_PER_PAGE)
  }, [searchQuery])

  const handleCrewSelect = (crew: (typeof personnel)[0]) => {
    if (fieldType) {
      const params = new URLSearchParams()
      params.set("field", fieldType)
      params.set("crewId", crew.id)
      params.set("crewName", crew.isMe ? "Self" : crew.name)
      router.push(`${returnUrl}?${params.toString()}`)
    } else {
      router.push(`/crew/${crew.id}`)
    }
  }

  const handleAddCrew = () => {
    if (fieldType) {
      router.push(`/crew/new?field=${fieldType}&return=${encodeURIComponent(returnUrl)}`)
    } else {
      router.push("/crew/new")
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      await deletePersonnel(deleteTarget.id)
      await mutate(CACHE_KEYS.personnel)
    } finally {
      setIsDeleting(false)
      setDeleteTarget(null)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-b border-border">
        <div className="container mx-auto px-3">
          <div className="flex items-center justify-between h-12">
            <div className="flex items-center gap-2">
              {fieldType && (
                <Button variant="ghost" size="sm" onClick={() => router.back()} className="h-8 w-8 p-0">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              )}
              <h1 className="text-lg font-semibold text-foreground">
                {fieldType ? `Select ${fieldType === "pic" ? "PIC" : fieldType === "sic" ? "SIC" : "Crew"}` : "Crew"}
              </h1>
            </div>
            <SyncStatus />
          </div>
        </div>
      </div>

      <main className="container mx-auto px-3 pt-14 pb-20">
        <div className="sticky top-12 z-40 bg-background py-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search name, crew ID, organization..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-10"
              />
            </div>
            <Button onClick={handleAddCrew} size="icon" className="h-10 w-10 flex-shrink-0">
              <Plus className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {isLoading && displayCount === ITEMS_PER_PAGE && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading crew...</span>
          </div>
        )}

        {!isLoading && (
          <div className="space-y-2 mt-2">
            {filteredPersonnel.map((crew) => (
              <SwipeableCrewCard
                key={crew.id}
                crew={crew}
                onSelect={() => handleCrewSelect(crew)}
                onDelete={() => setDeleteTarget(crew)}
                isSelectMode={!!fieldType}
              />
            ))}

            <div ref={observerTarget} className="h-4" />

            {filteredPersonnel.length === 0 && !isLoading && (
              <div className="text-center py-12">
                <User className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-sm text-muted-foreground mb-4">
                  {searchQuery ? "No crew found matching your search" : "No crew members yet"}
                </p>
                <Button onClick={handleAddCrew} variant="outline">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Crew Member
                </Button>
              </div>
            )}

            {filteredPersonnel.length > 0 && filteredPersonnel.length < personnel.length && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="ml-2 text-xs text-muted-foreground">
                  Showing {filteredPersonnel.length} of {personnel.length} crew members...
                </span>
              </div>
            )}
          </div>
        )}
      </main>

      <BottomNavbar />
      <PWAInstallPrompt />

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Crew Member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deleteTarget?.isMe ? "Self" : deleteTarget?.name}? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
