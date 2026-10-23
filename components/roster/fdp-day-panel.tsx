"use client"

/**
 * One DAY of the FDP timeline, in the detail panel — what the chart's tooltip
 * can only hint at: each duty's window, its FDP maximum and the table that set
 * it, the rest before it against what the schedule asks for, and the rolling
 * totals as at that day against their limits.
 *
 * Nothing here is computed: every figure is one `useFDPData` already holds
 * (`DutyPeriod`, `TimelineDataPoint`), so this is a READING of the pipeline,
 * never a second derivation of it — the FDP maximum in particular is printed
 * with the table beside it so it can be checked rather than trusted.
 */

import { DetailFormPanel } from "@/components/ui/detail-form-panel"
import { FormSection } from "@/components/ui/form-section"
import { ReadOnlyRow } from "@/components/ui/settings-row"
import { formatMinutesHM, formatYMDMedium } from "@/lib/utils/date"
import type { TimelineDataPoint } from "@/lib/utils/roster/fdp-calculator"
import type { DutyPeriod, FTLLimits, RestPeriodInfo } from "@/types/entities/roster.types"

/** The paragraph a rest rule comes from, as the Fifth Schedule numbers it. */
const REST_RULE: Record<RestPeriodInfo["rule"], string> = {
  "3a": "Para 3(1)(a)",
  "3b": "Para 3(1)(b)",
  "3c": "Para 3(1)(c)",
  "3d": "Para 3(1)(d)",
  "4a": "Para 4(1)(a)",
  "4b": "Para 4(2)",
}

const hm = (hours: number) => formatMinutesHM(Math.round(hours * 60))

function DutySection({ dp, index, count }: { dp: DutyPeriod; index: number; count: number }) {
  const standby = dp.dutyKind === "standby"
  const title = standby ? "Standby" : count > 1 ? `Duty ${index + 1}` : "Duty"
  return (
    <FormSection title={title}>
      {dp.route && <ReadOnlyRow label="Route" value={dp.route} />}
      <ReadOnlyRow label="Window" value={`${dp.reportTime} – ${dp.debriefTime}Z`} />
      <ReadOnlyRow label="Duty" value={formatMinutesHM(dp.dutyMinutes)} />
      {standby ? (
        <>
          {dp.countedDutyMinutes != null && (
            <ReadOnlyRow label="Counted toward limits" value={formatMinutesHM(dp.countedDutyMinutes)} />
          )}
          {dp.activatedAt && <ReadOnlyRow label="Activated" value={`${dp.activatedAt}Z`} />}
          {/* Standby is a duty period but not a FLIGHT duty period:
              paragraph 14's tables never applied to it. */}
          <ReadOnlyRow label="FDP maximum" value="Not an FDP" />
        </>
      ) : (
        <>
          <ReadOnlyRow label="Flight" value={formatMinutesHM(dp.flightMinutes)} />
          <ReadOnlyRow label="Sectors" value={String(dp.sectorCount)} />
          <ReadOnlyRow
            label="FDP maximum"
            value={
              dp.maxFdpMinutes > 0
                ? `${formatMinutesHM(dp.maxFdpMinutes)}${dp.fdpTableUsed ? ` · Table ${dp.fdpTableUsed}` : ""}`
                : "Not computed"
            }
          />
        </>
      )}
    </FormSection>
  )
}

export function FdpDayPanel({
  date,
  point,
  duties,
  limits,
}: {
  date: string
  /** The timeline's reading for the day — absent for a day off the chart. */
  point?: TimelineDataPoint
  /** The duty periods that START on this day. */
  duties: DutyPeriod[]
  limits: FTLLimits
}) {
  // Rest is attached to the FIRST duty of the day: it is the rest since the
  // duty before it.
  const rest = duties.find((dp) => dp.restBefore)?.restBefore

  return (
    <DetailFormPanel
      title={formatYMDMedium(date)}
      dirty={false}
      canSave={false}
      saving={false}
      onSave={() => {}}
      onCancel={() => {}}
    >
      {point?.isFuture && (
        <p className="px-1 text-sm text-muted-foreground">Planned — from the roster and scheduled times.</p>
      )}

      {duties.length === 0 ? (
        <FormSection title="Duty">
          <ReadOnlyRow label="Duty" value="None" />
        </FormSection>
      ) : (
        duties.map((dp, i) => <DutySection key={dp.id} dp={dp} index={i} count={duties.length} />)
      )}

      {rest && (
        <FormSection title="Rest before">
          <ReadOnlyRow label="Rest" value={formatMinutesHM(rest.restMinutes)} />
          <ReadOnlyRow label="Required" value={`${formatMinutesHM(rest.requiredRestMinutes)} · ${REST_RULE[rest.rule]}`} />
          <ReadOnlyRow label="Local night" value={rest.includesLocalNight ? "Included" : "Not included"} />
          <ReadOnlyRow
            label="Verdict"
            value={
              rest.compliant
                ? "Met"
                : `Short by ${formatMinutesHM(rest.requiredRestMinutes - rest.restMinutes)}`
            }
          />
        </FormSection>
      )}

      {point && (
        <FormSection title="Rolling, as at this day">
          <ReadOnlyRow label="Duty 14 days" value={`${hm(point.rolling14DayDuty)} of ${limits.maxDuty14Days}h`} />
          <ReadOnlyRow label="Duty 28 days" value={`${hm(point.rolling28DayDuty)} of ${limits.maxDuty28Days}h`} />
          <ReadOnlyRow label="Flight 28 days" value={`${hm(point.rolling28DayFlight)} of ${limits.maxFlight28Days}h`} />
          <ReadOnlyRow label="Flight 12 months" value={`${hm(point.rolling365DayFlight)} of ${limits.maxFlight365Days}h`} />
        </FormSection>
      )}
    </DetailFormPanel>
  )
}
