"use client";

/**
 * A roster duty opened from the LOGBOOK — the detail panel's half of a duty
 * card, beside the list on a tablet and as the overlay on a phone, the way a
 * flight opens.
 *
 * The selection is `duty:<id>` (an existing duty) or `duty:new:<date>` (a new
 * one, from the header's + → Duty). The panel reads the duties itself, so the
 * shell can render it from the selection alone, as it renders a flight's form.
 */

import { useCallback } from "react";
import { useScheduleEntries, refreshAllData } from "@/hooks/data";
import { useDetailPanel } from "@/hooks/use-detail-panel";
import { DutyDetailPanel } from "@/components/roster/duty-detail-panel";
import { PanelLoading, PanelMessage } from "@/components/ui/page-loading";
import { NEW_DUTY_PREFIX, dutyIdOf, dutyRowKey } from "@/lib/utils/logbook-rows";
import type { ScheduleEntry } from "@/types/entities/roster.types";

export function LogbookDutyPanel({ selection }: { selection: string }) {
  const { scheduleEntries, isLoading, refresh } = useScheduleEntries();
  const { setSelectedId } = useDetailPanel();

  const onSaved = useCallback(
    async (saved: ScheduleEntry) => {
      await refresh();
      // The FDP pipeline reads the duties, so the dashboard's caches follow.
      refreshAllData();
      setSelectedId(dutyRowKey(saved.id));
    },
    [refresh, setSelectedId]
  );

  if (selection.startsWith(NEW_DUTY_PREFIX)) {
    const date = selection.slice(NEW_DUTY_PREFIX.length) || undefined;
    return (
      <DutyDetailPanel
        key={selection}
        entry={null}
        defaultDate={date}
        onSaved={onSaved}
        onCancelNew={() => setSelectedId(null)}
      />
    );
  }

  const id = dutyIdOf(selection);
  const entry = scheduleEntries.find((e) => e.id === id && e.deletedAt == null);
  if (!entry) {
    if (isLoading) return <PanelLoading />;
    return (
      <PanelMessage
        title="Duty not found"
        description="It may have been deleted, or not synced to this device yet."
      />
    );
  }
  return <DutyDetailPanel key={entry.id} entry={entry} onSaved={onSaved} />;
}
