/**
 * The sun's answer for an imported sector's takeoffs and landings, set
 * against what the report recorded. A field is returned only where the two
 * differ — an absent suggestion means "the report already agrees".
 *
 * The pilot flying makes the takeoff AND the landing. eCrew now and then
 * records only one half of a sector (a T/O and no LDG on a leg that plainly
 * landed); the half it left out is still owed, so a PF sector's answer
 * always carries both.
 */
export interface ReportedToLdg {
  dayTakeoffs: number
  nightTakeoffs: number
  dayLandings: number
  nightLandings: number
}

export interface ToLdgSuggestion {
  suggestedDayTakeoffs?: number
  suggestedNightTakeoffs?: number
  suggestedDayLandings?: number
  suggestedNightLandings?: number
}

export function suggestToLdg(
  reported: ReportedToLdg,
  isPilotFlying: boolean,
  takeoffAtNight: boolean,
  landingAtNight: boolean
): ToLdgSuggestion {
  const out: ToLdgSuggestion = {}
  const reportedTO = reported.dayTakeoffs + reported.nightTakeoffs
  const reportedLDG = reported.dayLandings + reported.nightLandings
  const takeoffs = isPilotFlying ? Math.max(1, reportedTO) : reportedTO
  const landings = isPilotFlying ? Math.max(1, reportedLDG) : reportedLDG

  if (takeoffs > 0) {
    const day = takeoffAtNight ? 0 : takeoffs
    const night = takeoffAtNight ? takeoffs : 0
    if (day !== reported.dayTakeoffs || night !== reported.nightTakeoffs) {
      out.suggestedDayTakeoffs = day
      out.suggestedNightTakeoffs = night
    }
  }
  if (landings > 0) {
    const day = landingAtNight ? 0 : landings
    const night = landingAtNight ? landings : 0
    if (day !== reported.dayLandings || night !== reported.nightLandings) {
      out.suggestedDayLandings = day
      out.suggestedNightLandings = night
    }
  }
  return out
}
