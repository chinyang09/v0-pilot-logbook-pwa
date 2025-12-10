/**
 * Calculate solar position and determine if it's night time
 * Based on NOAA solar calculator algorithms
 * Uses civil twilight (sun 6 degrees below horizon) as per aviation standards
 */

interface SunTimes {
  sunrise: Date
  sunset: Date
  civilDawn: Date // Civil twilight start
  civilDusk: Date // Civil twilight end
}

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180)
}

/**
 * Convert radians to degrees
 */
function toDegrees(radians: number): number {
  return radians * (180 / Math.PI)
}

/**
 * Calculate the Julian Day from a date
 */
function getJulianDay(date: Date): number {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + 1
  const day = date.getUTCDate()
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600

  let jd = 367 * year - Math.floor((7 * (year + Math.floor((month + 9) / 12))) / 4)
  jd = jd - Math.floor((3 * (Math.floor((year + (month - 9) / 7) / 100) + 1)) / 4)
  jd = jd + Math.floor((275 * month) / 9) + day + 1721028.5 + hour / 24

  return jd
}

/**
 * Calculate sun times for a given date and location
 */
export function getSunTimes(date: Date, latitude: number, longitude: number): SunTimes {
  const jd = getJulianDay(date)
  const jc = (jd - 2451545) / 36525 // Julian Century

  // Solar calculations
  const geomMeanLongSun = (280.46646 + jc * (36000.76983 + 0.0003032 * jc)) % 360
  const geomMeanAnomSun = 357.52911 + jc * (35999.05029 - 0.0001537 * jc)
  const eccentEarthOrbit = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc)

  const sunEqOfCtr =
    Math.sin(toRadians(geomMeanAnomSun)) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(toRadians(2 * geomMeanAnomSun)) * (0.019993 - 0.000101 * jc) +
    Math.sin(toRadians(3 * geomMeanAnomSun)) * 0.000289

  const sunTrueLong = geomMeanLongSun + sunEqOfCtr
  const sunAppLong = sunTrueLong - 0.00569 - 0.00478 * Math.sin(toRadians(125.04 - 1934.136 * jc))

  const meanObliqEcliptic = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60
  const obliqCorr = meanObliqEcliptic + 0.00256 * Math.cos(toRadians(125.04 - 1934.136 * jc))

  const sunDeclin = toDegrees(Math.asin(Math.sin(toRadians(obliqCorr)) * Math.sin(toRadians(sunAppLong))))

  const varY = Math.tan(toRadians(obliqCorr / 2)) * Math.tan(toRadians(obliqCorr / 2))
  const eqOfTime =
    4 *
    toDegrees(
      varY * Math.sin(2 * toRadians(geomMeanLongSun)) -
        2 * eccentEarthOrbit * Math.sin(toRadians(geomMeanAnomSun)) +
        4 * eccentEarthOrbit * varY * Math.sin(toRadians(geomMeanAnomSun)) * Math.cos(2 * toRadians(geomMeanLongSun)) -
        0.5 * varY * varY * Math.sin(4 * toRadians(geomMeanLongSun)) -
        1.25 * eccentEarthOrbit * eccentEarthOrbit * Math.sin(2 * toRadians(geomMeanAnomSun)),
    )

  // Calculate hour angles for different sun positions
  const latRad = toRadians(latitude)
  const declinRad = toRadians(sunDeclin)

  // Sunrise/sunset (sun at horizon, -0.833 degrees for refraction)
  const haSunrise = toDegrees(
    Math.acos(
      Math.cos(toRadians(90.833)) / (Math.cos(latRad) * Math.cos(declinRad)) - Math.tan(latRad) * Math.tan(declinRad),
    ),
  )

  // Civil twilight (sun 6 degrees below horizon)
  const haCivilTwilight = toDegrees(
    Math.acos(
      Math.cos(toRadians(96)) / (Math.cos(latRad) * Math.cos(declinRad)) - Math.tan(latRad) * Math.tan(declinRad),
    ),
  )

  // Solar noon
  const solarNoon = (720 - 4 * longitude - eqOfTime) / 1440

  // Convert to times
  const baseDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))

  const sunriseTime = new Date(baseDate.getTime() + (solarNoon - haSunrise / 360) * 24 * 60 * 60 * 1000)
  const sunsetTime = new Date(baseDate.getTime() + (solarNoon + haSunrise / 360) * 24 * 60 * 60 * 1000)
  const civilDawn = new Date(baseDate.getTime() + (solarNoon - haCivilTwilight / 360) * 24 * 60 * 60 * 1000)
  const civilDusk = new Date(baseDate.getTime() + (solarNoon + haCivilTwilight / 360) * 24 * 60 * 60 * 1000)

  return {
    sunrise: sunriseTime,
    sunset: sunsetTime,
    civilDawn,
    civilDusk,
  }
}

/**
 * Check if a given time is during night (after civil dusk or before civil dawn)
 */
export function isNight(dateTime: Date, latitude: number, longitude: number): boolean {
  const sunTimes = getSunTimes(dateTime, latitude, longitude)
  return dateTime < sunTimes.civilDawn || dateTime > sunTimes.civilDusk
}

/**
 * Calculate night time between two UTC datetimes at two locations
 * Returns HH:MM format instead of decimal hours
 */
export function calculateNightTime(
  departureTime: Date,
  arrivalTime: Date,
  depLat: number,
  depLon: number,
  arrLat: number,
  arrLon: number,
): string {
  const totalMinutes = (arrivalTime.getTime() - departureTime.getTime()) / (1000 * 60)
  if (totalMinutes <= 0) return "00:00"

  // Sample every 5 minutes along the flight path (linear interpolation)
  const samples = Math.max(Math.ceil(totalMinutes / 5), 2)
  let nightMinutes = 0

  for (let i = 0; i < samples; i++) {
    const progress = i / (samples - 1)
    const sampleTime = new Date(departureTime.getTime() + progress * (arrivalTime.getTime() - departureTime.getTime()))

    // Linear interpolation of position (simplified great circle)
    const lat = depLat + progress * (arrLat - depLat)
    const lon = depLon + progress * (arrLon - depLon)

    if (isNight(sampleTime, lat, lon)) {
      nightMinutes += totalMinutes / samples
    }
  }

  const hours = Math.floor(nightMinutes / 60)
  const mins = Math.round(nightMinutes % 60)
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`
}

/**
 * Calculate block time and flight time from OOOI times
 * Returns times in HH:MM format instead of decimal
 */
export function calculateTimesFromOOOI(
  outTime: string,
  offTime: string,
  onTime: string,
  inTime: string,
  date: string,
): { blockTime: string; flightTime: string } {
  const baseDate = date

  const parseTime = (time: string): Date => {
    const [hours, minutes] = time.split(":").map(Number)
    const dt = new Date(baseDate)
    dt.setUTCHours(hours, minutes, 0, 0)
    return dt
  }

  const out = parseTime(outTime)
  const off = parseTime(offTime)
  const on = parseTime(onTime)
  const inGate = parseTime(inTime)

  // Handle overnight flights
  if (off < out) off.setUTCDate(off.getUTCDate() + 1)
  if (on < off) on.setUTCDate(on.getUTCDate() + 1)
  if (inGate < on) inGate.setUTCDate(inGate.getUTCDate() + 1)

  const blockMinutes = (inGate.getTime() - out.getTime()) / (1000 * 60)
  const flightMinutes = (on.getTime() - off.getTime()) / (1000 * 60)

  const formatMinutesToHHMM = (minutes: number): string => {
    const hours = Math.floor(minutes / 60)
    const mins = Math.round(minutes % 60)
    return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`
  }

  return {
    blockTime: formatMinutesToHHMM(blockMinutes),
    flightTime: formatMinutesToHHMM(flightMinutes),
  }
}
