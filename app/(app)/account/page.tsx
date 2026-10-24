"use client"

/**
 * Account — MAIN / DETAIL, like Settings: the sections are a list here, and
 * each opens in the detail panel (beside the list on a tablet, the full-screen
 * overlay on a phone). It used to be one long scroll of four cards with two
 * accordions inside the first; what is behind each row now lives in
 * `components/account/account-sections.tsx`.
 *
 * Signing out is at the BOTTOM, under the sections, the way every
 * platform's account screen ends: "Sign out" for this device (neutral) and
 * "Sign out of all devices" for a lost one (red, on a countdown). There was no plain sign-out
 * at all — the only way off this device was to open Active sessions, find
 * your own row and swipe it for an unlabelled icon — and the all-devices one
 * sat ABOVE the sections, the first thing on the page being the most
 * destructive thing on it.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { ChevronRight, Download, KeyRound, LogOut, MonitorSmartphone, UserRound } from "lucide-react"
import { useAuth } from "@/components/providers/auth-provider"
import { PageContainer } from "@/components/page-container"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { FormSection } from "@/components/ui/form-section"
import { ActionRow, ActionStack } from "@/components/ui/action-row"
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
    // The label changes on the TAP: the push below can take seconds on a
    // phone, and a button that does nothing visible for that long reads as
    // broken.
    setIsLoggingOutAll(true)
    try {
      if (!(await confirmUnsyncedLoss())) return
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

  const [isSigningOut, setIsSigningOut] = useState(false)
  const handleSignOut = useCallback(async () => {
    // Pushes first, while the session still works, and asks before throwing
    // anything unsynced away — then `logout` revokes this device's session.
    // "Signing out…" from the TAP, not after the push — that push can take
    // seconds on a phone, and a button that does nothing visible for that
    // long reads as a sign-out that did not work.
    setIsSigningOut(true)
    try {
      if (!(await confirmUnsyncedLoss())) return
      await logout({ skipSync: true })
    } catch (error) {
      console.error("[Account] sign out failed:", error)
      await appAlert({
        title: "Couldn't sign out",
        message: "Something went wrong. Check your connection and try again.",
      })
    } finally {
      setIsSigningOut(false)
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
    <PageContainer title="Account">
      <div className="px-panel pt-4 space-y-4">
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

        <ActionStack>
          {/* Neutral: signing out of THIS device loses nothing (unsynced
              edits are pushed first, and asked about if they cannot be), so
              it does not share the red of the one action here with no way
              back. Two red capsules stacked read as two alarms. */}
          <ActionRow
            icon={<LogOut />}
            label={isSigningOut ? "Signing out…" : "Sign out"}
            disabled={isSigningOut || isLoggingOutAll}
            onClick={handleSignOut}
          />
          {/* Tapping ARMS it: the sign-out then runs on a countdown the same
              button cancels. There is no undo once it fires — every device
              has to sign in again. */}
          {logoutArmed ? (
            <CountdownConfirmButton
              label="Cancel sign out"
              icon={<LogOut className="h-4 w-4" />}
              onConfirm={() => {
                setLogoutArmed(false)
                handleLogoutAll()
              }}
              onCancel={() => setLogoutArmed(false)}
              className="w-full text-[15px]"
            />
          ) : (
            <ActionRow
              destructive
              icon={<LogOut />}
              label={isLoggingOutAll ? "Signing out…" : "Sign out of all devices"}
              disabled={isLoggingOutAll || isSigningOut}
              onClick={() => setLogoutArmed(true)}
            />
          )}
        </ActionStack>
      </div>
    </PageContainer>
  )
}
