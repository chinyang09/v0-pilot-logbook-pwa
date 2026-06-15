"use client";

import type React from "react";

import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { userDb } from "@/lib/db/user-db";
import {
  ChevronLeft,
  ChevronRight,
  Plane,
  PlaneTakeoff,
  PlaneLanding,
  User,
  ArrowLeftRight,
  Plus,
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { SignatureCanvas, type SignatureCrewMember } from "@/components/signature-canvas";
import {
  updateFlight,
  updatePersonnel,
  getAirportByICAO,
} from "@/lib/db";
import { useDebounce } from "@/hooks/use-debounce";
import { useAirportDatabase } from "@/hooks/data";
import {
  createEmptyFlightLog,
  calculateBlockTime,
  calculateFlightTime,
  calculateDayTime,
  calculateTakeoffsLandings,
  calculateRoleTimes,
  getApproachCategory,
} from "@/lib/utils/flight-calculations";
import { calculateNightTimeComplete } from "@/lib/utils/night-time";
import {
  formatTimeShort,
  utcToLocal,
  formatTimezoneOffset,
  getCurrentTimeUTC,
  isValidHHMM,
} from "@/lib/utils/time";
import { usePersonnel } from "@/hooks/data";
import { usePreferences } from "@/components/providers/preferences-provider";
import { ImageImportButton } from "@/components/image-import-button";
import { GlassContainer } from "@/components/ui/glass-container";
import { SwipeableCard } from "@/components/swipeable-card";
import { useRegisterDetailActions } from "@/hooks/use-page-actions";
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
        onClick ? "cursor-pointer active:bg-muted/50" : ""
      }`}
      onClick={onClick}
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

// Caches the last-known data for each flight at module scope so the form can
// seed its initial state synchronously when it re-mounts (e.g. when switching
// back to the logbook from another section). Without this, the form mounts with
// empty data while useLiveQuery resolves asynchronously, briefly showing blank
// times before snapping to the real values. Cleared when the PWA is closed.
const flightDataCache = new Map<string, FlightLog>();

// Time row with UTC and Local display
function TimeRow({
  label,
  utcValue,
  timezoneOffset,
  onTap,
  onNow,
  showNow = true,
}: {
  label: string;
  utcValue: string;
  timezoneOffset: number;
  onTap: () => void;
  onNow?: () => void;
  showNow?: boolean;
}) {
  const localValue = utcToLocal(utcValue, timezoneOffset);
  const tzLabel = formatTimezoneOffset(timezoneOffset);
  const hasValue = isValidHHMM(utcValue);

  return (
    <div className="flex items-center justify-between py-3.5 px-4 row-divider">
      <span className="text-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-end cursor-pointer" onClick={onTap}>
          <span
            className={`text-lg ${
              hasValue ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            {hasValue ? utcValue : "--:--"}
          </span>
          <span className="text-xs text-muted-foreground">UTC</span>
        </div>
        <div className="flex flex-col items-end">
          {showNow && !hasValue ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs border-primary text-primary bg-transparent"
              onClick={(e) => {
                e.stopPropagation();
                onNow?.();
              }}
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
                {hasValue ? localValue : "--:--"}
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
            className="h-7 px-2 text-xs border-primary text-primary bg-transparent"
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
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 rounded-full bg-transparent"
          onClick={() => onChange(Math.max(0, value - 1))}
        >
          -
        </Button>
        <span className="text-foreground w-8 text-center">{value}</span>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 rounded-full bg-transparent"
          onClick={() => onChange(value + 1)}
        >
          +
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
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
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
  const { airports } = useAirportDatabase();
  const { personnel } = usePersonnel();
  const { preferences } = usePreferences();
  const [, setIsSubmitting] = useState(false);
  const [activeTimePicker, setActiveTimePicker] = useState<string | null>(null);

  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const editingFlightInitializedRef = useRef<string | null>(null);

  // Scroll position preservation across picker navigation
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // --- useLiveQuery for reactive flight data (both desktop and mobile) ---
  const liveFlight = useLiveQuery(
    () => (flightIdProp ? userDb.flights.get(flightIdProp) : undefined),
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
  const depAirport = useMemo(
    () =>
      formData.departureIcao
        ? getAirportByICAO(airports, formData.departureIcao)
        : null,
    [airports, formData.departureIcao]
  );
  const arrAirport = useMemo(
    () =>
      formData.arrivalIcao
        ? getAirportByICAO(airports, formData.arrivalIcao)
        : null,
    [airports, formData.arrivalIcao]
  );

  // Helper to get numeric offset from IANA string
  const getNumericOffset = (tzString?: string) => {
    if (!tzString) return 0;
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tzString,
        timeZoneName: "longOffset",
      }).formatToParts(new Date());
      const offsetPart =
        parts.find((p) => p.type === "timeZoneName")?.value || "";
      const match = offsetPart.match(/([+-]\d+)/);
      return match ? parseInt(match[1]) : 0;
    } catch {
      return 0;
    }
  };

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

  // --- Detect external DB changes (picker writes) via useLiveQuery ---
  // When a picker writes directly to Dexie, the liveFlight object updates.
  // We compare picker-modifiable fields to detect external changes and
  // merge them into formData without resetting user's in-progress edits.
  // Works for both desktop (form stays mounted) and mobile (form remounts, reads latest).
  const prevLiveFlightRef = useRef<FlightLog | undefined>(undefined);
  useEffect(() => {
    if (!liveFlight || !flightIdProp) return;

    // First load: already handled by initialization or the effect above
    if (!prevLiveFlightRef.current || prevLiveFlightRef.current.id !== liveFlight.id) {
      prevLiveFlightRef.current = liveFlight;
      return;
    }

    // Check for external changes in picker-modifiable fields
    const pickerFields = [
      "aircraftReg", "aircraftType",
      "departureIcao", "departureIata", "arrivalIcao", "arrivalIata",
      "picId", "picName", "sicId", "sicName",
    ] as const;

    let hasExternalChange = false;
    const updates: Partial<FlightLog> = {};

    for (const field of pickerFields) {
      const dbVal = liveFlight[field];
      const prevVal = prevLiveFlightRef.current[field];
      if (dbVal !== prevVal) {
        (updates as any)[field] = dbVal;
        hasExternalChange = true;
      }
    }

    prevLiveFlightRef.current = liveFlight;

    if (hasExternalChange) {
      setFormData((prev) => ({ ...prev, ...updates }));
    }
  }, [liveFlight, flightIdProp]);

  useEffect(() => {
    if (airports.length === 0) return;

    setFormData((prev) => {
      const updated = { ...prev };
      let changed = false;

      if (prev.departureIcao) {
        const airport = getAirportByICAO(airports, prev.departureIcao);
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
        const airport = getAirportByICAO(airports, prev.arrivalIcao);
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
  }, [airports, formData.departureIcao, formData.arrivalIcao]);


  useEffect(() => {
    if (resolvedFlight || !personnel.length) return;

    const selfCrew = personnel.find((p) => p.isMe);
    if (selfCrew) {
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
  const calculatedFields = useMemo(() => {
    const blockTime =
      formData.outTime &&
      formData.inTime &&
      isValidHHMM(formData.outTime) &&
      isValidHHMM(formData.inTime)
        ? calculateBlockTime(formData.outTime, formData.inTime)
        : "00:00";

    const flightTime =
      formData.offTime &&
      formData.onTime &&
      isValidHHMM(formData.offTime) &&
      isValidHHMM(formData.onTime)
        ? calculateFlightTime(formData.offTime, formData.onTime)
        : "00:00";

    let nightTime = "00:00";
    let dayTime = "00:00";
    const af = preferences.autoFill;

    // FALLBACK LOGIC: Create effective times for calculation
    // If OFF/ON are missing or invalid, fallback to OUT/IN to ensure we have a valid timeline
    const calcOffTime =
      formData.offTime &&
      isValidHHMM(formData.offTime) &&
      formData.offTime !== "00:00"
        ? formData.offTime
        : formData.outTime;

    const calcOnTime =
      formData.onTime &&
      isValidHHMM(formData.onTime) &&
      formData.onTime !== "00:00"
        ? formData.onTime
        : formData.inTime;

    if (
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
        typeof depLat === "number" &&
        !isNaN(depLat) &&
        typeof depLon === "number" &&
        !isNaN(depLon) &&
        typeof arrLat === "number" &&
        !isNaN(arrLat) &&
        typeof arrLon === "number" &&
        !isNaN(arrLon)
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

        console.log("[v0] Night calc result:", {
          date: formData.date,
          using: {
            out: formData.outTime,
            off: calcOffTime,
            on: calcOnTime,
            in: formData.inTime,
          },
          result: nightResult,
        });
      }
    } else {
      // Fallback: calculate day as block - night
      dayTime = calculateDayTime(blockTime, nightTime);
    }

    const toLdg =
      formData.date && calcOffTime && calcOnTime && depAirport && arrAirport
        ? calculateTakeoffsLandings(
            formData.date,
            calcOffTime,
            calcOnTime,
            depAirport,
            arrAirport,
            formData.pilotFlying ?? true
          )
        : {
            dayTakeoffs: 0,
            dayLandings: 0,
            nightTakeoffs: 0,
            nightLandings: 0,
          };

    const roleTimes = calculateRoleTimes(
      blockTime,
      formData.pilotRole || "PIC"
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
    formData.pilotFlying,
    formData.pilotRole,
    formData.departureIcao,
    formData.arrivalIcao,
    depAirport,
    arrAirport,
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
  // Track which flight ID the baseline was captured for
  const baselineFlightIdRef = useRef<string | null>(null);

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
        return; // Don't save on initial load, just capture baseline
      }

      // Skip save if nothing actually changed from baseline
      if (lastSavedStateRef.current === currentState) {
        return;
      }

      try {
        await updateFlight(debouncedFormData.id, {
          ...debouncedFormData,
          manualOverrides,
        });
        lastSavedStateRef.current = currentState;
        mutate(CACHE_KEYS.flights);
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
      await updateFlight(formData.id, { ...formData, manualOverrides });
      lastSavedStateRef.current = currentState;
    } catch (error) {
      console.error("Force save before picker navigation failed:", error);
    }
  }, [formData, resolvedFlight?.id, flightIdProp, manualOverrides]);

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
      activeTimePicker === "scheduledOut"
    ) {
      return depTimezone;
    }
    return arrTimezone;
  }, [activeTimePicker, depTimezone, arrTimezone]);

  // Register detail panel actions for the desktop floating glass bar
  const detailActions = useMemo(() => {
    return (
      <GlassContainer cornerRadius={28}>
        <ImageImportButton
          onDataExtracted={handleOCRDataExtracted}
          variant="ghost"
          size="icon"
          className="h-14 w-14"
        />
      </GlassContainer>
    );
  }, [handleOCRDataExtracted]);

  useRegisterDetailActions(detailActions, true);

  // Wait silently for useLiveQuery to resolve — returning null keeps the
  // previous panel content visible, avoiding a flash/spinner on selection change.
  if (flightIdProp && !resolvedFlight && !formData.id) {
    return null;
  }

  return (
    <div className="h-full relative">
    <div ref={scrollContainerRef} onScroll={handleScrollSave} className="h-full overflow-y-auto bg-background">
      <div className="min-h-full pt-16 pb-20">

      {/* Form Content */}
      <div className="space-y-4 px-2 py-4">
        {/* FLIGHT Section */}
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <div className="px-4 py-2 bg-muted/30">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              FLIGHT
            </h2>
          </div>

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

          <SwipeableRow onClear={() => clearField("scheduledOut")}>
            <TimeRow
              label="Scheduled Out"
              utcValue={formData.scheduledOut || ""}
              timezoneOffset={depTimezone}
              onTap={() => setActiveTimePicker("scheduledOut")}
              onNow={() => setNowTime("scheduledOut")}
            />
          </SwipeableRow>

          <SwipeableRow onClear={() => clearField("scheduledIn")}>
            <TimeRow
              label="Scheduled In"
              utcValue={formData.scheduledIn || ""}
              timezoneOffset={arrTimezone}
              onTap={() => setActiveTimePicker("scheduledIn")}
              onNow={() => setNowTime("scheduledIn")}
            />
          </SwipeableRow>

          <SwipeableRow onClear={() => clearField("outTime")}>
            <TimeRow
              label="Out"
              utcValue={formData.outTime || ""}
              timezoneOffset={depTimezone}
              onTap={() => setActiveTimePicker("outTime")}
              onNow={() => setNowTime("outTime")}
            />
          </SwipeableRow>

          <SwipeableRow onClear={() => clearField("offTime")}>
            <TimeRow
              label="Off"
              utcValue={formData.offTime || ""}
              timezoneOffset={depTimezone}
              onTap={() => setActiveTimePicker("offTime")}
              onNow={() => setNowTime("offTime")}
            />
          </SwipeableRow>

          <SwipeableRow onClear={() => clearField("onTime")}>
            <TimeRow
              label="On"
              utcValue={formData.onTime || ""}
              timezoneOffset={arrTimezone}
              onTap={() => setActiveTimePicker("onTime")}
              onNow={() => setNowTime("onTime")}
            />
          </SwipeableRow>

          <SwipeableRow onClear={() => clearField("inTime")}>
            <TimeRow
              label="In"
              utcValue={formData.inTime || ""}
              timezoneOffset={arrTimezone}
              onTap={() => setActiveTimePicker("inTime")}
              onNow={() => setNowTime("inTime")}
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
            checked={formData.pilotFlying ?? true}
            onCheckedChange={(checked) => updateField("pilotFlying", checked)}
          />

          <SettingsRow label="Pilot Role">
            <select
              value={formData.pilotRole || "PIC"}
              onChange={(e) =>
                updateField(
                  "pilotRole",
                  e.target.value as FlightLog["pilotRole"]
                )
              }
              className="bg-transparent text-foreground outline-none"
            >
              <option value="PIC">PIC</option>
              <option value="SIC">SIC</option>
              <option value="PICUS">PICUS</option>
              <option value="Dual">Dual</option>
              <option value="Instructor">Instructor</option>
              <option value="Examiner">Examiner</option>
            </select>
          </SettingsRow>
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
                  className="bg-transparent text-foreground text-right outline-none w-16"
                />
                <button
                  onClick={() => removeApproach(approach.id)}
                  className="text-destructive"
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

          <SwipeableRow onClear={() => clearField("remarks")}>
            <SettingsRow
              label="Comment"
              value={formData.remarks}
              onClick={() => {
                const comment = prompt("Remarks:", formData.remarks);
                if (comment !== null) updateField("remarks", comment);
              }}
              showChevron
            />
          </SwipeableRow>
        </div>

        {/* SIGNATURE Section */}
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <Accordion
            type="single"
            collapsible
            defaultValue={formData.signature ? "signature" : undefined}
          >
            <AccordionItem value="signature" className="border-0">
              <div className="px-4 py-2 bg-muted/30">
                <AccordionTrigger className="py-0 hover:no-underline">
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
                </AccordionTrigger>
              </div>
              <AccordionContent className="px-4 pb-4">
                <SignatureCanvas
                  onSave={handleSignatureSave}
                  onClear={handleSignatureClear}
                  onLicenseUpdate={handleLicenseUpdate}
                  initialSignature={formData.signature}
                  flightCrew={flightCrew}
                />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>

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
