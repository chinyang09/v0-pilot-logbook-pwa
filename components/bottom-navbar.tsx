"use client";

import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Book,
  Plus,
  Calendar,
  Plane,
  Users,
  MapPin,
  Award,
  Settings,
  UserCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCreateFlight } from "@/hooks/use-create-flight";
import { usePreferences } from "@/components/providers/preferences-provider";
import type { BottomNavTab } from "@/types/db/stores.types";

const TAB_CONFIG: Record<
  BottomNavTab,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    href: string;
    isActive: (pathname: string) => boolean;
  }
> = {
  dashboard: {
    label: "Dashboard",
    icon: LayoutDashboard,
    href: "/",
    isActive: (p) => p === "/",
  },
  logbook: {
    label: "Logbook",
    icon: Book,
    href: "/logbook",
    isActive: (p) => p === "/logbook" || p?.startsWith("/flights/"),
  },
  roster: {
    label: "Roster",
    icon: Calendar,
    href: "/roster",
    isActive: (p) =>
      p === "/roster" ||
      p === "/currencies" ||
      p === "/discrepancies" ||
      p === "/fdp",
  },
  aircraft: {
    label: "Aircraft",
    icon: Plane,
    href: "/aircraft",
    isActive: (p) => p === "/aircraft" || p?.startsWith("/aircraft/"),
  },
  crew: {
    label: "Crew",
    icon: Users,
    href: "/crew",
    isActive: (p) => p === "/crew" || p?.startsWith("/crew/"),
  },
  airports: {
    label: "Airports",
    icon: MapPin,
    href: "/airports",
    isActive: (p) => p === "/airports" || p?.startsWith("/airports/"),
  },
  currencies: {
    label: "Currencies",
    icon: Award,
    href: "/currencies",
    isActive: (p) => p === "/currencies",
  },
  settings: {
    label: "Settings",
    icon: Settings,
    href: "/settings",
    isActive: (p) => p === "/settings",
  },
  account: {
    label: "Account",
    icon: UserCircle,
    href: "/account",
    isActive: (p) => p === "/account",
  },
};

interface BottomNavbarProps {
  className?: string;
}

export function BottomNavbar({ className }: BottomNavbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const createFlight = useCreateFlight();
  const { preferences } = usePreferences();

  const tabs = preferences.navigation.bottomNavTabs;
  const leftTabs = tabs.slice(0, 2);
  const rightTabs = tabs.slice(2, 4);

  return (
    <nav
      className={cn(
        "flex-shrink-0 bg-background/30 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]",
        className
      )}
    >
      <div className="px-1">
        <div className="flex items-center justify-around h-16">
          {leftTabs.map((tabKey) => {
            const tab = TAB_CONFIG[tabKey];
            if (!tab) return null;
            const Icon = tab.icon;
            return (
              <Link key={tabKey} href={tab.href}>
                <Button
                  variant="ghost"
                  className={cn(
                    "flex flex-col items-center gap-0.5 h-14 px-3 active:scale-90",
                    tab.isActive(pathname) ? "text-primary bg-primary/10 rounded-xl" : ""
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-[9px]">{tab.label}</span>
                </Button>
              </Link>
            );
          })}

          <Button
            size="lg"
            className="h-12 w-12 rounded-full shadow-lg active:scale-90"
            onClick={async () => {
              const draft = await createFlight();
              router.push(`/logbook?selected=${draft.id}`);
            }}
          >
            <Plus className="h-6 w-6" />
          </Button>

          {rightTabs.map((tabKey) => {
            const tab = TAB_CONFIG[tabKey];
            if (!tab) return null;
            const Icon = tab.icon;
            return (
              <Link key={tabKey} href={tab.href}>
                <Button
                  variant="ghost"
                  className={cn(
                    "flex flex-col items-center gap-0.5 h-14 px-3 active:scale-90",
                    tab.isActive(pathname) ? "text-primary bg-primary/10 rounded-xl" : ""
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-[9px]">{tab.label}</span>
                </Button>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
