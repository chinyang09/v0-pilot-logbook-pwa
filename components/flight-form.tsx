"use client";

import type React from "react";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
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
  RefreshCw,
} from "lucide-react";
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
  addRecentlyUsedAirport,
  addRecentlyUsedAircraft,
  deleteFlight,
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
import { ImageImportButton } from "@/components/image-import-button";
import type { ExtractedFlightData } from "@/lib/ocr";

// Swipeable row component
function SwipeableRow({
  children,
  onClear,
}: {
  children: React.ReactNode;
  onClear: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);
  const currentOffset = useRef(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    currentOffset.current = offset;
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const diff = startX.current - e.touches[0].clientX;
    const newOffset = Math.max(0, Math.min(80, currentOffset.current + diff));
    setOffset(newOffset);
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    if (offset > 40) {
      setOffset(80);
    } else {
      setOffset(0);
    }
  };

  return (
    <div className="relative overflow-hidden">
      <div
        className="absolute right-0 top-0 bottom-0 w-20 bg-destructive flex items-center justify-center"
        onClick={() => {
          onClear();
          setOffset(0);
        }}
      >
        <span className="text-destructive-foreground text-sm font-medium">
          Clear
        </span>
      </div>
      <div
        className="relative bg-card transition-transform"
        style={{ transform: `translateX(-${offset}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
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
      className={`flex items-center justify-between py-3.5 px-4 border-b border-border last:border-b-0 ${
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
    <div className="flex items-center justify-between py-3.5 px-4 border-b border-border last:border-b-0">
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
    <div className="flex items-center justify-between py-3.5 px-4 border-b border-border last:border-b-0">
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
    <div className="flex items-center justify-between py-3.5 px-4 border-b border-border last:border-b-0">
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
    <div className="flex items-center justify-between py-3.5 px-4 border-b border-border last:border-b-0">
      <span className="text-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

interface FlightFormProps {
  onFlightAdded: (flight: FlightLog) => void;
  onClose: () => void;
  editingFlight?: FlightLog | null;
  selectedAirportField?: string | null;
  selectedAirportCode?: string | null;
  selectedAircraftReg?: string | null;
  selectedAircraftType?: string | null;
  selectedCrewField?: string | null;
  selectedCrewId?: string | null;
  selectedCrewName?: string | null;
  /** If true, picker navigation returns to /logbook with flightId instead of /flights/[id] */
  isDesktop?: boolean;
}

export function FlightForm({
  onFlightAdded,
  onClose,
  editingFlight,
  selectedAirportField,
  selectedAirportCode,
  selectedAircraftReg,
  selectedAircraftType,
  selectedCrewField,
  selectedCrewId,
  selectedCrewName,
  isDesktop = false,
}: FlightFormProps) {
  const router = useRouter();
  const { airports } = useAirportDatabase();
  const { personnel } = usePersonnel();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTimePicker, setActiveTimePicker] = useState<string | null>(null);

  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const editingFlightInitializedRef = useRef<string | null>(null);

  const selectionsProcessedRef = useRef<{
    airport?: string;
    aircraft?: string;
    crew?: string;
  }>({});

  // Initialize form data from editingFlight (draft or existing flight)
  const [formData, setFormData] = useState<Partial<FlightLog>>(() => {
    if (editingFlight) {
      editingFlightInitializedRef.current = editingFlight.id;
      return editingFlight;
    }
    return createEmptyFlightLog();
  });

  // Track manual overrides state
  const [manualOverrides, setManualOverrides] = useState<
    FlightLog["manualOverrides"]
  >(editingFlight?.manualOverrides || {});

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
  // Update form data when editingFlight changes (e.g., after refresh)
  useEffect(() => {
    if (!editingFlight) return;
    if (editingFlightInitializedRef.current === editingFlight.id) return;

    editingFlightInitializedRef.current = editingFlight.id;
    setFormData(editingFlight);
    setManualOverrides(editingFlight.manualOverrides || {});
  }, [editingFlight]);

  useEffect(() => {
    if (!selectedAirportField || !selectedAirportCode) return;

    const selectionKey = `${selectedAirportField}:${selectedAirportCode}`;
    if (selectionsProcessedRef.current.airport === selectionKey) return;

    selectionsProcessedRef.current.airport = selectionKey;

    setFormData((prev) => {
      const updated = { ...prev };
      if (selectedAirportField === "departureIcao") {
        updated.departureIcao = selectedAirportCode;
        updated.departureIata = "";
      } else if (selectedAirportField === "arrivalIcao") {
        updated.arrivalIcao = selectedAirportCode;
        updated.arrivalIata = "";
      }
      return updated;
    });

    addRecentlyUsedAirport(selectedAirportCode);

    const url = new URL(window.location.href);
    url.searchParams.delete("field");
    url.searchParams.delete("airport");
    window.history.replaceState({}, "", url.toString());
  }, [selectedAirportField, selectedAirportCode]);

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
          updated.departureTimezone = airport.timezone || 0;
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
          updated.arrivalTimezone = airport.timezone || 0;
          changed = true;
        }
      }

      return changed ? updated : prev;
    });
  }, [airports, formData.departureIcao, formData.arrivalIcao]);

  useEffect(() => {
    if (!selectedAircraftReg) return;

    const selectionKey = `${selectedAircraftReg}:${selectedAircraftType}`;
    if (selectionsProcessedRef.current.aircraft === selectionKey) return;

    selectionsProcessedRef.current.aircraft = selectionKey;

    setFormData((prev) => ({
      ...prev,
      aircraftReg: selectedAircraftReg,
      aircraftType: selectedAircraftType || prev.aircraftType,
    }));

    addRecentlyUsedAircraft(selectedAircraftReg);

    const url = new URL(window.location.href);
    url.searchParams.delete("field");
    url.searchParams.delete("aircraftReg");
    url.searchParams.delete("aircraftType");
    window.history.replaceState({}, "", url.toString());
  }, [selectedAircraftReg, selectedAircraftType]);

  useEffect(() => {
    if (!selectedCrewField || !selectedCrewId) return;

    const selectionKey = `${selectedCrewField}:${selectedCrewId}`;
    if (selectionsProcessedRef.current.crew === selectionKey) return;

    selectionsProcessedRef.current.crew = selectionKey;

    setFormData((prev) => {
      const updated = { ...prev };
      if (selectedCrewField === "picId") {
        updated.picId = selectedCrewId;
        updated.picName = selectedCrewName || "";
      } else if (selectedCrewField === "sicId") {
        updated.sicId = selectedCrewId;
        updated.sicName = selectedCrewName || "";
      }
      return updated;
    });

    const url = new URL(window.location.href);
    url.searchParams.delete("field");
    url.searchParams.delete("crewId");
    url.searchParams.delete("crewName");
    window.history.replaceState({}, "", url.toString());
  }, [selectedCrewField, selectedCrewId, selectedCrewName]);

  useEffect(() => {
    if (editingFlight || !personnel.length) return;

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
  }, [editingFlight, personnel]);

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
          formData.offTime, // Pass raw values, helper handles the fallback
          formData.onTime,
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

    return {
      blockTime,
      flightTime,
      nightTime,
      dayTime,
      ...toLdg,
      ...roleTimes,
    };
  }, [
    formData.date,
    formData.outTime,
    formData.offTime,
    formData.onTime,
    formData.inTime,
    formData.pilotFlying,
    formData.pilotRole,
    depAirport,
    arrAirport,
  ]);

  // Update form with calculated values (respecting manual overrides)
  useEffect(() => {
    setFormData((prev) => {
      const updates: Partial<FlightLog> = {
        blockTime: calculatedFields.blockTime,
        flightTime: calculatedFields.flightTime,
      };

      if (!manualOverrides.nightTime) {
        updates.nightTime = calculatedFields.nightTime;
        updates.dayTime = calculatedFields.dayTime;
      }

      if (!manualOverrides.dayTakeoffs && !manualOverrides.nightTakeoffs) {
        updates.dayTakeoffs = calculatedFields.dayTakeoffs;
        updates.nightTakeoffs = calculatedFields.nightTakeoffs;
      }
      if (!manualOverrides.dayLandings && !manualOverrides.nightLandings) {
        updates.dayLandings = calculatedFields.dayLandings;
        updates.nightLandings = calculatedFields.nightLandings;
      }

      if (!manualOverrides.picTime) {
        updates.picTime = calculatedFields.picTime;
      }
      if (!manualOverrides.sicTime) {
        updates.sicTime = calculatedFields.sicTime;
      }
      if (!manualOverrides.picusTime) {
        updates.picusTime = calculatedFields.picusTime;
      }
      if (!manualOverrides.dualTime) {
        updates.dualTime = calculatedFields.dualTime;
      }
      if (!manualOverrides.instructorTime) {
        updates.instructorTime = calculatedFields.instructorTime;
      }

      return { ...prev, ...updates };
    });
  }, [calculatedFields, manualOverrides]);

  // Debounce form data for auto-save
  const debouncedFormData = useDebounce(formData, 500);

  // Auto-save to IndexedDB for existing flights (drafts or otherwise)
  // This replaces sessionStorage draft management
  useEffect(() => {
    const autoSave = async () => {
      // Only auto-save if we have an existing flight with an ID
      if (!debouncedFormData?.id || !editingFlight?.id) return;

      try {
        await updateFlight(debouncedFormData.id, {
          ...debouncedFormData,
          manualOverrides,
        });
      } catch (error) {
        console.error("Auto-save failed:", error);
      }
    };

    autoSave();
  }, [debouncedFormData, editingFlight?.id, manualOverrides]);

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

  // Open pickers - on desktop, return to /logbook with flightId; on mobile, return to /flights/[id]
  const openAirportPicker = (field: "departureIcao" | "arrivalIcao") => {
    if (isDesktop && formData.id) {
      // On desktop, return to logbook with flightId to restore editing state
      router.push(`/airports?select=true&returnTo=/logbook&flightId=${formData.id}&field=${field}`);
    } else {
      const returnUrl = formData.id ? `/flights/${formData.id}` : "/logbook";
      router.push(`/airports?select=true&returnTo=${encodeURIComponent(returnUrl)}&field=${field}`);
    }
  };

  const openAircraftPicker = () => {
    if (isDesktop && formData.id) {
      router.push(`/aircraft?select=true&returnTo=/logbook&flightId=${formData.id}&field=aircraftReg`);
    } else {
      const returnUrl = formData.id ? `/flights/${formData.id}` : "/logbook";
      router.push(`/aircraft?select=true&returnTo=${encodeURIComponent(returnUrl)}&field=aircraftReg`);
    }
  };

  const openCrewPicker = (field: "picId" | "sicId") => {
    const crewField = field === "picId" ? "pic" : "sic";
    if (isDesktop && formData.id) {
      router.push(`/crew?select=true&return=/logbook&flightId=${formData.id}&field=${crewField}`);
    } else {
      const returnUrl = formData.id ? `/flights/${formData.id}` : "/logbook";
      router.push(`/crew?select=true&return=${encodeURIComponent(returnUrl)}&field=${crewField}`);
    }
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

  // Sync Flight: Mark as non-draft and sync to backend
  const handleSyncFlight = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const flightData: FlightLog = {
        id: formData.id || editingFlight?.id || crypto.randomUUID(),
        isDraft: false, // Mark as not a draft - will trigger sync
        createdAt: editingFlight?.createdAt || Date.now(),
        updatedAt: Date.now(),
        syncStatus: "pending",
        date: formData.date || new Date().toISOString().split("T")[0],
        flightNumber: formData.flightNumber || "",
        aircraftReg: formData.aircraftReg || "",
        aircraftType: formData.aircraftType || "",
        departureIcao: formData.departureIcao || "",
        departureIata: formData.departureIata || "",
        arrivalIcao: formData.arrivalIcao || "",
        arrivalIata: formData.arrivalIata || "",
        departureTimezone: formData.departureTimezone || 0,
        arrivalTimezone: formData.arrivalTimezone || 0,
        scheduledOut: formData.scheduledOut || "",
        scheduledIn: formData.scheduledIn || "",
        outTime: formData.outTime || "",
        offTime: formData.offTime || "",
        onTime: formData.onTime || "",
        inTime: formData.inTime || "",
        blockTime: formData.blockTime || "00:00",
        flightTime: formData.flightTime || "00:00",
        nightTime: formData.nightTime || "00:00",
        dayTime: formData.dayTime || "00:00",
        picId: formData.picId || "",
        picName: formData.picName || "",
        sicId: formData.sicId || "",
        sicName: formData.sicName || "",
        additionalCrew: formData.additionalCrew || [],
        pilotFlying: formData.pilotFlying ?? true,
        pilotRole: formData.pilotRole || "PIC",
        picTime: formData.picTime || "00:00",
        sicTime: formData.sicTime || "00:00",
        picusTime: formData.picusTime || "00:00",
        dualTime: formData.dualTime || "00:00",
        instructorTime: formData.instructorTime || "00:00",
        dayTakeoffs: formData.dayTakeoffs || 0,
        dayLandings: formData.dayLandings || 0,
        nightTakeoffs: formData.nightTakeoffs || 0,
        nightLandings: formData.nightLandings || 0,
        autolands: formData.autolands || 0,
        remarks: formData.remarks || "",
        endorsements: formData.endorsements || "",
        manualOverrides,
        ifrTime: formData.ifrTime || "00:00",
        actualInstrumentTime: formData.actualInstrumentTime || "00:00",
        simulatedInstrumentTime: formData.simulatedInstrumentTime || "00:00",
        crossCountryTime: formData.crossCountryTime || "00:00",
        approaches: formData.approaches || [],
        holds: formData.holds || 0,
        ipcIcc: formData.ipcIcc || false,
        signature: formData.signature,
      };

      await updateFlight(flightData.id, flightData);
      onFlightAdded(flightData);
    } catch (error) {
      console.error("Failed to sync flight:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Keep as Draft: Just close without marking as non-draft (auto-save already saved)
  const handleKeepAsDraft = () => {
    onClose();
  };

  // Discard Draft: Delete the draft flight and close
  const handleDiscardDraft = async () => {
    if (editingFlight?.id && editingFlight.isDraft) {
      try {
        await deleteFlight(editingFlight.id);
      } catch (error) {
        console.error("Failed to delete draft:", error);
      }
    }
    onClose();
  };

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

  const isDraft = editingFlight?.isDraft ?? true;

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Fixed Header */}
      <div className="sticky top-0 z-50 bg-card border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleKeepAsDraft} className="gap-1">
              <ChevronLeft className="h-4 w-4" />
              {isDraft ? "Keep Draft" : "Back"}
            </Button>
            <ImageImportButton
              onDataExtracted={handleOCRDataExtracted}
              variant="ghost"
              size="icon"
            />
          </div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            {isDraft ? "Draft" : "Edit Flight"}
            {isDraft && (
              <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full font-normal">
                Auto-saved
              </span>
            )}
          </h1>
          <Button
            onClick={handleSyncFlight}
            disabled={isSubmitting}
            size="sm"
            className="px-3 gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${isSubmitting ? "animate-spin" : ""}`} />
            {isSubmitting ? "Syncing..." : "Sync Flight"}
          </Button>
        </div>
      </div>

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
            <SettingsRow
              label="Flight #"
              value={formData.flightNumber}
              onClick={() => {
                const num = prompt("Flight Number:", formData.flightNumber);
                if (num !== null) updateField("flightNumber", num);
              }}
            />
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

          <div className="flex items-center justify-center py-3 border-b border-border last:border-b-0">
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
                    updateApproach(approach.id, { type: e.target.value })
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
  );
}
