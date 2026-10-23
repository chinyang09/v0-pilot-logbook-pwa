"use client"

/**
 * Account — MAIN / DETAIL, like Settings: the sections are a list here, and
 * each opens in the detail panel (beside the list on a tablet, the full-screen
 * overlay on a phone). It used to be one long scroll of four cards with two
 * accordions inside the first; what is behind each row now lives in
 * `components/account/account-sections.tsx`.
 *
 * "Log out of all devices" stays on the list, at the top. It is not a section
 * of anything — it is the one thing a pilot who has lost a phone comes here
 * to do.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { ChevronRight, Download, KeyRound, Loader2, LogOut, MonitorSmartphone, UserRound } from "lucide-react"
import { useAuth } from "@/components/providers/auth-provider"
import { PageContainer } from "@/components/page-container"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { FormSection } from "@/components/ui/form-section"
import { Button } from "@/components/ui/button"
import { CountdownConfirmButton } from "@/components/ui/countdown-confirm-button"
import { AccountSection, deviceHasPasskey, type AccountSectionKey } from "@/components/account/account-sections"
import { confirmUnsyncedLoss, useAccountProfile, useAccountSessions } from "@/components/account/account-data"
import { getOrCreateDeviceId } from "@/lib/utils/device"
import { appAlert } from "@/lib/utils/app-alert"
import { cn } from "@/lib/utils"

const SECTION_KEYS: AccountSectionKey[] = ["profile", "passkeys", "sessions", "install"]

const noSubscribe = () => () => {}
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (window.navigator as unknown as { standalone?: boolean }).standalone === true

export default function AccountPage() {
  const { user, logout } = useAuth()
  const { profile } = useAccountProfile()
  const { sessions, isLoading: sessionsLoading } = useAccountSessions()
  const { selectedId, setSelectedId, setDetailContent } = useDetailPanel()
  const isDesktop = useIsDesktop()
  const installed = useSyncExternalStore(noSubscribe, isStandalone, () => true)
  const [myDeviceId] = useState<string | null>(() =>
    typeof window !== "undefined" ? getOrCreateDeviceId() : null,
  )

  // Clear stale keep-alive page actions
  useRegisterMainActions(null, true)

  const [isLoggingOutAll, setIsLoggingOutAll] = useState(false)
  // Armed = the countdown is running and the button now cancels it.
  const [logoutArmed, setLogoutArmed] = useState(false)

  const sections = SECTION_KEYS.filter((k) => k !== "install" || !installed)
  const selected = sections.find((k) => k === selectedId) ?? null

  useEffect(() => {
    if (selected) {
      setDetailContent(<AccountSection key={selected} section={selected} />)
    } else if (isDesktop) {
      // A tablet's panel shows the first section rather than a placeholder.
      // Programmatic (explicit: false), so it writes no history entry and
      // cannot pop the phone's overlay if the window narrows.
      setSelectedId("profile", { explicit: false })
    } else {
      setDetailContent(null)
    }
  }, [selected, isDesktop, setDetailContent, setSelectedId])

  const handleLogoutAll = useCallback(async () => {
    // This exists for a LOST device, so it has to actually reach the server.
    // The request's failure used to be swallowed and this device wiped anyway:
    // offline, the pilot was signed out here believing the lost phone was too,
    // while its session stayed perfectly valid.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await appAlert({
        title: "You're offline",
        message: "Signing out of all devices needs a connection. Try again once you're back online.",
      })
      return
    }
    if (!(await confirmUnsyncedLoss())) return
    setIsLoggingOutAll(true)
    try {
      const res = await fetch("/api/account/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      }).catch(() => null)
      if (!res?.ok) {
        await appAlert({
          title: "Couldn't sign out your other devices",
          message: "Nothing was changed. Check your connection and try again.",
        })
        return
      }
      // confirmUnsyncedLoss already pushed; the session is revoked now, so a
      // second pre-logout sync would only meet a 401.
      await logout({ skipSync: true })
    } finally {
      setIsLoggingOutAll(false)
    }
  }, [logout])

  const passkeyCount = profile?.passkeys.length ?? null
  const rows: Record<AccountSectionKey, { label: string; icon: typeof KeyRound; summary: string }> = {
    profile: { label: "Profile", icon: UserRound, summary: profile?.callsign || user?.callsign || "" },
    passkeys: {
      label: "Passkeys",
      icon: KeyRound,
      summary:
        passkeyCount == null
          ? ""
          : `${passkeyCount} · ${deviceHasPasskey(profile?.passkeys, myDeviceId) ? "this device has one" : "none on this device"}`,
    },
    sessions: {
      label: "Active sessions",
      icon: MonitorSmartphone,
      summary: sessionsLoading && sessions.length === 0 ? "" : `${sessions.length} signed in`,
    },
    install: { label: "Install app", icon: Download, summary: "Home screen, works offline" },
  }

  return (
    <PageContainer>
      <div className="px-panel pt-4 space-y-4">
        {/* Global logout — prominent, at the very top. Tapping ARMS it: the
            logout then runs on a countdown the same button cancels. */}
        {logoutArmed ? (
          <CountdownConfirmButton
            label="Cancel log out"
            icon={<LogOut className="h-4 w-4" />}
            onConfirm={() => {
              setLogoutArmed(false)
              handleLogoutAll()
            }}
            onCancel={() => setLogoutArmed(false)}
            className="w-full"
          />
        ) : (
          <Button
            variant="outline"
            className="w-full h-11 gap-2"
            disabled={isLoggingOutAll}
            onClick={() => setLogoutArmed(true)}
          >
            {isLoggingOutAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            {isLoggingOutAll ? "Logging out…" : "Log out of all devices"}
          </Button>
        )}

        <FormSection>
          {sections.map((key) => {
            const { label, icon: Icon, summary } = rows[key]
            // Lit only where the panel beside the list shows it.
            const isActive = isDesktop && selected === key
            return (
              <button
                key={key}
                type="button"
                aria-current={isActive || undefined}
                className={cn(
                  "row-divider flex w-full items-center px-4 py-3.5 text-left transition-colors",
                  isActive ? "bg-primary/10 text-primary" : "hover:bg-secondary/50 active:bg-secondary/50"
                )}
                onClick={() => setSelectedId(key)}
              >
                <Icon className={cn("mr-3 h-4 w-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{label}</div>
                  {/* Reserves its line while the summary loads, so the rows
                      do not grow under the reader. */}
                  <div className="min-h-[1.25em] truncate text-xs leading-tight text-muted-foreground">{summary}</div>
                </div>
                <ChevronRight className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            )
          })}
        </FormSection>
      </div>
    </PageContainer>
  )
}
