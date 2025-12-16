"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { SyncStatus } from "@/components/sync-status"
import { BottomNavbar } from "@/components/bottom-navbar"
import { PWAInstallPrompt } from "@/components/pwa-install-prompt"
import { usePersonnel } from "@/hooks/use-indexed-db"
import { Search, Loader2, User, Plus, ArrowLeft } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"

const ITEMS_PER_PAGE = 50

export default function CrewPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fieldType = searchParams.get("field") // 'pic', 'sic', or 'other'
  const returnUrl = searchParams.get("return") || "/new-flight"

  const { personnel, isLoading } = usePersonnel()
  const [searchQuery, setSearchQuery] = useState("")
  const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE)
  const observerTarget = useRef<HTMLDivElement>(null)

  const filteredPersonnel = useMemo(() => {
    if (!searchQuery.trim()) {
      return personnel.slice(0, displayCount)
    }
    const query = searchQuery.toLowerCase()
    return personnel
      .filter(
        (p) =>
          p.name?.toLowerCase().includes(query) ||
          p.crewId?.toLowerCase().includes(query) ||
          p.organization?.toLowerCase().includes(query) ||
          p.roles?.some((r) => r.toLowerCase().includes(query)),
      )
      .slice(0, displayCount)
  }, [personnel, searchQuery, displayCount])

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
      params.set("crewName", crew.name)
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

  const renderCrewCard = (crew: (typeof personnel)[0]) => (
    <button
      key={crew.id}
      onClick={() => handleCrewSelect(crew)}
      className="w-full text-left bg-card border border-border rounded-lg p-3 hover:bg-accent transition-all"
    >
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <User className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-foreground">{crew.name}</span>
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
  )

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
            {filteredPersonnel.map((crew) => renderCrewCard(crew))}

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
    </div>
  )
}
