"use client";

/**
 * Add or edit a roster duty by hand.
 *
 * The roster is otherwise import-only, which meant a standby the company
 * phoned through — or one the report got wrong — could not be recorded at all.
 * Flights need no equivalent: the logbook has always taken a new entry.
 *
 * It is a full-screen dialog rather than a detail panel because the roster
 * route has `hasDetailPanel: false`, and populating detail panels on the
 * non-detail routes is owner-approved design work that is explicitly not to be
 * done piecemeal. Bounds follow `signature-dialog.tsx`: the CONTENT region,
 * not `inset-0`, or the sidebar and the nav pill draw over it on a tablet.
 */

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/ui/form-section";
import { SettingsRow, SelectRow } from "@/components/ui/settings-row";
import { useBackDismiss } from "@/hooks/use-back-dismiss";
import { useDesktopPill, useIsDesktop } from "@/hooks/use-is-desktop";
import { useSidebar } from "@/hooks/use-sidebar-context";
import { SIDEBAR_WIDTH_PX } from "@/lib/layout/panel-widths";
import { addScheduleEntry, updateScheduleEntry } from "@/lib/db";
import type { DutyType, ScheduleEntry } from "@/types/entities/roster.types";
import { isValidHHMM } from "@/lib/utils/time";
import { cn } from "@/lib/utils";

/**
 * The kinds a pilot can enter by hand.
 *
 * `flight` is deliberately absent: flights live in the logbook and nowhere
 * else, and a flight in the roster would be a parallel record needing
 * reconciliation — which is what made the old roster heavy.
 */
const DUTY_TYPES: { value: DutyType; label: string }[] = [
  { value: "standby", label: "Standby" },
  { value: "training", label: "Training" },
  { value: "ground", label: "Ground duty" },
  { value: "positioning", label: "Positioning" },
  { value: "leave", label: "Leave" },
  { value: "off", label: "Day off" },
];

/** Kinds that occupy a window of the day rather than the whole of it. */
const HAS_WINDOW = new Set<DutyType>([
  "standby",
  "training",
  "ground",
  "positioning",
]);

const todayUTC = () => new Date().toISOString().slice(0, 10);

export function DutyEntryDialog({
  open,
  entry,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** The duty being edited, or null to add a new one. */
  entry: ScheduleEntry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isDesktop = useIsDesktop();
  const canPushSidebar = useDesktopPill();
  const { isOpen: sidebarOpen } = useSidebar();
  const dismiss = useBackDismiss(open, onClose);

  // Seeded from the entry by `useState` initialisers, and re-seeded by the
  // `key` on this component rather than by an effect. An effect that writes
  // form state is a cascading render, and keying it on the entry object would
  // clobber an edit in progress every time a sync write handed back a fresh
  // row; keying the COMPONENT on the id gets the initialisation for free.
  const [date, setDate] = useState(() => entry?.date ?? todayUTC());
  const [dutyType, setDutyType] = useState<DutyType>(
    () => entry?.dutyType ?? "standby"
  );
  const [dutyCode, setDutyCode] = useState(() => entry?.dutyCode ?? "");
  const [description, setDescription] = useState(
    () => entry?.dutyDescription ?? ""
  );
  const [start, setStart] = useState(() => entry?.reportTime ?? "");
  const [end, setEnd] = useState(() => entry?.debriefTime ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismiss();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismiss]);

  const wantsWindow = HAS_WINDOW.has(dutyType);
  const timesValid =
    !wantsWindow || (isValidHHMM(start) && isValidHHMM(end) && start !== end);
  const canSave = Boolean(date) && Boolean(dutyCode.trim()) && timesValid && !saving;

  const region: React.CSSProperties = useMemo(() => {
    const pushedBy = canPushSidebar && sidebarOpen ? SIDEBAR_WIDTH_PX : 0;
    return isDesktop
      ? {
          top: "var(--chrome-top)",
          bottom: "var(--chrome-bottom)",
          left: `calc(${pushedBy}px + var(--panel-gutter))`,
          right: "var(--panel-gutter)",
          transition: "left 200ms cubic-bezier(0.25, 0.1, 0.25, 1)",
        }
      : { inset: 0 };
  }, [isDesktop, canPushSidebar, sidebarOpen]);

  if (!open || typeof document === "undefined") return null;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      // Times are UTC, the same frame the parser writes and everything
      // downstream reads.
      const payload = {
        date,
        timeReference: "UTC" as const,
        dutyType,
        dutyCode: dutyCode.trim().toUpperCase(),
        dutyDescription: description.trim() || undefined,
        reportTime: wantsWindow ? start : undefined,
        debriefTime: wantsWindow ? end : undefined,
      };

      if (entry) {
        await updateScheduleEntry(entry.id, payload);
      } else {
        await addScheduleEntry({
          ...payload,
          sectors: [],
          crew: [],
          importedAt: Date.now(),
        });
      }
      onSaved();
      dismiss();
    } catch (error) {
      console.error("[Roster] Saving duty failed:", error);
      setSaving(false);
    }
  };

  return createPortal(
    <div
      style={region}
      className={cn(
        "fixed z-[65] flex flex-col bg-background",
        isDesktop && "rounded-2xl border border-border overflow-hidden shadow-2xl"
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between px-4 h-14 flex-shrink-0 border-b border-border",
          !isDesktop && "pt-safe"
        )}
      >
        <h2 className="text-base font-semibold">
          {entry ? "Edit duty" : "Add duty"}
        </h2>
        <button
          type="button"
          onClick={() => dismiss()}
          aria-label="Close"
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-panel py-4 space-y-4">
        <FormSection title="Duty">
          <SettingsRow
            label="Date"
            value={date}
            onChange={setDate}
            type="date"
            required
            swipeToClear={false}
          />
          <SelectRow
            label="Type"
            value={dutyType}
            onValueChange={(v) => setDutyType(v as DutyType)}
            options={DUTY_TYPES}
          />
          <SettingsRow
            label="Code"
            value={dutyCode}
            onChange={setDutyCode}
            placeholder="BKUP"
            uppercase
            required
          />
          <SettingsRow
            label="Description"
            value={description}
            onChange={setDescription}
            placeholder="Backup standby"
          />
        </FormSection>

        {wantsWindow && (
          <FormSection title="Window (UTC)">
            <SettingsRow
              label="Start"
              value={start}
              onChange={setStart}
              placeholder="06:00"
              required
            />
            <SettingsRow
              label="End"
              value={end}
              onChange={setEnd}
              placeholder="18:00"
              description="An end earlier than the start means the next day."
              required
            />
          </FormSection>
        )}
      </div>

      <div
        className={cn(
          "flex items-center justify-end gap-2 px-4 h-16 flex-shrink-0 border-t border-border",
          !isDesktop && "pb-safe"
        )}
      >
        <Button variant="ghost" onClick={() => dismiss()}>
          Cancel
        </Button>
        <Button onClick={save} disabled={!canSave}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>,
    document.body
  );
}
