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

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DateRow } from "@/components/ui/date-row";
import { FormSection } from "@/components/ui/form-section";
import { RegionSheet } from "@/components/ui/region-sheet";
import { TimeRow } from "@/components/ui/time-row";
import { SettingsRow, SelectRow } from "@/components/ui/settings-row";
import { useBackDismiss } from "@/hooks/use-back-dismiss";
import { addScheduleEntry, updateScheduleEntry } from "@/lib/db";
import type { DutyType, ScheduleEntry } from "@/types/entities/roster.types";
import { isValidHHMM } from "@/lib/utils/time";

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
  defaultDate,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** The duty being edited, or null to add a new one. */
  entry: ScheduleEntry | null;
  /** A new duty's date (YYYY-MM-DD) — the day selected on the roster. */
  defaultDate?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dismiss = useBackDismiss(open, onClose);

  // Seeded from the entry by `useState` initialisers, and re-seeded by the
  // `key` on this component rather than by an effect. An effect that writes
  // form state is a cascading render, and keying it on the entry object would
  // clobber an edit in progress every time a sync write handed back a fresh
  // row; keying the COMPONENT on the id gets the initialisation for free.
  const [date, setDate] = useState(() => entry?.date ?? defaultDate ?? todayUTC());
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

  const wantsWindow = HAS_WINDOW.has(dutyType);
  const timesValid =
    !wantsWindow || (isValidHHMM(start) && isValidHHMM(end) && start !== end);
  const canSave = Boolean(date) && Boolean(dutyCode.trim()) && timesValid && !saving;

  // Why Save is disabled, said out loud. The rows' placeholders ("BKUP",
  // "06:00", "18:00") read as filled-in values, so a disabled Save with no
  // reason looked like the dialog was broken.
  const missing: string[] = [];
  if (!date) missing.push("a date");
  if (!dutyCode.trim()) missing.push("a code");
  if (wantsWindow) {
    if (!isValidHHMM(start)) missing.push("a start time");
    if (!isValidHHMM(end)) missing.push("an end time");
    else if (isValidHHMM(start) && start === end) missing.push("an end time different from the start");
  }
  const blockedReason = missing.length
    ? `Needs ${missing.length > 1 ? missing.slice(0, -1).join(", ") + " and " + missing[missing.length - 1] : missing[0]}`
    : null;

  if (!open) return null;

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

  return (
    <RegionSheet
      titleId="duty-dialog-title"
      title={entry ? "Edit duty" : "Add duty"}
      onDismiss={dismiss}
      footer={
        <>
          {blockedReason && (
            <p className="mr-auto min-w-0 text-xs text-muted-foreground" role="status">
              {blockedReason}
            </p>
          )}
          <Button variant="ghost" onClick={() => dismiss()}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
        <FormSection title="Duty">
          <DateRow label="Date" value={date} onChange={setDate} required />
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
            <TimeRow label="Start" value={start} onChange={setStart} required />
            <TimeRow
              label="End"
              value={end}
              onChange={setEnd}
              description="An end earlier than the start means the next day."
              required
            />
          </FormSection>
        )}
    </RegionSheet>
  );
}
