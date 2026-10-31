"use client";

/**
 * A roster duty, added or edited by hand, in the DETAIL panel.
 *
 * The roster is otherwise import-only, which meant a standby the company
 * phoned through — or one the report got wrong — could not be recorded at all.
 * Flights need no equivalent: the logbook has always taken a new entry.
 *
 * Tapping a duty opens it beside the month on a tablet and as the full-screen
 * detail overlay on a phone, the way a flight opens in the logbook. It used to
 * be a sheet over the whole content region, which covered the roster it was
 * chosen from.
 *
 * The form holds a DRAFT (`useDraft`): only what the pilot has changed, over
 * the live record, so a pull landing while it is open moves every field they
 * have not touched.
 */

import { useMemo, useState } from "react";

import { DateRow } from "@/components/ui/date-row";
import { DetailFormPanel } from "@/components/ui/detail-form-panel";
import { FormSection } from "@/components/ui/form-section";
import { TimeRow } from "@/components/ui/time-row";
import { SettingsRow, SelectRow } from "@/components/ui/settings-row";
import { useDraft } from "@/hooks/use-draft";
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
  { value: "ground", label: "Ground Duty" },
  { value: "positioning", label: "Positioning" },
  { value: "leave", label: "Leave" },
  { value: "off", label: "Day Off" },
];

/** Kinds that occupy a window of the day rather than the whole of it. */
const HAS_WINDOW = new Set<DutyType>([
  "standby",
  "training",
  "ground",
  "positioning",
]);

const todayUTC = () => new Date().toISOString().slice(0, 10);

interface DutyFields {
  date: string;
  dutyType: DutyType;
  dutyCode: string;
  description: string;
  start: string;
  end: string;
}

function fieldsOf(entry: ScheduleEntry | null, defaultDate?: string): DutyFields {
  return {
    date: entry?.date ?? defaultDate ?? todayUTC(),
    dutyType: entry?.dutyType ?? "standby",
    dutyCode: entry?.dutyCode ?? "",
    description: entry?.dutyDescription ?? "",
    start: entry?.reportTime ?? "",
    end: entry?.debriefTime ?? "",
  };
}

/**
 * `entry` null is a NEW duty on `defaultDate`. Key the panel on the entry's id
 * (or the day, for a new one), so a different duty starts a fresh draft.
 */
export function DutyDetailPanel({
  entry,
  defaultDate,
  onSaved,
  onCancelNew,
}: {
  entry: ScheduleEntry | null;
  /** A new duty's date (YYYY-MM-DD) — the day it was added from. */
  defaultDate?: string;
  /** After a save; resolves once the page has the stored row back. */
  onSaved: (saved: ScheduleEntry) => Promise<unknown> | void;
  /** New only: close the empty form. */
  onCancelNew?: () => void;
}) {
  const isNew = !entry;
  const base = useMemo(() => fieldsOf(entry, defaultDate), [entry, defaultDate]);
  const { values, set, reset, dirty } = useDraft(base);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { date, dutyType, dutyCode, description, start, end } = values;
  const wantsWindow = HAS_WINDOW.has(dutyType);

  // Why Save is unavailable, said out loud. The rows' placeholders ("BKUP",
  // "06:00", "18:00") read as filled-in values, so an unavailable Save with
  // no reason looked like the form was broken.
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

  const save = async () => {
    if (blockedReason || saving) return;
    setSaving(true);
    setError(null);
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
      const saved = entry
        ? await updateScheduleEntry(entry.id, payload)
        : await addScheduleEntry({ ...payload, sectors: [], crew: [], importedAt: Date.now() });
      if (!saved) throw new Error("Duty not found");
      await onSaved(saved);
      reset();
    } catch (err) {
      console.error("[Roster] Saving duty failed:", err);
      setError("Couldn't save this duty. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DetailFormPanel
      title={isNew ? "New Duty" : entry.dutyCode || "Duty"}
      dirty={isNew || dirty}
      canSave={!blockedReason}
      saving={saving}
      status={blockedReason}
      error={error}
      onSave={save}
      onCancel={() => {
        setError(null);
        if (isNew) onCancelNew?.();
        else reset();
      }}
    >
      <FormSection title="Duty">
        <DateRow label="Date" value={date} onChange={(v) => set("date", v)} required />
        <SelectRow
          label="Type"
          value={dutyType}
          onValueChange={(v) => set("dutyType", v as DutyType)}
          options={DUTY_TYPES}
        />
        <SettingsRow
          label="Code"
          value={dutyCode}
          onChange={(v) => set("dutyCode", v)}
          placeholder="BKUP"
          uppercase
          required
        />
        <SettingsRow
          label="Description"
          value={description}
          onChange={(v) => set("description", v)}
          placeholder="Backup standby"
        />
      </FormSection>

      {wantsWindow && (
        <FormSection title="Window (UTC)">
          <TimeRow label="Start" value={start} onChange={(v) => set("start", v)} required />
          <TimeRow
            label="End"
            value={end}
            onChange={(v) => set("end", v)}
            description="Before the start means the next day."
            required
          />
        </FormSection>
      )}
    </DetailFormPanel>
  );
}
