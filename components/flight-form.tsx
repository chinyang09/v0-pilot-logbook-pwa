"use client";

import { CODE_INPUT_PROPS } from "@/lib/utils/input-props";
import type React from "react";
import { ScrollIndicator } from "@/components/ui/scroll-indicator";

import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, useId } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { userDb } from "@/lib/db/user-db";
import {
  ChevronDown,
  ChevronRight,
  Plane,
  PlaneTakeoff,
  PlaneLanding,
  User,
  ArrowLeftRight,
  Plus,
  Minus,
  Trash2,
  PenLine,
} from "lucide-react";
import { mutate } from "swr";
import { CACHE_KEYS } from "@/hooks/data";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { TimePicker } from "@/components/time-picker";
import { DatePicker } from "@/components/date-picker";
import type { FlightLog, AdditionalCrew, Approach, FlightSignature } from "@/lib/db";
import { type SignatureCrewMember } from "@/components/signature-canvas";
import { SignatureDialog } from "@/components/signature-dialog";
import {
  updateFlight,
  updatePersonnel,
  getFlightById,
  isLiveFlight,
  getAirportTimeInfo,
} from "@/lib/db";
import { useDebounce } from "@/hooks/use-debounce";
import { formPatch, rebaseForm } from "@/lib/utils/form-patch";
import { insertFlightSorted } from "@/lib/utils/flight-sort";
import { pickSelfCard } from "@/lib/utils/self-card";
import { useAirportByIcao, prefetchAirports } from "@/hooks/data";
import {
  createEmptyFlightLog,
  calculateBlockTime,
  calculateFlightTime,
  airborneTimes,
  calculateDayTime,
  calculateTakeoffsLandings,
  calculateRoleTimes,
  getApproachCategory,
  hasCoordinates,
} from "@/lib/utils/flight-calculations";
import { inferPilotFlying, inferPilotRole } from "@/lib/utils/flight-evidence";
import { calculateNightTimeComplete } from "@/lib/utils/night-time";
import {
  formatClockDisplay,
  formatTimeShort,
  utcToLocal,
  formatTimezoneOffset,
  getCurrentTimeUTC,
  isValidHHMM,
  hhmmToMinutes,
  minutesToHHMM,
} from "@/lib/utils/time";
import { usePersonnel } from "@/hooks/data";
import { nonPicPfRoleOf, reconcilePilotRole, withLoggingPreferences } from "@/lib/utils/roster/pilot-role";
import { usePreferences } from "@/components/providers/preferences-provider";
import { ImageImportButton } from "@/components/image-import-button";
import { GlassContainer } from "@/components/ui/glass-container";
import { SwipeableCard } from "@/components/swipeable-card";
import { useRegisterDetailActions } from "@/hooks/use-page-actions";
import { cn } from "@/lib/utils";
import {
  ENTRY_TYPES,
  entryTypePatch,
  getEntryType,
  withoutSimulatorPins,
} from "@/lib/utils/entry-type";
import type { EntryType } from "@/types/entities/flight.types";
import type { DisplayPreferences } from "@/types/db/stores.types";
import type { ExtractedFlightData } from "@/lib/ocr";

// Swipeable row — thin wrapper over the shared SwipeableCard primitive so the
// flight form gets the same growing/spring swipe-to-reveal used across the app.
function SwipeableRow({
  children,
  onClear,
}: {
  children: React.ReactNode;
  onClear: () => void;
}) {
  return (
    <SwipeableCard
      variant="row"
      separated
      actions={[{ label: "Clear", onClick: onClear, variant: "destructive" }]}
    >
      {children}
    </SwipeableCard>
  );
}

function SettingsRow({
  label,
  value,
  placeholder,
  onClick,
  showChevron = false,
  icon,
  children,
}: {
  label: string;
  value?: string;
  placeholder?: string;
  onClick?: () => void;
  showChevron?: boolean;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-center justify-between py-3.5 px-4 row-divider ${
        onClick ? "cursor-pointer active:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2" : ""
      }`}
      {...(onClick ? pressableRow(onClick, `${label}, ${value || placeholder || "not set"}`) : {})}
    >
      <span className="text-foreground">{label}</span>
      <div className="flex items-center gap-2">
        {children || (
          <span className={value ? "text-foreground" : "text-muted-foreground"}>
            {value || placeholder || "-"}
          </span>
        )}
        {icon && <span className="text-muted-foreground">{icon}</span>}
        {showChevron && (
          <ChevronRight className="h-5 w-5 text-muted-foreground/50" />
        )}
      </div>
    </div>
  );
}

/** Size a textarea to its content (no `field-sizing`: one engine lacks it). */
function fitTextarea(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}
/**
 * Stable, so it runs on mount rather than on every render of the form.
 *
 * The first fit waits for a ResizeObserver callback. Reading `scrollHeight`
 * straight from the ref ran in the middle of React's commit, so it forced a
 * synchronous layout of the whole app for one textarea (~90ms of the tap that
 * opens a flight, at a 4× CPU throttle) — and the rest of the commit then
 * dirtied it again. An observer fires after the browser's own layout and
 * before paint, so the read is free and the fitted height still lands in the
 * first frame.
 */
const fitTextareaRef = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  const ro = new ResizeObserver(() => {
    ro.disconnect();
    fitTextarea(el);
  });
  ro.observe(el);
};

/** Fields only ever written straight to the database, by the pickers. */
const PICKER_FIELDS: ReadonlySet<string> = new Set([
  "aircraftReg", "aircraftType",
  "departureIcao", "departureIata", "arrivalIcao", "arrivalIata",
  "picId", "picName", "sicId", "sicName",
]);

// Caches the last-known data for each flight at module scope so the form can
// seed its initial state synchronously when it re-mounts (e.g. when switching
// back to the logbook from another section). Without this, the form mounts with
// empty data while useLiveQuery resolves asynchronously, briefly showing blank
// times before snapping to the real values. Cleared when the PWA is closed.
const flightDataCache = new Map<string, FlightLog>();

/**
 * Seed the cache before the panel mounts.
 *
 * The form holds its first render until `useLiveQuery` resolves, so opening a
 * flight for the FIRST time showed the empty panel for a beat — the cache was
 * only ever written from inside the form, which is too late to help the open
 * that populates it. A list already has the whole flight object in hand, so it
 * can hand it over on the way in and the panel paints immediately. Re-opening
 * was always instant; this makes the first time match.
 */
export function primeFlightCache(flight: FlightLog): void {
  flightDataCache.set(flight.id, flight);
  // Its two airports too, so the timezones are there on the first render.
  prefetchAirports(flight.departureIcao, flight.arrivalIcao);
}

/**
 * What a tap-to-edit row needs to be a CONTROL rather than a painted div: a
 * button role, a tab stop, Enter/Space, and a name read as "Out, 08:49". They
 * were bare `div onClick`s, so VoiceOver did not announce them and an iPad
 * keyboard could not reach Date, Aircraft, the airports, the crew or any of
 * the OOOI times.
 */
function pressableRow(onActivate: () => void, name: string) {
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": name,
    onClick: onActivate,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate();
      }
    },
  };
}

// Time row with UTC and Local display
function TimeRow({
  label,
  utcValue,
  timezoneOffset,
  onTap,
  onNow,
  showNow = true,
  clockSeparator = "colon",
  derivedValue,
}: {
  label: string;
  utcValue: string;
  timezoneOffset: number;
  onTap: () => void;
  onNow?: () => void;
  showNow?: boolean;
  clockSeparator?: DisplayPreferences["clockSeparator"];
  /**
   * What the row falls back to when nothing has been entered — shown muted, in
   * place of `--:--`, so the value actually in force is visible rather than
   * looking like a blank the pilot has to fill.
   */
  derivedValue?: string;
}) {
  const localValue = utcToLocal(utcValue, timezoneOffset);
  const tzLabel = formatTimezoneOffset(timezoneOffset);
  const hasValue = isValidHHMM(utcValue);
  const hasDerived = !hasValue && isValidHHMM(derivedValue || "");

  const shown = hasValue ? utcValue : hasDerived ? derivedValue! : "not set";
  return (
    // The WHOLE row opens the picker — it was only the time column, so a tap
    // on "Out" itself did nothing.
    <div
      className="flex items-center justify-between py-3.5 px-4 row-divider cursor-pointer focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
      {...pressableRow(onTap, `${label}, ${shown} UTC`)}
    >
      <span className="text-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-end">
          <span
            className={`text-lg ${
              hasValue ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            {hasValue
              ? formatClockDisplay(utcValue, clockSeparator)
              : hasDerived
                ? formatClockDisplay(derivedValue!, clockSeparator)
                : formatClockDisplay("--:--", clockSeparator, "--:--")}
          </span>
          <span className="text-xs text-muted-foreground">UTC</span>
        </div>
        <div className="flex flex-col items-end">
          {showNow && !hasValue ? (
            <Button
              variant="outline"
              size="sm"
              aria-label={`${label} now`}
              className="h-9 min-w-11 px-2 text-xs border-primary text-primary bg-transparent"
              onClick={(e) => {
                e.stopPropagation();
                onNow?.();
              }}
              onKeyDown={(e) => e.stopPropagation()}
            >
              NOW
            </Button>
          ) : (
            <>
              <span
                className={`text-lg ${
                  hasValue ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {hasValue
                  ? formatClockDisplay(localValue, clockSeparator)
                  : "--:--"}
              </span>
              <span className="text-xs text-muted-foreground">{tzLabel}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Time display row for calculated values
function TimeDisplayRow({
  label,
  value,
  secondaryLabel,
  secondaryValue,
  onUse,
  useLabel,
  showUseButton = false,
}: {
  label: string;
  value: string;
  secondaryLabel?: string;
  secondaryValue?: string;
  onUse?: () => void;
  useLabel?: string;
  showUseButton?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-3.5 px-4 row-divider">
      <span className="text-foreground">{label}</span>
      <div className="flex items-center gap-4">
        {secondaryLabel && secondaryValue ? (
          <>
            <span className="text-foreground">{formatTimeShort(value)}</span>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">
                {secondaryLabel}
              </span>
              <span className="text-foreground">
                {formatTimeShort(secondaryValue)}
              </span>
            </div>
          </>
        ) : showUseButton && onUse ? (
          <Button
            variant="outline"
            size="sm"
            className="h-9 min-w-11 px-2 text-xs border-primary text-primary bg-transparent"
            onClick={onUse}
          >
            {useLabel || "USE"}
          </Button>
        ) : (
          <span className="text-foreground">{formatTimeShort(value)}</span>
        )}
      </div>
    </div>
  );
}

// Number row for counts
function NumberRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3.5 px-4 row-divider">
      <span className="text-foreground">{label}</span>
      <div className="flex items-center gap-3">
        {/* Icons, not "-" and "+" typed as text: a hyphen is a hairline next
            to a plus, so the two buttons looked unequal. 36px, a thumb's
            target in a row that is tapped repeatedly. */}
        <Button
          variant="outline"
          size="icon"
          aria-label={`Decrease ${label}`}
          className="h-9 w-9 rounded-full bg-transparent"
          disabled={value <= 0}
          onClick={() => onChange(Math.max(0, value - 1))}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <span className="text-foreground w-6 text-center tabular-nums">{value}</span>
        <Button
          variant="outline"
          size="icon"
          aria-label={`Increase ${label}`}
          className="h-9 w-9 rounded-full bg-transparent"
          onClick={() => onChange(value + 1)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// Toggle row
function ToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3.5 px-4 row-divider">
      <span className="text-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  );
}

interface FlightFormProps {
  onFlightAdded: (flight: FlightLog) => void;
  onClose: () => void;
  editingFlight?: FlightLog | null;
  /** When provided, the form loads data from Dexie via useLiveQuery */
  flightId?: string;
  /** If true, picker navigation uses main panel instead of full-page navigation */
  isDesktop?: boolean;
}

export function FlightForm({
  onFlightAdded,
  onClose,
  editingFlight,
  flightId: flightIdProp,
  isDesktop = false,
}: FlightFormProps) {
  const router = useRouter();
  const { personnel } = usePersonnel();
  const { preferences } = usePreferences();
  const clockSeparator = preferences.display.clockSeparator;
  const [, setIsSubmitting] = useState(false);
  const [activeTimePicker, setActiveTimePicker] = useState<string | null>(null);
  const [signatureOpen, setSignatureOpen] = useState(false);

  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const editingFlightInitializedRef = useRef<string | null>(null);

  // Scroll position preservation across picker navigation
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // --- useLiveQuery for reactive flight data (both desktop and mobile) ---
  // `undefined` while the query is in flight, `null` once it has answered
  // "no such row" — the two used to read the same, so a flight id that is not
  // on this device left the panel blank forever.
  const liveFlight = useLiveQuery(
    async () => (flightIdProp ? (await userDb.flights.get(flightIdProp)) ?? null : undefined),
    [flightIdProp]
  );

  // Resolve which flight data to use
  const resolvedFlight = editingFlight || liveFlight || null;

  // Synchronous fallback for the first render after a re-mount, before
  // useLiveQuery has resolved. Avoids the blank-then-populate flicker.
  const cachedFlight = flightIdProp ? flightDataCache.get(flightIdProp) ?? null : null;

  // Initialize form data from resolvedFlight (draft or existing flight)
  const [formData, setFormData] = useState<Partial<FlightLog>>(() => {
    if (resolvedFlight) {
      editingFlightInitializedRef.current = resolvedFlight.id;
      return resolvedFlight;
    }
    // Seed from cache for an instant first paint. Leave editingFlightInitializedRef
    // unset so the resolvedFlight effect still reconciles with live data once it loads.
    if (cachedFlight) {
      return cachedFlight;
    }
    return createEmptyFlightLog();
  });
  // The signature section starts open on a signed flight, as the accordion did.
  const [signatureSectionOpen, setSignatureSectionOpen] = useState(() => !!formData.signature);
  const signatureSectionId = useId();
  // The latest form state, for effects that must not re-run on every keystroke.
  const formDataRef = useRef(formData);
  useLayoutEffect(() => {
    formDataRef.current = formData;
  }, [formData]);
  const baselineRef = useRef<Partial<FlightLog> | null>(null);
  const baselineOverridesRef = useRef<FlightLog["manualOverrides"]>(undefined);

  // Track manual overrides state
  const [manualOverrides, setManualOverrides] = useState<
    FlightLog["manualOverrides"]
  >(resolvedFlight?.manualOverrides || cachedFlight?.manualOverrides || {});

  // Keep the module cache current so the next re-mount can seed synchronously.
  useEffect(() => {
    if (liveFlight) flightDataCache.set(liveFlight.id, liveFlight);
  }, [liveFlight]);

  // Inside FlightForm component...

  // Get airport data
  // The two airports this flight names — looked up by ICAO, not by loading the
  // whole ~29k-row table to find them (see `useAirportByIcao`).
  const depLookup = useAirportByIcao(formData.departureIcao);
  const arrLookup = useAirportByIcao(formData.arrivalIcao);
  const depAirport = depLookup ?? null;
  const arrAirport = arrLookup ?? null;
  // An airport still being LOOKED UP is not a missing one. Computed against the
  // gap, night time and the takeoffs/landings came out as zeros, and if the
  // lookup was slow enough those zeros were what the form saved.
  const airportsPending =
    (!!formData.departureIcao && depLookup === undefined) ||
    (!!formData.arrivalIcao && arrLookup === undefined);

  // Helper to get numeric offset from IANA string
  const getNumericOffset = (tzString?: string) =>
    tzString ? getAirportTimeInfo(tzString).offset : 0;

  // Replace your old timezone constants with these dynamic ones
  const depTimezone = useMemo(
    () => getNumericOffset(depAirport?.tz),
    [depAirport]
  );
  const arrTimezone = useMemo(
    () => getNumericOffset(arrAirport?.tz),
    [arrAirport]
  );
  // Tracks the flight currently loaded into the form. The instant-swap handling
  // when this changes lives in a useLayoutEffect defined after forceSave (below),
  // so it can flush the outgoing flight before swapping.
  const prevFlightIdRef = useRef(flightIdProp);

  // Update form data when resolvedFlight changes (e.g., after refresh or live query)
  useEffect(() => {
    if (!resolvedFlight) return;
    if (editingFlightInitializedRef.current === resolvedFlight.id) return;

    editingFlightInitializedRef.current = resolvedFlight.id;
    setFormData(resolvedFlight);
    setManualOverrides(resolvedFlight.manualOverrides || {});
    // Re-init only on flight identity change. Depending on the full
    // resolvedFlight would re-run on every reactive useLiveQuery write and
    // clobber the user's in-progress edits (manualOverrides protection).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedFlight?.id]);

  // --- Follow the row underneath the form (picker writes AND sync pulls) ---
  // Every field the database changed is adopted unless the user has changed
  // it here since the baseline (see `lib/utils/form-patch.ts`). Following only
  // the picker fields left the rest of the copy stale after a pull, and the
  // next auto-save sent that stale copy back — reverting another device's
  // OOOI times, signature and lock without anyone touching this form.
  const prevLiveFlightRef = useRef<FlightLog | undefined>(undefined);
  useEffect(() => {
    if (!liveFlight || !flightIdProp) return;

    // First load: already handled by initialization or the effect above
    const previous = prevLiveFlightRef.current;
    prevLiveFlightRef.current = liveFlight;
    if (!previous || previous.id !== liveFlight.id) return;
    // The baseline is taken on the first debounced state; until then the form
    // still IS the row it loaded, so only the pickers need following.
    const baseline = baselineRef.current?.id === liveFlight.id ? baselineRef.current : null;

    const current = formDataRef.current;
    if (current.id !== liveFlight.id) return;
    const next = rebaseForm<FlightLog>({
      form: current,
      baseline: baseline ?? current,
      previous,
      live: liveFlight,
      alwaysAdopt: PICKER_FIELDS,
    });
    if (next.adopted.length === 0) return;
    if (baseline) baselineRef.current = next.baseline;
    setFormData(next.form);
  }, [liveFlight, flightIdProp]);

  useEffect(() => {
    if (!depAirport && !arrAirport) return;

    setFormData((prev) => {
      const updated = { ...prev };
      let changed = false;

      if (prev.departureIcao) {
        const airport =
          depAirport?.icao.toUpperCase() === prev.departureIcao.toUpperCase() ? depAirport : null;
        if (
          airport &&
          (!prev.departureIata || prev.departureTimezone === undefined)
        ) {
          updated.departureIata = airport.iata || "";
          updated.departureTimezone = getNumericOffset(airport.tz);
          changed = true;
        }
      }

      if (prev.arrivalIcao) {
        const airport =
          arrAirport?.icao.toUpperCase() === prev.arrivalIcao.toUpperCase() ? arrAirport : null;
        if (
          airport &&
          (!prev.arrivalIata || prev.arrivalTimezone === undefined)
        ) {
          updated.arrivalIata = airport.iata || "";
          updated.arrivalTimezone = getNumericOffset(airport.tz);
          changed = true;
        }
      }

      return changed ? updated : prev;
    });
  }, [depAirport, arrAirport]);


  useEffect(() => {
    if (resolvedFlight || !personnel.length) return;

    // The card as Settings › Logging says it is (seat, PF convention).
    const selfCrew = withLoggingPreferences(pickSelfCard(personnel), preferences.logging);
    if (selfCrew?.id) {
      if (selfCrew.defaultPIC) {
        setFormData((prev) => ({
          ...prev,
          pilotRole: "PIC",
          picId: selfCrew.id,
          picName: "Self",
        }));
      } else if (selfCrew.defaultSIC) {
        setFormData((prev) => ({
          ...prev,
          pilotRole: "SIC",
          sicId: selfCrew.id,
          sicName: "Self",
        }));
      }
    }
  // Use resolvedFlight?.id (not the full object) so this effect only re-runs when
  // the flight identity changes, not on every useLiveQuery reactive update.
  // Avoids spurious self-crew default applications during sync Dexie writes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedFlight?.id, personnel]);

  // Calculate derived fields
  // A stored flight carries its own PF/PM and role; the evidence fallback only
  // covers a row written without them (`lib/utils/flight-evidence.ts`).
  const formPilotFlying = formData.pilotFlying ?? inferPilotFlying(formData);
  const formPilotRole = formData.pilotRole || inferPilotRole(formData);

  const calculatedFields = useMemo(() => {
    // A simulator derives nothing from its OUT/IN: its duration is
    // `simulatedInstrumentTime`, and a block time computed here was written
    // back on every open — four hours of block, and four of SIC from it,
    // for every session the pilot looked at.
    if (getEntryType({ entryType: formData.entryType, isSimulator: formData.isSimulator }) === "simulator") {
      return {
        blockTime: "00:00",
        flightTime: "00:00",
        nightTime: formData.nightTime || "00:00",
        dayTime: "00:00",
        dayTakeoffs: formData.dayTakeoffs ?? 0,
        dayLandings: formData.dayLandings ?? 0,
        nightTakeoffs: formData.nightTakeoffs ?? 0,
        nightLandings: formData.nightLandings ?? 0,
        picTime: "00:00",
        sicTime: "00:00",
        picusTime: "00:00",
        dualTime: "00:00",
        instructorTime: "00:00",
        crossCountryTime: "00:00",
      };
    }

    const blockTime =
      formData.outTime &&
      formData.inTime &&
      isValidHHMM(formData.outTime) &&
      isValidHHMM(formData.inTime)
        ? calculateBlockTime(formData.outTime, formData.inTime)
        : "00:00";

    // Off→on, or out→in when OFF/ON were not recorded (`airborneTimes`).
    const airborne = airborneTimes({
      outTime: formData.outTime,
      offTime: formData.offTime,
      onTime: formData.onTime,
      inTime: formData.inTime,
    });
    const flightTime = airborne ? calculateFlightTime(airborne.off, airborne.on) : "00:00";

    let nightTime = "00:00";
    let dayTime = "00:00";
    const af = preferences.autoFill;


    if (airportsPending) {
      // Hold what the flight already has until both airports are known.
      nightTime = formData.nightTime || "00:00";
      dayTime = calculateDayTime(blockTime, nightTime);
    } else if (
      af.night !== false &&
      formData.date &&
      formData.outTime &&
      formData.inTime && // We only STRICTLY need Out and In for the calculation to proceed
      depAirport &&
      arrAirport &&
      isValidHHMM(formData.outTime) &&
      isValidHHMM(formData.inTime)
    ) {
      const depLat = depAirport.latitude ?? (depAirport as any).lat;
      const depLon = depAirport.longitude ?? (depAirport as any).lon;
      const arrLat = arrAirport.latitude ?? (arrAirport as any).lat;
      const arrLon = arrAirport.longitude ?? (arrAirport as any).lon;

      if (
        hasCoordinates({ latitude: depLat, longitude: depLon }) &&
        hasCoordinates({ latitude: arrLat, longitude: arrLon })
      ) {
        // Pass the EFFECTIVE times to the calculator
        const nightResult = calculateNightTimeComplete(
          formData.date,
          formData.outTime,
          formData.offTime ?? "", // Pass raw values, helper handles the fallback
          formData.onTime ?? "",
          formData.inTime,
          { lat: depLat, lon: depLon }, // Pass as object
          { lat: arrLat, lon: arrLon } // Pass as object
        );
        nightTime = nightResult.nightTimeHHMM;
        dayTime = nightResult.dayTimeHHMM;

      } else {
        // Airports are present but lack usable coordinates (a custom airport
        // saved blank reads 0°N 0°E): there is no night time to compute, so
        // keep the one the flight has rather than writing 00:00 over it, and
        // split day time from block − that.
        nightTime = formData.nightTime || "00:00";
        dayTime = calculateDayTime(blockTime, nightTime);
      }
    } else {
      // Fallback: calculate day as block - night
      dayTime = calculateDayTime(blockTime, nightTime);
    }

    const toLdg = airportsPending
      ? {
          dayTakeoffs: formData.dayTakeoffs ?? 0,
          dayLandings: formData.dayLandings ?? 0,
          nightTakeoffs: formData.nightTakeoffs ?? 0,
          nightLandings: formData.nightLandings ?? 0,
        }
      : formData.date && airborne && depAirport && arrAirport
        ? calculateTakeoffsLandings(
            formData.date,
            airborne.off,
            airborne.on,
            depAirport,
            arrAirport,
            formPilotFlying,
            formData.outTime
          )
        : {
            dayTakeoffs: 0,
            dayLandings: 0,
            nightTakeoffs: 0,
            nightLandings: 0,
          };

    const roleTimes = calculateRoleTimes(
      blockTime,
      formPilotRole
    );

    // Gate role times by auto-fill preferences
    const gatedRoleTimes = {
      picTime: af.pic !== false ? roleTimes.picTime : "00:00",
      sicTime: af.sic !== false ? roleTimes.sicTime : "00:00",
      picusTime: af.p1us !== false ? roleTimes.picusTime : "00:00",
      dualTime: af.dualRcvd !== false ? roleTimes.dualTime : "00:00",
      instructorTime: af.dualGiven !== false ? roleTimes.instructorTime : "00:00",
    };

    // Auto-fill cross-country time
    const crossCountryTime = af.xc !== false && formData.departureIcao && formData.arrivalIcao && formData.departureIcao !== formData.arrivalIcao
      ? blockTime
      : "00:00";

    return {
      blockTime,
      flightTime,
      nightTime,
      dayTime,
      ...toLdg,
      ...gatedRoleTimes,
      crossCountryTime,
    };
  }, [
    formData.date,
    formData.outTime,
    formData.offTime,
    formData.onTime,
    formData.inTime,
    formPilotFlying,
    formPilotRole,
    formData.departureIcao,
    formData.arrivalIcao,
    formData.nightTime,
    formData.dayTakeoffs,
    formData.dayLandings,
    formData.nightTakeoffs,
    formData.nightLandings,
    depAirport,
    arrAirport,
    airportsPending,
    formData.entryType,
    formData.isSimulator,
    preferences.autoFill,
  ]);

  // Update form with calculated values (respecting manual overrides).
  // Only update fields whose values actually changed — returning prev when nothing
  // changed lets React bail out of the re-render entirely (Object.is short-circuit).
  useEffect(() => {
    setFormData((prev) => {
      const updates: Partial<FlightLog> = {};

      if (prev.blockTime !== calculatedFields.blockTime) updates.blockTime = calculatedFields.blockTime;
      if (prev.flightTime !== calculatedFields.flightTime) updates.flightTime = calculatedFields.flightTime;

      if (!manualOverrides.nightTime) {
        if (prev.nightTime !== calculatedFields.nightTime) updates.nightTime = calculatedFields.nightTime;
        if (prev.dayTime !== calculatedFields.dayTime) updates.dayTime = calculatedFields.dayTime;
      } else {
        // A pinned night time still leaves DAY time derived: it is the rest of
        // the block. Skipping it with the night meant an edited IN changed the
        // block and left day + night no longer adding up to it.
        const day = calculateDayTime(calculatedFields.blockTime, prev.nightTime || "00:00");
        if (prev.dayTime !== day) updates.dayTime = day;
      }

      if (!manualOverrides.dayTakeoffs && !manualOverrides.nightTakeoffs) {
        if (prev.dayTakeoffs !== calculatedFields.dayTakeoffs) updates.dayTakeoffs = calculatedFields.dayTakeoffs;
        if (prev.nightTakeoffs !== calculatedFields.nightTakeoffs) updates.nightTakeoffs = calculatedFields.nightTakeoffs;
      }
      if (!manualOverrides.dayLandings && !manualOverrides.nightLandings) {
        if (prev.dayLandings !== calculatedFields.dayLandings) updates.dayLandings = calculatedFields.dayLandings;
        if (prev.nightLandings !== calculatedFields.nightLandings) updates.nightLandings = calculatedFields.nightLandings;
      }

      if (!manualOverrides.picTime) {
        if (prev.picTime !== calculatedFields.picTime) updates.picTime = calculatedFields.picTime;
      }
      if (!manualOverrides.sicTime) {
        if (prev.sicTime !== calculatedFields.sicTime) updates.sicTime = calculatedFields.sicTime;
      }
      if (!manualOverrides.picusTime) {
        if (prev.picusTime !== calculatedFields.picusTime) updates.picusTime = calculatedFields.picusTime;
      }
      if (!manualOverrides.dualTime) {
        if (prev.dualTime !== calculatedFields.dualTime) updates.dualTime = calculatedFields.dualTime;
      }
      if (!manualOverrides.instructorTime) {
        if (prev.instructorTime !== calculatedFields.instructorTime) updates.instructorTime = calculatedFields.instructorTime;
      }

      // Nothing changed — return same reference so React skips the re-render
      if (Object.keys(updates).length === 0) return prev;
      return { ...prev, ...updates };
    });
  }, [calculatedFields, manualOverrides]);

  // Debounce form data for auto-save
  const debouncedFormData = useDebounce(formData, 500);

  // Track the last saved state to avoid unnecessary saves
  const lastSavedStateRef = useRef<string | null>(null);
  // The form as it stood when it last agreed with the database: what a save
  // diffs against, so only what the user changed is written.
  // (Declared above with formDataRef so the follow effect can reach it.)
  // Track which flight ID the baseline was captured for
  const baselineFlightIdRef = useRef<string | null>(null);

  /**
   * The ONE write path for this form — the debounced auto-save, the
   * navigate-away flush and the unmount flush all go through here.
   *
   * Two rules it enforces that a bare `updateFlight` does not:
   *
   * 1. The row must still be LIVE, re-read from Dexie at write time. Render-time
   *    state is not good enough for a flush that fires during teardown: the
   *    flight may have been deleted in the very commit that unmounted the form,
   *    and `updateEntity` bumps `updatedAt` and enqueues a push, so a stale save
   *    can last-write-wins over the deletion on another device.
   * 2. `deletedAt` never leaves this form. The form has no business setting bin
   *    state, and a record that carries an explicit `deletedAt: null` (a
   *    restored flight) would otherwise spread that null over a fresh delete
   *    stamp and resurrect the flight.
   */
  const persistFlight = useCallback(
    async (
      data: Partial<FlightLog>,
      overrides: FlightLog["manualOverrides"],
    ): Promise<FlightLog | boolean> => {
      if (!data?.id) return false;

      const stored = await getFlightById(data.id);
      if (!stored || !isLiveFlight(stored)) return false;

      // Only what changed since the baseline. With no baseline for THIS flight
      // (a flush in the first half-second after a swap) the stored row is the
      // baseline, which is the same thing a moment earlier.
      const baseline = baselineRef.current?.id === data.id ? baselineRef.current : stored;
      const patch = formPatch<FlightLog>(
        { ...data, manualOverrides: overrides },
        { ...baseline, manualOverrides: baselineRef.current?.id === data.id ? baselineOverridesRef.current : stored.manualOverrides }
      );
      baselineRef.current = { ...data };
      baselineOverridesRef.current = overrides;
      if (Object.keys(patch).length === 0) return true;
      return (await updateFlight(data.id, patch)) ?? true;
    },
    []
  );

  /**
   * Put a saved flight into the logbook's cache IN PLACE.
   *
   * Auto-save runs every half-second of typing, and each save used to
   * revalidate the whole list — every flight read back out of IndexedDB,
   * re-sorted, then deep-compared against the cached copy by SWR — to reflect
   * one changed row (~150ms at a 4× CPU throttle on 1,200 flights, per save,
   * while the pilot is typing). `insertFlightSorted` drops the old copy by id
   * and places the new one, so an edit that moves the flight's date or time
   * still lands in the right place. Without the stored row to hand (`true`),
   * it falls back to the full revalidation.
   */
  const refreshSavedFlight = useCallback((saved: FlightLog | boolean) => {
    if (saved === false) return;
    if (saved === true || !isLiveFlight(saved)) {
      mutate(CACHE_KEYS.flights);
      return;
    }
    mutate(
      CACHE_KEYS.flights,
      (prev: FlightLog[] | undefined) => (prev ? insertFlightSorted(prev, saved) : prev),
      { revalidate: false }
    );
  }, []);

  // Auto-save to IndexedDB for existing flights (drafts or otherwise)
  // This replaces sessionStorage draft management
  useEffect(() => {
    const autoSave = async () => {
      // Only auto-save if we have an existing flight with an ID
      const effectiveId = resolvedFlight?.id || flightIdProp;
      if (!debouncedFormData?.id || !effectiveId) return;
      // Guard: don't auto-save if the flight has been deleted from Dexie.
      // Without this, auto-save would re-create the deleted record via updateFlight,
      // causing useLiveQuery to fire and driving a render/re-save cycle (Error #185).
      if (!resolvedFlight) return;

      // Create a serializable state to compare
      const currentState = JSON.stringify({
        ...debouncedFormData,
        manualOverrides,
      });

      // If this is a new flight (ID changed), capture baseline from first debounced state
      // This ensures we capture the state AFTER calculations have run
      if (baselineFlightIdRef.current !== debouncedFormData.id) {
        baselineFlightIdRef.current = debouncedFormData.id;
        lastSavedStateRef.current = currentState;
        baselineRef.current = { ...debouncedFormData };
        baselineOverridesRef.current = manualOverrides;
        return; // Don't save on initial load, just capture baseline
      }

      // Skip save if nothing actually changed from baseline
      if (lastSavedStateRef.current === currentState) {
        return;
      }

      try {
        const written = await persistFlight(debouncedFormData, manualOverrides);
        if (!written) return;
        lastSavedStateRef.current = currentState;
        refreshSavedFlight(written);
      } catch (error) {
        console.error("Auto-save failed:", error);
      }
    };

    autoSave();
    // Keyed on the debounced form data + flight identity. Depending on the full
    // resolvedFlight would retrigger auto-save on every reactive DB write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedFormData, resolvedFlight?.id, flightIdProp, manualOverrides]);

  // Update field helper
  const updateField = useCallback(
    <K extends keyof FlightLog>(field: K, value: FlightLog[K]) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  // Handle OCR data extraction and populate form
  const handleOCRDataExtracted = useCallback((data: ExtractedFlightData) => {
    // Update form fields with extracted data
    if (data.date) {
      updateField("date", data.date);
    }
    if (data.flightNumber) {
      updateField("flightNumber", data.flightNumber);
    }
    if (data.aircraftReg) {
      updateField("aircraftReg", data.aircraftReg);
    }
    if (data.aircraftType) {
      updateField("aircraftType", data.aircraftType);
    }
    if (data.departureIcao) {
      updateField("departureIcao", data.departureIcao);
    }
    if (data.departureIata) {
      updateField("departureIata", data.departureIata);
    }
    if (data.arrivalIcao) {
      updateField("arrivalIcao", data.arrivalIcao);
    }
    if (data.arrivalIata) {
      updateField("arrivalIata", data.arrivalIata);
    }
    if (data.scheduledOut) {
      updateField("scheduledOut", data.scheduledOut);
    }
    if (data.scheduledIn) {
      updateField("scheduledIn", data.scheduledIn);
    }
    if (data.outTime) {
      updateField("outTime", data.outTime);
    }
    if (data.offTime) {
      updateField("offTime", data.offTime);
    }
    if (data.onTime) {
      updateField("onTime", data.onTime);
    }
    if (data.inTime) {
      updateField("inTime", data.inTime);
    }
    if (data.blockTime) {
      updateField("blockTime", data.blockTime);
    }
    if (data.flightTime) {
      updateField("flightTime", data.flightTime);
    }
  }, [updateField]);

  // Mark manual override
  const markManualOverride = useCallback(
    (field: keyof FlightLog["manualOverrides"], value: boolean) => {
      setManualOverrides((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  /**
   * Switch this record between flight and simulator.
   *
   * The two carry their duration in different fields on purpose: a flight's is
   * `blockTime` (which feeds every flight-hour total), a simulator's is
   * `simulatedInstrumentTime` (which does not). Switching moves the duration
   * across rather than leaving it in the field the new type ignores, so a
   * mis-typed entry stops inflating flight hours the moment it is corrected.
   */
  const setEntryType = useCallback((type: EntryType) => {
    setFormData((prev) => {
      if (getEntryType(prev) === type) return prev;
      const patch = entryTypePatch(type);
      if (type === "simulator") {
        const duration =
          prev.simulatedInstrumentTime && prev.simulatedInstrumentTime !== "00:00"
            ? prev.simulatedInstrumentTime
            : prev.blockTime || "00:00";
        return {
          ...prev,
          ...patch,
          simulatedInstrumentTime: duration,
          blockTime: "00:00",
          flightTime: "00:00",
          manualOverrides: {
            ...(prev.manualOverrides ?? {}),
            simulatedInstrumentTime: true,
          },
        };
      }
      const duration =
        prev.blockTime && prev.blockTime !== "00:00"
          ? prev.blockTime
          : prev.simulatedInstrumentTime || "00:00";
      return {
        ...prev,
        ...patch,
        blockTime: duration,
        simulatedInstrumentTime: "00:00",
        // A simulator pins its session time and its night time (00:00 — a
        // sim has no sky). Carried into a FLIGHT those pins hold night at
        // zero for good, because every recalculation respects a pin.
        manualOverrides: withoutSimulatorPins(prev.manualOverrides ?? {}, prev.nightTime),
      };
    });
  }, []);

  // Clear a field
  const clearField = useCallback(
    (field: keyof FlightLog) => {
      if (
        field === "dayTakeoffs" ||
        field === "nightTakeoffs" ||
        field === "dayLandings" ||
        field === "nightLandings" ||
        field === "autolands" ||
        field === "holds"
      ) {
        updateField(field, 0);
      } else {
        updateField(field, "" as any);
      }
      if (field in (manualOverrides || {})) {
        markManualOverride(field as keyof FlightLog["manualOverrides"], false);
      }
    },
    [updateField, markManualOverride, manualOverrides]
  );

  const SCROLL_STORAGE_KEY = "flight-form-scroll";

  // Whether scroll has already been restored for the current mount. Restore runs
  // once, then the user scrolls freely. A fresh mount (e.g. switching back into
  // the logbook section, which re-mounts the form) resets this and restores again.
  const didRestoreScrollRef = useRef(false);
  // rAF throttle flag for persisting the scroll position.
  const scrollSaveRafRef = useRef(false);

  // Persist the current scroll position (throttled to once per frame) so it can be
  // restored when the form re-mounts — switching out of the logbook section and
  // back, or returning from a picker on mobile. Kept current on every scroll so the
  // latest position is already saved by the time the form unmounts.
  const handleScrollSave = useCallback(() => {
    if (scrollSaveRafRef.current) return;
    scrollSaveRafRef.current = true;
    requestAnimationFrame(() => {
      scrollSaveRafRef.current = false;
      if (scrollContainerRef.current) {
        sessionStorage.setItem(SCROLL_STORAGE_KEY, String(scrollContainerRef.current.scrollTop));
      }
    });
  }, []);

  // Save scroll position immediately (used right before navigating to a picker).
  const saveScrollPosition = useCallback(() => {
    if (scrollContainerRef.current) {
      sessionStorage.setItem(SCROLL_STORAGE_KEY, String(scrollContainerRef.current.scrollTop));
    }
  }, []);

  // Restore the saved scroll position synchronously, BEFORE the browser paints,
  // so there is no flash at the top before jumping to the saved offset.
  // useLayoutEffect runs after the DOM is committed (with the flight's content,
  // seeded synchronously from the cache) but before paint, so the set is invisible.
  // Restores once per mount; switching between flights keeps the form mounted, so
  // this does not fire then — the live offset is preserved as-is.
  useLayoutEffect(() => {
    if (didRestoreScrollRef.current) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    // Wait until the content is backed by data (cache or live query) so it has its
    // full height; otherwise the saved offset would clamp to a short page.
    if (!cachedFlight && !liveFlight) return;
    didRestoreScrollRef.current = true;
    const saved = sessionStorage.getItem(SCROLL_STORAGE_KEY);
    if (!saved) return;
    const scrollVal = Number(saved);
    if (Number.isFinite(scrollVal) && scrollVal > 0) {
      el.scrollTop = scrollVal;
    }
    // One-shot scroll restore (guarded by didRestoreScrollRef). `cachedFlight`
    // is only read to confirm content is backed by data before restoring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveFlight]);

  // Force-save current form data before navigating away (bypasses debounce)
  // Skips save if nothing changed from last saved state to avoid sync queue bloat
  const forceSave = useCallback(async () => {
    const effectiveId = resolvedFlight?.id || flightIdProp;
    if (!formData?.id || !effectiveId) return;
    const currentState = JSON.stringify({ ...formData, manualOverrides });
    if (lastSavedStateRef.current === currentState) return;
    try {
      const written = await persistFlight(formData, manualOverrides);
      if (!written) return;
      lastSavedStateRef.current = currentState;
      // Refresh the list too. A forced save is the LAST write before the form
      // goes away, so if it doesn't update the cache nothing else will — the
      // logbook would keep showing pre-edit values until something refetched.
      refreshSavedFlight(written);
    } catch (error) {
      console.error("Force save failed:", error);
    }
  }, [formData, resolvedFlight?.id, flightIdProp, manualOverrides, persistFlight, refreshSavedFlight]);

  // The latest `forceSave`, held in a ref.
  //
  // The unmount flush below MUST have `[]` deps — that is what makes it fire on
  // unmount and not on every edit — and a `[]` effect closes over the FIRST
  // render's `forceSave`, which sees an empty form. The ref is what lets a
  // teardown reach the current data. Synced in an effect rather than during
  // render so this stays compiler-clean.
  const forceSaveRef = useRef(forceSave);
  useEffect(() => {
    forceSaveRef.current = forceSave;
  }, [forceSave]);

  const flushPendingEdit = useCallback(() => {
    // No baseline captured yet means the debounced auto-save has not completed
    // a single pass, so nothing on screen is user-authored — the form is still
    // showing what it loaded. Skip rather than write it back: it would enqueue a
    // sync item for an unchanged record, and in development StrictMode's
    // mount/unmount/remount would do exactly that on every open.
    if (lastSavedStateRef.current === null) return;
    void forceSaveRef.current();
  }, []);

  // Flush an edit that the 500ms auto-save debounce has not written yet.
  //
  // THIS IS DATA LOSS IF IT IS MISSING, and it was. Auto-save is debounced, and
  // the timer lives inside this component — so tapping a value and leaving
  // within 500ms destroyed the pending write along with the component. On the
  // desktop panel the form survives a flight switch (handled separately, via
  // the `flightIdProp` layout effect), but on a phone the detail panel is
  // conditionally rendered: `setSelectedId(null)` unmounts the form outright.
  //
  // That is the exact shape of "tap USE, tap back, repeat" across a batch of
  // flights: every flight left inside 500ms lost its edit and every one lingered
  // on kept it, so the damage looked random when it was purely a race against
  // the debounce.
  //
  // `forceSave` dedupes against `lastSavedStateRef`, so this is a no-op when the
  // debounce already won the race.
  useEffect(() => {
    return () => {
      flushPendingEdit();
    };
  }, [flushPendingEdit]);

  // The same flush for the app being backgrounded or killed rather than
  // navigated away from. An installed PWA can be swapped out or discarded at any
  // moment, and iOS does not reliably fire `beforeunload`/`unload` — `pagehide`
  // and the visibility transition to `hidden` are the two that can be counted
  // on, so both are wired and the dedupe makes the overlap free.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") flushPendingEdit();
    };
    window.addEventListener("pagehide", flushPendingEdit);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flushPendingEdit);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [flushPendingEdit]);

  // Instant in-logbook flight switching. When the selected flight changes while
  // the form stays mounted, flush the outgoing flight's edits, then seed the
  // incoming flight from the module cache synchronously BEFORE the browser paints.
  // useLayoutEffect re-renders with the new data before paint, so the user never
  // sees the previous flight's values (or a blank frame) during the switch.
  // The scroll offset is intentionally preserved for side-by-side comparison.
  useLayoutEffect(() => {
    if (flightIdProp === prevFlightIdRef.current) return;
    const outgoingId = prevFlightIdRef.current;
    prevFlightIdRef.current = flightIdProp;

    // Persist any unsaved edits to the flight we're leaving. forceSave reads the
    // outgoing formData synchronously and dedupes against lastSavedStateRef.
    if (outgoingId) void forceSave();

    // Reset transient UI + reconciliation refs for the incoming flight.
    setIsSubmitting(false);
    setActiveTimePicker(null);
    setDatePickerOpen(false);
    editingFlightInitializedRef.current = null;
    prevLiveFlightRef.current = undefined;

    // Seed the incoming flight from cache for an instant, correct first paint.
    // If it was never opened this session, fall back to an empty form — the
    // resolvedFlight effect then populates it once useLiveQuery resolves.
    const cached = flightIdProp ? flightDataCache.get(flightIdProp) : null;
    if (cached) {
      setFormData(cached);
      setManualOverrides(cached.manualOverrides ?? {});
    } else {
      setFormData(createEmptyFlightLog());
      setManualOverrides({});
    }
  }, [flightIdProp, forceSave]);

  // Navigate to picker pages for aircraft/airport/crew selection.
  // Both mobile and desktop navigate to the same pages. On desktop, the page
  // shows in the main panel while FlightForm stays in the detail panel.
  // Pickers write directly to Dexie — no URL data params needed.

  const openAirportPicker = async (field: "departureIcao" | "arrivalIcao") => {
    if (!formData.id) return;
    saveScrollPosition();
    await forceSave();
    const params = new URLSearchParams();
    params.set("field", field);
    params.set("flightId", formData.id);
    router.push(`/airports?${params.toString()}`);
  };

  const openAircraftPicker = async () => {
    if (!formData.id) return;
    saveScrollPosition();
    await forceSave();
    const params = new URLSearchParams();
    params.set("select", "true");
    params.set("field", "aircraftReg");
    params.set("flightId", formData.id);
    router.push(`/aircraft?${params.toString()}`);
  };

  const openCrewPicker = async (field: "picId" | "sicId") => {
    if (!formData.id) return;
    saveScrollPosition();
    await forceSave();
    const params = new URLSearchParams();
    params.set("field", field);
    params.set("flightId", formData.id);
    router.push(`/crew?${params.toString()}`);
  };

  const swapCrew = useCallback(() => {
    setFormData((prev) => ({
      ...prev,
      picId: prev.sicId,
      picName: prev.sicName,
      sicId: prev.picId,
      sicName: prev.picName,
    }));
  }, []);

  // Handle time picker
  const handleTimeSelect = useCallback(
    (time: string) => {
      if (activeTimePicker) {
        updateField(activeTimePicker as keyof FlightLog, time);
        setActiveTimePicker(null);
      }
    },
    [activeTimePicker, updateField]
  );

  const setNowTime = useCallback(
    (field: keyof FlightLog) => {
      const now = getCurrentTimeUTC();
      updateField(field, now);
    },
    [updateField]
  );


  // Additional crew management
  const addAdditionalCrew = useCallback(() => {
    const newCrew: AdditionalCrew = {
      id: crypto.randomUUID(),
      name: "",
      role: "Observer",
    };
    setFormData((prev) => ({
      ...prev,
      additionalCrew: [...(prev.additionalCrew || []), newCrew],
    }));
  }, []);

  const updateAdditionalCrew = useCallback(
    (id: string, updates: Partial<AdditionalCrew>) => {
      setFormData((prev) => ({
        ...prev,
        additionalCrew: (prev.additionalCrew || []).map((c) =>
          c.id === id ? { ...c, ...updates } : c
        ),
      }));
    },
    []
  );

  const removeAdditionalCrew = useCallback((id: string) => {
    setFormData((prev) => ({
      ...prev,
      additionalCrew: (prev.additionalCrew || []).filter((c) => c.id !== id),
    }));
  }, []);

  // Approaches management
  const addApproach = useCallback(() => {
    const newApproach: Approach = {
      id: `approach-${Date.now()}`,
      type: "ILS",
      category: "precision",
      runway: "",
      airport: formData.arrivalIcao || "",
    };
    setFormData((prev) => ({
      ...prev,
      approaches: [...(prev.approaches || []), newApproach],
    }));
  }, [formData.arrivalIcao]);

  const updateApproach = useCallback(
    (id: string, updates: Partial<Approach>) => {
      setFormData((prev) => ({
        ...prev,
        approaches: (prev.approaches || []).map((a) => {
          if (a.id === id) {
            const updated = { ...a, ...updates };
            if (updates.type && !updates.category) {
              updated.category = getApproachCategory(updates.type);
            }
            return updated;
          }
          return a;
        }),
      }));
    },
    []
  );

  const removeApproach = useCallback((id: string) => {
    setFormData((prev) => ({
      ...prev,
      approaches: (prev.approaches || []).filter((a) => a.id !== id),
    }));
  }, []);

  // Build flight crew list for signature selection
  const flightCrew = useMemo((): SignatureCrewMember[] => {
    const crew: SignatureCrewMember[] = [];

    // Add PIC if assigned
    if (formData.picId && formData.picName) {
      const picPersonnel = personnel.find((p) => p.id === formData.picId);
      crew.push({
        id: formData.picId,
        name: formData.picName === "Self" ? (picPersonnel?.name || "Self") : formData.picName,
        role: "pic",
        licenseNumber: picPersonnel?.licenceNumber,
      });
    }

    // Add SIC if assigned
    if (formData.sicId && formData.sicName) {
      const sicPersonnel = personnel.find((p) => p.id === formData.sicId);
      crew.push({
        id: formData.sicId,
        name: formData.sicName === "Self" ? (sicPersonnel?.name || "Self") : formData.sicName,
        role: "sic",
        licenseNumber: sicPersonnel?.licenceNumber,
      });
    }

    // Add additional crew with instructor/examiner roles
    if (formData.additionalCrew) {
      for (const ac of formData.additionalCrew) {
        if (ac.id && ac.name) {
          const acPersonnel = personnel.find((p) => p.id === ac.id);
          // Map additional crew role to signer role
          let signerRole: SignatureCrewMember["role"] = "examiner";
          if (ac.role === "Instructor") {
            signerRole = "instructor";
          } else if (ac.role === "Examiner") {
            signerRole = "examiner";
          }
          crew.push({
            id: ac.id,
            name: ac.name,
            role: signerRole,
            licenseNumber: acPersonnel?.licenceNumber,
          });
        }
      }
    }

    return crew;
  }, [formData.picId, formData.picName, formData.sicId, formData.sicName, formData.additionalCrew, personnel]);

  // Signature handling
  const handleSignatureSave = useCallback((signature: FlightSignature) => {
    setFormData((prev) => ({
      ...prev,
      signature,
    }));
  }, []);

  const handleSignatureClear = useCallback(() => {
    setFormData((prev) => ({
      ...prev,
      signature: undefined,
    }));
  }, []);

  // Handle license update from signature component
  const handleLicenseUpdate = useCallback(
    async (crewId: string, licenseNumber: string) => {
      try {
        await updatePersonnel(crewId, { licenceNumber: licenseNumber });
      } catch (error) {
        console.error("Failed to update personnel license:", error);
      }
    },
    []
  );

  // Get active time picker timezone
  const getTimePickerTimezone = useCallback(() => {
    if (!activeTimePicker) return 0;
    if (
      activeTimePicker === "outTime" ||
      activeTimePicker === "offTime" ||
      activeTimePicker === "scheduledOut" ||
      activeTimePicker === "reportTime"
    ) {
      return depTimezone;
    }
    return arrTimezone;
  }, [activeTimePicker, depTimezone, arrTimezone]);

  // The ROSTERED report — scheduled gate-out less the hour para 7(2) allows
  // for pre-flight checks. Shown muted when nothing has been entered, because
  // it is the time actually in force, not a blank waiting to be filled. An
  // entered value only ever means the company MOVED the report (para 10); a
  // late pushback does not.
  const rosteredReport = useMemo(() => {
    const basis = formData.scheduledOut || formData.outTime;
    if (!isValidHHMM(basis || "")) return "";
    return minutesToHHMM((hhmmToMinutes(basis!) - 60 + 1440) % 1440);
  }, [formData.scheduledOut, formData.outTime]);

  // Register detail panel actions for the desktop floating glass bar
  const detailActions = useMemo(() => {
    return (
      <GlassContainer cornerRadius={22}>
        <ImageImportButton
          onDataExtracted={handleOCRDataExtracted}
          variant="ghost"
          size="icon"
          className="h-11 w-11 [&_svg]:!size-5"
        />
      </GlassContainer>
    );
  }, [handleOCRDataExtracted]);

  useRegisterDetailActions(detailActions, true);

  // A flight that is not on this device, or is in Recently Deleted, says so.
  // Only once the query has ANSWERED (null), and never over a draft.
  const missing = !editingFlight && flightIdProp && liveFlight === null;
  const binned = !editingFlight && liveFlight != null && liveFlight.deletedAt != null;
  if (missing || binned) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-panel pt-chrome pb-chrome text-center">
        <p className="text-base font-semibold">
          {binned ? "This flight is in Recently Deleted" : "Flight not found"}
        </p>
        <p className="max-w-xs text-sm text-muted-foreground">
          {binned
            ? "Restore it from Recently Deleted to view or edit it again."
            : "It may have been deleted on another device, or not synced to this one yet."}
        </p>
        {binned && (
          <Button variant="secondary" className="h-10" onClick={() => router.push("/recently-deleted")}>
            Open Recently Deleted
          </Button>
        )}
      </div>
    );
  }

  // Wait silently for useLiveQuery to resolve — returning null keeps the
  // previous panel content visible, avoiding a flash/spinner on selection change.
  if (flightIdProp && !resolvedFlight && !formData.id) {
    return null;
  }

  return (
    <div className="h-full relative">
    <div ref={scrollContainerRef} onScroll={handleScrollSave} className="h-full overflow-y-auto overscroll-contain bg-background scrollbar-hide">
      <ScrollIndicator />
      <div className="min-h-full pt-chrome pb-chrome">

      {/* Form Content — pt only: a pb here would stack under pb-chrome and
          push this panel's rest line 16px above every other panel's */}
      <div className="space-y-4 px-panel pt-4">
        {/* FLIGHT Section */}
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <div className="px-4 py-2 bg-muted/30">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              FLIGHT
            </h2>
          </div>

          {/* Entry type — first row, above the date, because it decides what
              the rest of the form means. A simulator session is logged here
              like a flight but must never reach flight-hour totals. */}
          <SettingsRow label="Type">
            <div className="flex items-center gap-1">
              {ENTRY_TYPES.map(({ value, label }) => {
                const active = getEntryType(formData) === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setEntryType(value)}
                    className={cn(
                      "rounded-full px-3 py-1 text-sm font-medium transition-colors",
                      active
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </SettingsRow>

          <SwipeableRow onClear={() => clearField("date")}>
            <SettingsRow
              label="Date"
              value={
                formData.date
                  ? new Date(formData.date + "T00:00:00").toLocaleDateString(
                      "en-GB",
                      {
                        weekday: "short",
                        day: "2-digit",
                        month: "short",
                        year: "2-digit",
                      }
                    )
                  : undefined
              }
              onClick={() => setDatePickerOpen(true)}
            />
          </SwipeableRow>

          <SwipeableRow onClear={() => clearField("flightNumber")}>
            <SettingsRow label="Flight #">
              <input
                type="text"
                className="text-right bg-transparent outline-none text-foreground w-32 placeholder:text-muted-foreground"
                placeholder="-"
                aria-label="Flight number"
                {...CODE_INPUT_PROPS}
                value={formData.flightNumber || ""}
                onChange={(e) => updateField("flightNumber", e.target.value.toUpperCase())}
              />
            </SettingsRow>
          </SwipeableRow>

          <SwipeableRow
            onClear={() => {
              updateField("aircraftReg", "");
              updateField("aircraftType", "");
            }}
          >
            <SettingsRow
              label="Aircraft"
              value={
                formData.aircraftReg
                  ? formData.aircraftType
                    ? `${formData.aircraftReg} (${formData.aircraftType})`
                    : formData.aircraftReg
                  : undefined
              }
              placeholder="Select"
              onClick={openAircraftPicker}
              showChevron
              icon={<Plane className="h-4 w-4" />}
            />
          </SwipeableRow>

          <SwipeableRow
            onClear={() => {
              updateField("departureIcao", "");
              updateField("departureIata", "");
            }}
          >
            <SettingsRow
              label="From"
              value={formData.departureIcao}
              placeholder="Select"
              onClick={() => openAirportPicker("departureIcao")}
              showChevron
              icon={<PlaneTakeoff className="h-4 w-4" />}
            />
          </SwipeableRow>

          <SwipeableRow
            onClear={() => {
              updateField("arrivalIcao", "");
              updateField("arrivalIata", "");
            }}
          >
            <SettingsRow
              label="To"
              value={formData.arrivalIcao}
              placeholder="Select"
              onClick={() => openAirportPicker("arrivalIcao")}
              showChevron
              icon={<PlaneLanding className="h-4 w-4" />}
            />
          </SwipeableRow>

          <SwipeableRow onClear={() => clearField("reportTime")}>
            <TimeRow
              label="Report"
              utcValue={formData.reportTime || ""}
              derivedValue={rosteredReport}
              timezoneOffset={depTimezone}
              onTap={() => setActiveTimePicker("reportTime")}
              onNow={() => setNowTime("reportTime")}
              clockSeparator={clockSeparator}
            />
          </SwipeableRow>

          <SwipeableRow onClear={() => clearField("scheduledOut")}>
            <TimeRow
              label="Scheduled Out"
              utcValue={formData.scheduledOut || ""}
              timezoneOffset={depTimezone}
              onTap={() => setActiveTimePicker("scheduledOut")}
              onNow={() => setNowTime("scheduledOut")}
            clockSeparator={clockSeparator}
            />
          </SwipeableRow>

          <SwipeableRow onClear={() => clearField("scheduledIn")}>
            <TimeRow
              label="Scheduled In"
              utcValue={formData.scheduledIn || ""}
              timezoneOffset={arrTimezone}
              onTap={() => setActiveTimePicker("scheduledIn")}
              onNow={() => setNowTime("scheduledIn")}
            clockSeparator={clockSeparator}
            />
          </SwipeableRow>

          <SwipeableRow onClear={() => clearField("outTime")}>
            <TimeRow
              label="Out"
              utcValue={formData.outTime || ""}
              timezoneOffset={depTimezone}
              onTap={() => setActiveTimePicker("outTime")}
              onNow={() => setNowTime("outTime")}
            clockSeparator={clockSeparator}
            />
          </SwipeableRow>

          <SwipeableRow onClear={() => clearField("offTime")}>
            <TimeRow
              label="Off"
              utcValue={formData.offTime || ""}
              timezoneOffset={depTimezone}
              onTap={() => setActiveTimePicker("offTime")}
              onNow={() => setNowTime("offTime")}
            clockSeparator={clockSeparator}
            />
          </SwipeableRow>

          <SwipeableRow onClear={() => clearField("onTime")}>
            <TimeRow
              label="On"
              utcValue={formData.onTime || ""}
              timezoneOffset={arrTimezone}
              onTap={() => setActiveTimePicker("onTime")}
              onNow={() => setNowTime("onTime")}
            clockSeparator={clockSeparator}
            />
          </SwipeableRow>

          <SwipeableRow onClear={() => clearField("inTime")}>
            <TimeRow
              label="In"
              utcValue={formData.inTime || ""}
              timezoneOffset={arrTimezone}
              onTap={() => setActiveTimePicker("inTime")}
              onNow={() => setNowTime("inTime")}
            clockSeparator={clockSeparator}
            />
          </SwipeableRow>
        </div>

        {/* CREW Section */}
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <div className="px-4 py-2 bg-muted/30">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              CREW
            </h2>
          </div>

          <SwipeableRow
            onClear={() => {
              updateField("picId", "");
              updateField("picName", "");
            }}
          >
            <SettingsRow
              label="PIC / P1"
              value={formData.picName}
              placeholder="Select"
              onClick={() => openCrewPicker("picId")}
              showChevron
              icon={<User className="h-4 w-4" />}
            />
          </SwipeableRow>

          <div className="flex items-center justify-center py-2 border-b border-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={swapCrew}
              className="h-8 px-3 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeftRight className="h-3.5 w-3.5 mr-1" />
              Swap Crew
            </Button>
          </div>

          <SwipeableRow
            onClear={() => {
              updateField("sicId", "");
              updateField("sicName", "");
            }}
          >
            <SettingsRow
              label="SIC / P2"
              value={formData.sicName}
              placeholder="Select"
              onClick={() => openCrewPicker("sicId")}
              showChevron
              icon={<User className="h-4 w-4" />}
            />
          </SwipeableRow>

          <div className="flex items-center justify-center py-3 row-divider">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-3 text-xs text-primary"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Crew
            </Button>
          </div>
        </div>

        {/* TIME Section */}
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <div className="px-4 py-2 bg-muted/30">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              TIME
            </h2>
          </div>

          <TimeDisplayRow
            label="Total Time"
            value={formData.blockTime || "00:00"}
          />

          <TimeDisplayRow
            label="Night"
            value={formData.nightTime || calculatedFields.nightTime || "00:00"}
            secondaryLabel="Day"
            secondaryValue={
              formData.dayTime || calculatedFields.dayTime || "00:00"
            }
          />

          <SwipeableRow
            onClear={() => {
              updateField("picusTime", "00:00");
              markManualOverride("picusTime", false);
            }}
          >
            <TimeDisplayRow
              label="P1u/s"
              value={formData.picusTime || "00:00"}
              showUseButton={
                formData.picusTime === "00:00" || !formData.picusTime
              }
              useLabel={`USE ${formatTimeShort(formData.blockTime || "00:00")}`}
              onUse={() => {
                updateField("picusTime", formData.blockTime || "00:00");
              }}
            />
          </SwipeableRow>

          <SwipeableRow
            onClear={() => {
              updateField("sicTime", "00:00");
              markManualOverride("sicTime", false);
            }}
          >
            <TimeDisplayRow
              label="SIC"
              value={formData.sicTime || "00:00"}
              showUseButton={formData.sicTime === "00:00" || !formData.sicTime}
              useLabel={`USE ${formatTimeShort(formData.blockTime || "00:00")}`}
              onUse={() => {
                updateField("sicTime", formData.blockTime || "00:00");
              }}
            />
          </SwipeableRow>

          <SwipeableRow
            onClear={() => {
              updateField("crossCountryTime", "00:00");
              markManualOverride("crossCountryTime", false);
            }}
          >
            <TimeDisplayRow
              label="XC"
              value={formData.crossCountryTime || "00:00"}
              showUseButton={
                formData.crossCountryTime === "00:00" ||
                !formData.crossCountryTime
              }
              useLabel={`USE ${formatTimeShort(formData.blockTime || "00:00")}`}
              onUse={() => {
                updateField("crossCountryTime", formData.blockTime || "00:00");
              }}
            />
          </SwipeableRow>

          <SwipeableRow
            onClear={() => {
              updateField("actualInstrumentTime", "00:00");
              markManualOverride("actualInstrumentTime", false);
            }}
          >
            <TimeDisplayRow
              label="Actual Inst"
              value={formData.actualInstrumentTime || "00:00"}
              showUseButton={
                formData.actualInstrumentTime === "00:00" ||
                !formData.actualInstrumentTime
              }
              useLabel={`USE ${formatTimeShort(formData.blockTime || "00:00")}`}
              onUse={() => {
                updateField(
                  "actualInstrumentTime",
                  formData.blockTime || "00:00"
                );
              }}
            />
          </SwipeableRow>

          <SwipeableRow
            onClear={() => {
              updateField("ifrTime", "00:00");
              markManualOverride("ifrTime", false);
            }}
          >
            <TimeDisplayRow
              label="IFR"
              value={formData.ifrTime || "00:00"}
              showUseButton={formData.ifrTime === "00:00" || !formData.ifrTime}
              useLabel={`USE ${formatTimeShort(formData.blockTime || "00:00")}`}
              onUse={() => {
                updateField("ifrTime", formData.blockTime || "00:00");
              }}
            />
          </SwipeableRow>

          <SwipeableRow
            onClear={() => {
              updateField("simulatedInstrumentTime", "00:00");
              markManualOverride("simulatedInstrumentTime", false);
            }}
          >
            <TimeDisplayRow
              label="Simulator"
              value={formData.simulatedInstrumentTime || "00:00"}
              showUseButton={
                formData.simulatedInstrumentTime === "00:00" ||
                !formData.simulatedInstrumentTime
              }
              useLabel={`USE ${formatTimeShort(formData.blockTime || "00:00")}`}
              onUse={() => {
                updateField(
                  "simulatedInstrumentTime",
                  formData.blockTime || "00:00"
                );
              }}
            />
          </SwipeableRow>
        </div>

        {/* DUTY Section */}
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <div className="px-4 py-2 bg-muted/30">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              DUTY
            </h2>
          </div>

          <ToggleRow
            label="Pilot Flying"
            checked={formPilotFlying}
            onCheckedChange={(checked) => {
              updateField("pilotFlying", checked);
              // The role follows who had the controls: a first officer's
              // flown leg takes their card's convention (SIC or PICUS), and
              // PICUS falls back to SIC when they were monitoring. A captain
              // stays PIC either way — see `reconcilePilotRole`.
              const nextRole = reconcilePilotRole({
                currentRole: formPilotRole,
                pilotFlying: checked,
                nonPicPfRole: nonPicPfRoleOf(
                  withLoggingPreferences(pickSelfCard(personnel), preferences.logging),
                  preferences.importDefaults?.nonPicPfRole,
                  formData.date
                ),
              });
              if (nextRole !== formData.pilotRole) updateField("pilotRole", nextRole);
            }}
          />

          {/* The native select covers the WHOLE row, invisibly, so a tap
              anywhere on it opens the platform's own picker. As a bare select
              it was the width of "PIC" — about 25px, with no chevron and a
              label that did nothing when tapped. */}
          <div className="relative flex items-center justify-between py-3.5 px-4 row-divider focus-within:outline-2 focus-within:outline-ring focus-within:-outline-offset-2">
            <span className="text-foreground">Pilot Role</span>
            <span className="flex items-center gap-1 text-foreground">
              {formPilotRole}
              <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
            </span>
            <select
              aria-label="Pilot role"
              value={formPilotRole}
              onChange={(e) =>
                updateField(
                  "pilotRole",
                  e.target.value as FlightLog["pilotRole"]
                )
              }
              className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
            >
              <option value="PIC">PIC</option>
              <option value="SIC">SIC</option>
              <option value="PICUS">PICUS</option>
              <option value="Dual">Dual</option>
              <option value="Instructor">Instructor</option>
              <option value="Examiner">Examiner</option>
            </select>
          </div>
        </div>

        {/* LANDINGS Section */}
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <div className="px-4 py-2 bg-muted/30">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              LANDINGS
            </h2>
          </div>

          <NumberRow
            label="Day Takeoffs"
            value={formData.dayTakeoffs || 0}
            onChange={(val) => {
              updateField("dayTakeoffs", val);
              markManualOverride("dayTakeoffs", true);
            }}
          />

          <NumberRow
            label="Day Landings"
            value={formData.dayLandings || 0}
            onChange={(val) => {
              updateField("dayLandings", val);
              markManualOverride("dayLandings", true);
            }}
          />

          <NumberRow
            label="Night Takeoffs"
            value={formData.nightTakeoffs || 0}
            onChange={(val) => {
              updateField("nightTakeoffs", val);
              markManualOverride("nightTakeoffs", true);
            }}
          />

          <NumberRow
            label="Night Landings"
            value={formData.nightLandings || 0}
            onChange={(val) => {
              updateField("nightLandings", val);
              markManualOverride("nightLandings", true);
            }}
          />

          <NumberRow
            label="Autolands"
            value={formData.autolands || 0}
            onChange={(val) => updateField("autolands", val)}
          />
        </div>

        {/* APPROACHES Section */}
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <div className="px-4 py-2 bg-muted/30">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              APPROACHES
            </h2>
          </div>

          {(formData.approaches || []).map((approach, index) => (
            <div
              key={approach.id}
              className="flex items-center justify-between py-3 px-4 border-b border-border"
            >
              <div className="flex items-center gap-2 flex-1">
                <select
                  aria-label="Approach type"
                  value={approach.type}
                  onChange={(e) =>
                    updateApproach(approach.id, { type: e.target.value as Approach["type"] })
                  }
                  className="bg-transparent text-foreground outline-none text-sm"
                >
                  <option value="ILS">ILS</option>
                  <option value="LOC">LOC</option>
                  <option value="VOR">VOR</option>
                  <option value="NDB">NDB</option>
                  <option value="RNAV">RNAV</option>
                  <option value="RNP">RNP</option>
                  <option value="GLS">GLS</option>
                  <option value="Visual">Visual</option>
                  <option value="Circling">Circling</option>
                </select>
                <span className="text-xs text-muted-foreground px-2 py-0.5 rounded bg-muted/50">
                  {approach.category === "precision"
                    ? "Precision"
                    : "Non-Precision"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={approach.runway || ""}
                  onChange={(e) =>
                    updateApproach(approach.id, {
                      runway: e.target.value.toUpperCase(),
                    })
                  }
                  placeholder="RWY"
                  aria-label="Runway"
                  {...CODE_INPUT_PROPS}
                  className="bg-transparent text-foreground text-right outline-none w-16"
                />
                <button
                  type="button"
                  onClick={() => removeApproach(approach.id)}
                  aria-label="Remove approach"
                  className="-m-2 p-2 text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}

          <button
            onClick={addApproach}
            className="w-full py-3 px-4 flex items-center justify-center gap-2 text-primary"
          >
            <Plus className="h-4 w-4" />
            <span>Add Approach</span>
          </button>

          <NumberRow
            label="Holds"
            value={formData.holds || 0}
            onChange={(v) => updateField("holds", v)}
          />

          <ToggleRow
            label="IPC / ICC"
            checked={formData.ipcIcc || false}
            onCheckedChange={(checked) => updateField("ipcIcc", checked)}
          />
        </div>

        {/* REMARKS Section */}
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <div className="px-4 py-2 bg-muted/30">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              REMARKS
            </h2>
          </div>

          {/* Typed IN the row, multi-line, and growing with what is written.
              It was a native `prompt()`: one cramped line under the site's
              origin, the old remark unreadable past its first words, and no
              way to write a second line — on the field where a pilot records
              what happened on the flight. */}
          <SwipeableRow onClear={() => clearField("remarks")}>
            <div className="px-4 py-3 row-divider">
              <textarea
                aria-label="Remarks"
                placeholder="Add a remark"
                rows={2}
                value={formData.remarks || ""}
                onChange={(e) => {
                  updateField("remarks", e.target.value);
                  fitTextarea(e.currentTarget);
                }}
                ref={fitTextareaRef}
                className="block w-full resize-none bg-transparent text-base leading-snug text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
          </SwipeableRow>
        </div>

        {/* SIGNATURE Section */}
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          {/* A plain disclosure, not Radix's Accordion: that one measures its
              content with getBoundingClientRect in a layout effect whenever it
              mounts OPEN — which it does for every signed flight — forcing a
              layout of the whole app in the middle of the commit that opens
              the form (~100ms at a 4× CPU throttle). A grid-rows transition
              opens and closes it with nothing to measure. */}
          <div>
              <div className="px-4 py-2 bg-muted/30">
                <button
                  type="button"
                  id={`${signatureSectionId}-trigger`}
                  aria-expanded={signatureSectionOpen}
                  aria-controls={signatureSectionId}
                  onClick={() => setSignatureSectionOpen((open) => !open)}
                  className="flex w-full flex-1 items-center justify-between font-medium"
                >
                  <div className="flex items-center gap-2">
                    <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      SIGNATURE
                    </h2>
                    {formData.signature && (
                      <span className="text-xs text-primary font-normal normal-case">
                        (Signed)
                      </span>
                    )}
                  </div>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 transition-transform duration-200",
                      signatureSectionOpen && "rotate-180",
                    )}
                  />
                </button>
              </div>
              <div
                id={signatureSectionId}
                role="region"
                aria-labelledby={`${signatureSectionId}-trigger`}
                inert={!signatureSectionOpen}
                className={cn(
                  "grid text-sm transition-[grid-template-rows] duration-200 ease-out",
                  signatureSectionOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                )}
              >
              <div className="min-h-0 overflow-hidden">
              <div className="px-4 pb-4 pt-0">
                {/* Signing happens FULL SCREEN. A signature is a drawing, and
                    it was being collected in a 120px strip at the bottom of a
                    long form; the summary stays here, the act moves out. */}
                <button
                  type="button"
                  onClick={() => setSignatureOpen(true)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-background px-4 py-3 text-left transition-colors hover:bg-secondary"
                >
                  {formData.signature ? (
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {formData.signature.signerName}
                        {formData.signature.signerRole && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            ({formData.signature.signerRole.toUpperCase()})
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Signed{" "}
                        {new Date(formData.signature.capturedAt).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {flightCrew.length === 0
                        ? "Assign crew to enable signing"
                        : "Tap to sign"}
                    </span>
                  )}
                  <PenLine className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                </button>
              </div>
              </div>
              </div>
          </div>
        </div>
      </div>

      <SignatureDialog
        open={signatureOpen}
        onClose={() => setSignatureOpen(false)}
        onSave={handleSignatureSave}
        onClear={handleSignatureClear}
        onLicenseUpdate={handleLicenseUpdate}
        initialSignature={formData.signature}
        flightCrew={flightCrew}
      />

      {/* Time Picker Modal */}
      {activeTimePicker && (
        <TimePicker
          isOpen={!!activeTimePicker}
          initialTime={formData[activeTimePicker as keyof FlightLog] as string}
          onSelect={handleTimeSelect}
          onClose={() => setActiveTimePicker(null)}
          timezoneOffset={getTimePickerTimezone()}
        />
      )}

      {datePickerOpen && (
        <DatePicker
          isOpen={datePickerOpen}
          initialDate={formData.date}
          onSelect={(value) => {
            updateField("date", value);
          }}
          onClose={() => setDatePickerOpen(false)}
          label="Select Date"
        />
      )}

      </div>
      </div>

    </div>
  );
}
