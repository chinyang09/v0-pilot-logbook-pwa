"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Home, Book, Plus, MapPin, Plane, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { usePathname } from "next/navigation"

export function BottomNavbar() {
  const pathname = usePathname()
  const [isVisible, setIsVisible] = useState(true)
  const [lastScrollY, setLastScrollY] = useState(0)

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY

      if (currentScrollY < lastScrollY || currentScrollY < 50) {
        setIsVisible(true)
      } else if (currentScrollY > lastScrollY && currentScrollY > 100) {
        setIsVisible(false)
      }

      setLastScrollY(currentScrollY)
    }

    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [lastScrollY])

  const activeTab =
    pathname === "/"
      ? "dashboard"
      : pathname === "/logbook"
        ? "logbook"
        : pathname === "/airports" || pathname?.startsWith("/airports/")
          ? "airports"
          : pathname === "/aircraft" || pathname?.startsWith("/aircraft/")
            ? "aircraft"
            : pathname === "/crew" || pathname?.startsWith("/crew/")
              ? "crew"
              : null

  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-t border-border transition-transform duration-300",
        !isVisible && "translate-y-full",
      )}
    >
      <div className="container mx-auto px-1">
        <div className="flex items-center justify-around h-16">
          <Link href="/">
            <Button
              variant="ghost"
              className={cn(
                "flex flex-col items-center gap-0.5 h-14 px-2",
                activeTab === "dashboard" && "text-primary",
              )}
            >
              <Home className="h-5 w-5" />
              <span className="text-[9px]">Home</span>
            </Button>
          </Link>

          <Link href="/logbook">
            <Button
              variant="ghost"
              className={cn("flex flex-col items-center gap-0.5 h-14 px-2", activeTab === "logbook" && "text-primary")}
            >
              <Book className="h-5 w-5" />
              <span className="text-[9px]">Logbook</span>
            </Button>
          </Link>

          <Link href="/new-flight">
            <Button size="lg" className="h-12 w-12 rounded-full shadow-lg">
              <Plus className="h-6 w-6" />
            </Button>
          </Link>

          <Link href="/airports">
            <Button
              variant="ghost"
              className={cn("flex flex-col items-center gap-0.5 h-14 px-2", activeTab === "airports" && "text-primary")}
            >
              <MapPin className="h-5 w-5" />
              <span className="text-[9px]">Airports</span>
            </Button>
          </Link>

          <Link href="/aircraft">
            <Button
              variant="ghost"
              className={cn("flex flex-col items-center gap-0.5 h-14 px-2", activeTab === "aircraft" && "text-primary")}
            >
              <Plane className="h-5 w-5" />
              <span className="text-[9px]">Aircraft</span>
            </Button>
          </Link>

          <Link href="/crew">
            <Button
              variant="ghost"
              className={cn("flex flex-col items-center gap-0.5 h-14 px-2", activeTab === "crew" && "text-primary")}
            >
              <Users className="h-5 w-5" />
              <span className="text-[9px]">Crew</span>
            </Button>
          </Link>
        </div>
      </div>
    </nav>
  )
}
