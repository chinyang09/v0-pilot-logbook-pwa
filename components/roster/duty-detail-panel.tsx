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
import { ChevronRight, Trash2 } from "lucide-react";

import { DateRow } from "@/components/ui/date-row";
import { DetailFormPanel } from "@/components/ui/detail-form-panel";
import { FormSection } from "@/components/ui/form-section";
import { TimeRow } from "@/components/ui/time-row";
import { SettingsRow, SelectRow } from "@/components/ui/settings-row";
import { SwipeableCard } from "@/components/swipeable-card";
import { useDraft } from "@/hooks/use-draft";
import { addScheduleEntry, deleteScheduleEntry, updateScheduleEntry } from "@/lib/db";
import type { DutyType, ScheduleEntry } from "@/types/entities/roster.types";
import { isValidHHMM } from "@/lib/utils/time";
import { formatDay, formatDayRange } from "@/lib/utils/date";
import { MAX_PERIOD_DAYS, daysBetween, planDutyPeriod } from "@/lib/utils/duty-period";

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
  from: string;
  to: string;
  dutyType: DutyType;
  dutyCode: string;
  description: string;
  start: string;
  end: string;
}

function fieldsOf(entries: readonly ScheduleEntry[], defaultDate?: string): DutyFields {
  const first = entries[0];
  const day = first?.date ?? defaultDate ?? todayUTC();
  return {
    from: day,
    to: entries[entries.length - 1]?.date ?? day,
    dutyType: first?.dutyType ?? "standby",
    dutyCode: first?.dutyCode ?? "",
    description: first?.dutyDescription ?? "",
    start: first?.reportTime ?? "",
    end: first?.debriefTime ?? "",
  };
}

/**
 * A duty, or a PERIOD of one — "LOFF 12–15 Nov" — from the first day to the
 * last. The roster stores a day per entry (see `lib/utils/duty-period.ts` for
 * why), and a run of the same whole-day duty is one card; this edits it as
 * the card shows it: From and To move its ends, the fields change every day
 * of it, and its DAYS are listed under it — tap one to change only that day,
 * swipe one to remove only that day.
 *
 * `entries` empty is a NEW duty from `defaultDate` (To may run it over
 * several days at once — a week of leave entered in one go). Key the panel on
 * the period's first id (or the day, for a new one), so a different duty
 * starts a fresh draft.
 */
export function DutyDetailPanel({
  entries,
  all,
  defaultDate,
  onSaved,
  onCancelNew,
  onOpenDay,
  onRemoveDay,
}: {
  /** The period being edited, in date order: its days, one, or none (new). */
  entries: readonly ScheduleEntry[];
  /** Every live roster duty, so a period grown into its neighbour adopts it. */
  all: readonly ScheduleEntry[];
  /** A new duty's date (YYYY-MM-DD) — the day it was added from. */
  defaultDate?: string;
  /** After a save, with the id of the entry on the period's first day. */
  onSaved: (firstId: string) => Promise<unknown> | void;
  /** New only: close the empty form. */
  onCancelNew?: () => void;
  /** Open ONE day of the period on its own. */
  onOpenDay?: (entry: ScheduleEntry) => void;
  /** Remove ONE day of the period (soft, with an Undo). */
  onRemoveDay?: (entry: ScheduleEntry) => void;
}) {
  const isNew = entries.length === 0;
  const base = useMemo(() => fieldsOf(entries, defaultDate), [entries, defaultDate]);
  const { values, set, reset, dirty } = useDraft(base);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { from, to, dutyType, dutyCode, description, start, end } = values;
  const wantsWindow = HAS_WINDOW.has(dutyType);
  const dayCount = daysBetween(from, to).length;

  // Why Save is unavailable, said out loud. The rows' placeholders ("BKUP",
  // "06:00", "18:00") read as filled-in values, so an unavailable Save with
  // no reason looked like the form was broken.
  const missing: string[] = [];
  if (!from) missing.push("a first day");
  if (!to || (from && to < from)) missing.push("a last day on or after the first");
  else if (dayCount > MAX_PERIOD_DAYS) missing.push(`a period of at most ${MAX_PERIOD_DAYS} days`);
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
      const fields = {
        dutyType,
        dutyCode: dutyCode.trim().toUpperCase(),
        dutyDescription: description.trim() || undefined,
        reportTime: wantsWindow ? start : undefined,
        debriefTime: wantsWindow ? end : undefined,
      };
      const plan = planDutyPeriod({ editing: entries, all, from, to, fields });
      let firstId = plan.firstId;
      for (const u of plan.updates) {
        if (!(await updateScheduleEntry(u.id, u.patch))) throw new Error("Duty not found");
      }
      for (const day of plan.creates) {
        const created = await addScheduleEntry({
          ...fields,
          date: day,
          timeReference: "UTC",
          sectors: [],
          crew: [],
          importedAt: Date.now(),
        });
        if (day === from) firstId = created.id;
      }
      for (const id of plan.deletes) await deleteScheduleEntry(id);
      if (!firstId) throw new Error("Nothing saved");
      await onSaved(firstId);
      reset();
    } catch (err) {
      console.error("[Roster] Saving duty failed:", err);
      setError("Couldn't save this duty. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const first = entries[0];
  const isPeriod = entries.length > 1;
  return (
    <DetailFormPanel
      title={isNew ? "New Duty" : first.dutyCode || "Duty"}
      description={isPeriod ? `${formatDayRange(base.from, base.to)} · ${entries.length} days` : undefined}
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
        <DateRow
          label="From"
          value={from}
          onChange={(v) => {
            set("from", v);
            // A period cannot end before it starts: moving From past To takes To along.
            if (to < v) set("to", v);
          }}
          required
        />
        <DateRow
          label="To"
          value={to}
          onChange={(v) => set("to", v)}
          description={dayCount > 1 ? `${dayCount} days` : undefined}
          required
        />
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
        <FormSection title={dayCount > 1 ? "Window Each Day (UTC)" : "Window (UTC)"}>
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

      {isPeriod && (
        // Each day of the period, as the roster stores it: tap one to change
        // that day alone (13 Nov's LOFF turned into a standby), swipe one to
        // remove it. Either leaves the rest of the period as it is.
        <FormSection title="Days">
          {entries.map((entry) => (
            <SwipeableCard
              key={entry.id}
              id={`duty-day-${entry.id}`}
              variant="row"
              separated
              actions={
                onRemoveDay
                  ? [
                      {
                        ariaLabel: `Remove ${formatDay(entry.date)}`,
                        icon: <Trash2 className="h-4 w-4" />,
                        variant: "destructive",
                        onClick: () => onRemoveDay(entry),
                      },
                    ]
                  : []
              }
            >
              <button
                type="button"
                onClick={() => onOpenDay?.(entry)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
              >
                <span className="min-w-0 flex-1 text-foreground">{formatDay(entry.date)}</span>
                <span className="text-muted-foreground">{entry.dutyCode}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </SwipeableCard>
          ))}
        </FormSection>
      )}
    </DetailFormPanel>
  );
}
