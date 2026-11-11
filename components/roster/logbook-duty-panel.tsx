"use client";

/**
 * A roster duty opened from the LOGBOOK — the detail panel's half of a duty
 * card, beside the list on a tablet and as the overlay on a phone, the way a
 * flight opens.
 *
 * The selection is one of:
 *
 * | | Opens |
 * |---|---|
 * | `duty:<id>` | the PERIOD the entry belongs to ("LOFF 12–15 Nov"), or the duty alone |
 * | `duty:day:<id>` | that ONE day of a period, so it can change without the others |
 * | `duty:new:<date>` | a new duty, from the header's + → Duty |
 *
 * The panel reads the duties itself, so the shell can render it from the
 * selection alone, as it renders a flight's form.
 */

import { useCallback, useMemo } from "react";
import { useScheduleEntries, refreshAllData } from "@/hooks/data";
import { useDetailPanel } from "@/hooks/use-detail-panel";
import { DutyDetailPanel } from "@/components/roster/duty-detail-panel";
import { PanelLoading, PanelMessage } from "@/components/ui/page-loading";
import { deleteScheduleEntry, restoreScheduleEntry } from "@/lib/db";
import { showUndoToast } from "@/lib/utils/undo-toast";
import { formatDay } from "@/lib/utils/date";
import {
  DUTY_DAY_PREFIX,
  NEW_DUTY_PREFIX,
  dutyDayKey,
  dutyIdOf,
  dutyRowKey,
  dutyRunOf,
  isRosterDuty,
} from "@/lib/utils/logbook-rows";
import type { ScheduleEntry } from "@/types/entities/roster.types";

const NONE: ScheduleEntry[] = [];

export function LogbookDutyPanel({ selection }: { selection: string }) {
  const { scheduleEntries, isLoading, refresh } = useScheduleEntries();
  const { setSelectedId } = useDetailPanel();
  const live = useMemo(() => scheduleEntries.filter(isRosterDuty), [scheduleEntries]);

  const onSaved = useCallback(
    async (firstId: string) => {
      await refresh();
      // The FDP pipeline reads the duties, so the dashboard's caches follow.
      refreshAllData();
      setSelectedId(dutyRowKey(firstId));
    },
    [refresh, setSelectedId]
  );

  const onOpenDay = useCallback((entry: ScheduleEntry) => setSelectedId(dutyDayKey(entry.id)), [setSelectedId]);

  const onRemoveDay = useCallback(
    async (entry: ScheduleEntry) => {
      await deleteScheduleEntry(entry.id);
      await refresh();
      refreshAllData();
      showUndoToast(`${entry.dutyCode || "Duty"} ${formatDay(entry.date, { weekday: false })} deleted`, async () => {
        await restoreScheduleEntry(entry.id);
        await refresh();
        refreshAllData();
      });
    },
    [refresh]
  );

  const isNew = selection.startsWith(NEW_DUTY_PREFIX);
  const oneDay = selection.startsWith(DUTY_DAY_PREFIX);
  const id = isNew ? null : oneDay ? selection.slice(DUTY_DAY_PREFIX.length) : dutyIdOf(selection);
  const entries = useMemo(() => {
    if (!id) return NONE;
    if (oneDay) {
      const entry = live.find((e) => e.id === id);
      return entry ? [entry] : NONE;
    }
    return dutyRunOf(id, live) ?? NONE;
  }, [id, oneDay, live]);

  if (isNew) {
    const date = selection.slice(NEW_DUTY_PREFIX.length) || undefined;
    return (
      <DutyDetailPanel
        key={selection}
        entries={NONE}
        all={live}
        defaultDate={date}
        onSaved={onSaved}
        onCancelNew={() => setSelectedId(null)}
      />
    );
  }

  if (entries.length === 0) {
    if (isLoading) return <PanelLoading />;
    return (
      <PanelMessage
        title="Duty not found"
        description="It may have been deleted, or not synced to this device yet."
      />
    );
  }
  // Keyed on the period's days, so a period that gained or lost one starts a
  // fresh draft over what it now is.
  return (
    <DutyDetailPanel
      key={`${oneDay ? "day" : "run"}:${entries.map((e) => e.id).join(",")}`}
      entries={entries}
      all={live}
      onSaved={onSaved}
      onOpenDay={onOpenDay}
      onRemoveDay={onRemoveDay}
    />
  );
}
