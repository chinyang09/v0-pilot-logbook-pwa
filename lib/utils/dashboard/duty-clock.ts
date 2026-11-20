/**
 * The DUTY & FDP tile's timeline (the owner, Nov 2026: "use the timeline for
 * flight and crew on the FDP/duty widget … it should be tracking FDP … we
 * also depict the max FDP on the timeline"). One strip in time carrying, in
 * order:
 *
 * | | From | To | Drawn |
 * |---|---|---|---|
 * | rest | rest commenced | the report | solid to where the minimum is met, then lighter; a report inside the minimum is red from it to legal |
 * | duty | report | off duty | a track; the FDP darker inside it to the last on-blocks; each leg filled |
 * | max FDP | the FDP's start | its Reg 14 maximum | a dotted outline, and a mark at its end |
 *
 * Pure, on instants, so the window and its ticks are tested without the page.
 */

const H = 3_600_000

export interface DutyClockInput {
  nowMs: number
  /** The rest before the duty: when it commenced and when its minimum was met. */
  rest: { startMs: number; legalMs: number } | null
  duty: {
    reportMs: number
    /** Where the FDP opened — before the report under para 10(b). */
    fdpStartMs: number
    /** The last on-blocks, planned or flown. */
    fdpEndMs: number
    /** Free of all duties. */
    endMs: number
    /** Its Reg 14 maximum, minutes; 0 when it carries none. */
    maxFdpMinutes: number
  } | null
  legs: Array<{ departMs: number | null; arriveMs: number | null; flown: boolean }>
}

export interface DutyClock {
  nowMs: number
  fromMs: number
  toMs: number
  /** The tick every this many hours; a label every `labelEvery` of them. */
  tickHours: number
  labelHours: number
  rest: { startMs: number; legalMs: number; endMs: number; short: boolean } | null
  duty: (NonNullable<DutyClockInput["duty"]> & { maxEndMs: number | null }) | null
  legs: DutyClockInput["legs"]
}

/** How far back a long rest is drawn: its last part is what matters to the report. */
const REST_SHOWN_H = 16

export function dutyClock(input: DutyClockInput): DutyClock | null {
  const { duty, rest, nowMs } = input
  if (!duty && !rest) return null
  const maxEndMs = duty && duty.maxFdpMinutes > 0 ? duty.fdpStartMs + duty.maxFdpMinutes * 60_000 : null
  const anchor = duty?.reportMs ?? rest!.legalMs
  // From the rest's start (or the last REST_SHOWN_H hours of it), else two
  // hours before the report; to an hour past whichever ends last.
  const start = rest ? Math.max(rest.startMs, anchor - REST_SHOWN_H * H) : anchor - 2 * H
  const ends = [duty?.endMs ?? 0, maxEndMs ?? 0, rest?.legalMs ?? 0, anchor]
  // Now in view when it is close: on duty, or the rest still running.
  if (nowMs > start - 2 * H && nowMs < Math.max(...ends) + 2 * H) ends.push(nowMs)
  const end = Math.max(...ends) + H
  const fromMs = Math.floor(Math.min(start, nowMs > start - 2 * H && nowMs < end ? nowMs : start) / H) * H
  const toMs = Math.ceil(end / H) * H
  const spanH = (toMs - fromMs) / H
  return {
    nowMs,
    fromMs,
    toMs,
    tickHours: spanH <= 30 ? 1 : 3,
    labelHours: spanH <= 18 ? 3 : spanH <= 36 ? 6 : 12,
    rest:
      rest && duty
        ? { startMs: rest.startMs, legalMs: rest.legalMs, endMs: duty.reportMs, short: duty.reportMs < rest.legalMs }
        : rest
          ? { startMs: rest.startMs, legalMs: rest.legalMs, endMs: rest.legalMs, short: false }
          : null,
    duty: duty ? { ...duty, maxEndMs } : null,
    legs: input.legs,
  }
}

/** The ticks between `fromMs` and `toMs`: each `tickHours` on the hour, a label every `labelHours`. */
export function clockTicks(c: Pick<DutyClock, "fromMs" | "toMs" | "tickHours" | "labelHours">, hourOf: (ms: number) => number) {
  const out: Array<{ ms: number; major: boolean; label: string | null }> = []
  for (let ms = c.fromMs; ms <= c.toMs; ms += H) {
    const h = hourOf(ms)
    if (h % c.tickHours !== 0) continue
    const labelled = h % c.labelHours === 0
    out.push({ ms, major: labelled, label: labelled ? String(h).padStart(2, "0") : null })
  }
  return out
}
