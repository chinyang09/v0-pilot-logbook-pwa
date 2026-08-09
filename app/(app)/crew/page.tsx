"use client";

import type React from "react";
import { useState, useMemo, useRef, useEffect, useCallback, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { PageContainer } from "@/components/page-container";
import { useDebounce } from "@/hooks/use-debounce";
import { Button } from "@/components/ui/button";
import { usePersonnel, useFlights } from "@/hooks/data";
import { deletePersonnel, updateFlight, updatePersonnel } from "@/lib/db";
import { syncService } from "@/lib/sync";
import {
  Loader2,
  User,
  Plus,
  Trash2,
  ChevronRight,
  Star,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { mutate } from "swr";
import { CACHE_KEYS } from "@/hooks/data";
import { SwipeableCard } from "@/components/swipeable-card";
import { FastScroll, generateAlphabetItemsFromList, FAST_SCROLL_TOP_KEY } from "@/components/ui/fast-scroll";
import { scrollToIndexSettled, scrollToTop } from "@/lib/utils/virtual-scroll";
import { useDetailPanel } from "@/hooks/use-detail-panel";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { CrewDetailPanel } from "@/components/crew-detail-panel";
import { usePageActive } from "@/hooks/use-page-active";
import { useRegisterMainActions } from "@/hooks/use-page-actions";
import { GlassSearchButton } from "@/components/ui/glass-search-button";
import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { PanelLoading } from "@/components/ui/page-loading";

// Memoized crew card to prevent unnecessary re-renders during virtualization
const SwipeableCrewCard = memo(function SwipeableCrewCard({
  crew,
  onSelect,
  onDelete,
  isSelectMode,
  isSelected = false,
  isRecent = false,
  isFavorite = false,
  onToggleFavorite,
}: {
  crew: {
    id: string;
    name: string;
    crewId?: string;
    organization?: string;
    roles?: string[];
    isMe?: boolean;
  };
  onSelect: () => void;
  onDelete: () => void;
  isSelectMode: boolean;
  isSelected?: boolean;
  isRecent?: boolean;
  isFavorite?: boolean;
  onToggleFavorite?: (crewId: string) => void;
}) {
  const displayName = crew.isMe ? "Self" : crew.name;
  const secondaryParts: string[] = [];
  if (crew.organization) secondaryParts.push(crew.organization);
  if (crew.crewId) secondaryParts.push(crew.crewId);
  if (crew.roles && crew.roles.length > 0) secondaryParts.push(crew.roles.join(", "));

  return (
    <SwipeableCard
      id={`crew-${crew.id}`}
      onClick={onSelect}
      actions={[
        {
          icon: <Trash2 className="h-5 w-5" />,
          onClick: onDelete,
          variant: "destructive",
          holdToConfirm: true,
          cancelLabel: "Cancel delete",
        },
      ]}
    >
      <button
        className={cn(
          "w-full text-left bg-card border border-border rounded-lg py-2 pl-3 pr-6 transition-all hover:bg-accent",
          isRecent &&
            "bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20 hover:bg-transparent",
          isSelected && "bg-primary/20 border-primary hover:bg-primary/20"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground truncate">
                {displayName}
              </span>
              {crew.isMe && (
                <span className="text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded flex-shrink-0">
                  Me
                </span>
              )}
            </div>
            {secondaryParts.length > 0 && (
              <div className="text-sm text-muted-foreground truncate mt-0.5">
                {secondaryParts.join(" · ")}
              </div>
            )}
          </div>
          {onToggleFavorite ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
              aria-pressed={isFavorite}
              className="h-7 w-7 hover:bg-primary/20 relative z-10 flex-shrink-0"
              onClick={(e: React.MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleFavorite(crew.id);
              }}
            >
              <Star
                className={cn(
                  "h-4 w-4",
                  isFavorite
                    ? "fill-yellow-400 text-yellow-400"
                    : "text-muted-foreground/40"
                )}
              />
            </Button>
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          )}
        </div>
      </button>
    </SwipeableCard>
  );
});

// --- Main CrewPage Component ---
/** Transient selection id for the mobile create overlay (never persisted). */
const NEW_SENTINEL = "__new__";

export default function CrewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fieldType = searchParams.get("field");
  const returnUrl = searchParams.get("return") || "/logbook";
  const flightId = searchParams.get("flightId");
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const scrollContainerCallbackRef = useCallback((el: HTMLElement | null) => {
    scrollContainerRef.current = el;
  }, []);

  const { personnel, isLoading } = usePersonnel();
  const { flights } = useFlights();
  const [searchQuery, setSearchQuery] = useState("");
  const [desktopSearchOpen, setDesktopSearchOpen] = useState(false);
  const debouncedSearchQuery = useDebounce(searchQuery, 150);

  // Detail panel integration
  const {
    selectedId: selectedCrewId,
    setSelectedId: setSelectedCrewId,
    setDetailContent,
  } = useDetailPanel();
  const isDesktop = useIsDesktop();

  // FastScroll state
  const [activeLetterKey, setActiveLetterKey] = useState<string | undefined>(undefined);
  const isFastScrollingRef = useRef(false);

  // Only sync detail panel when this page is active — prevents hidden pages from
  // overwriting the active page's detail content when shared selectedId changes.
  const isActive = usePageActive("/crew")

  const sortedPersonnel = useMemo(() => {
    return [...personnel].sort((a, b) => {
      if (a.isMe && !b.isMe) return -1;
      if (!a.isMe && b.isMe) return 1;
      if (a.favorite && !b.favorite) return -1;
      if (!a.favorite && b.favorite) return 1;
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [personnel]);

  // Validate that selectedCrewId maps to a real crew member in our store.
  // This prevents stale cross-route selectedId values from being passed to CrewDetailPanel.
  const selectedCrew = useMemo(
    () => sortedPersonnel.find(p => p.id === selectedCrewId) || null,
    [selectedCrewId, sortedPersonnel]
  );

  // Derive recently used crew from flights (most recent first)
  const recentlyUsedCrew = useMemo(() => {
    if (flights.length === 0 || personnel.length === 0) return [];
    const seen = new Set<string>();
    const recentIds: string[] = [];
    for (const flight of flights) {
      for (const crewId of [flight.picId, flight.sicId]) {
        if (crewId && !seen.has(crewId)) {
          seen.add(crewId);
          recentIds.push(crewId);
          if (recentIds.length >= 10) break;
        }
      }
      if (recentIds.length >= 10) break;
    }
    const recent: (typeof personnel)[0][] = [];
    for (const id of recentIds) {
      const found = personnel.find((p) => p.id === id);
      if (found && !found.isMe && !found.favorite) recent.push(found);
    }
    return recent;
  }, [flights, personnel]);

  // Set of recent crew IDs for fast lookup
  const recentCrewIds = useMemo(() => {
    return new Set(recentlyUsedCrew.map((p) => p.id));
  }, [recentlyUsedCrew]);

  // Filtered personnel for search mode
  const filteredPersonnel = useMemo(() => {
    const query = debouncedSearchQuery.toLowerCase().trim();
    if (!query) return sortedPersonnel;
    return sortedPersonnel.filter(
      (p) =>
        p.name?.toLowerCase().includes(query) ||
        p.crewId?.toLowerCase().includes(query) ||
        p.organization?.toLowerCase().includes(query) ||
        p.roles?.some((r) => r.toLowerCase().includes(query))
    );
  }, [sortedPersonnel, debouncedSearchQuery]);

  // Browse list excludes self, favorites, and recently used (shown in their own sections)
  const browsePersonnel = useMemo(() => {
    return sortedPersonnel.filter((p) => !p.isMe && !p.favorite && !recentCrewIds.has(p.id));
  }, [sortedPersonnel, recentCrewIds]);

  // The list to virtualize
  const displayPersonnel = debouncedSearchQuery.trim() ? filteredPersonnel : browsePersonnel;

  // Generate FastScroll items from crew names (all personnel for full alphabet coverage)
  const fastScrollItems = useMemo(() => {
    const allCrew = sortedPersonnel.filter((p) => !p.isMe && !p.favorite);
    // ★ only when something is actually pinned above the alphabet (see the
    // airports page) — otherwise it is a control that goes nowhere.
    const hasPinned = allCrew.length < sortedPersonnel.length;
    return generateAlphabetItemsFromList(allCrew.map((p) => p.name || ""), {
      numberPosition: "end",
      withTop: hasPinned,
    });
  }, [sortedPersonnel]);

  // Pre-compute letter -> virtual list index mapping for fast scroll (based on browsePersonnel)
  const letterIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    browsePersonnel.forEach((crew, index) => {
      const name = crew.name || "";
      const firstChar = name[0]?.toUpperCase();
      const letter = firstChar && /[A-Z]/.test(firstChar) ? firstChar : "#";
      if (!map.has(letter)) {
        map.set(letter, index);
      }
    });
    return map;
  }, [browsePersonnel]);

  // Measure scroll margin: height of non-virtualized content above the virtual list
  const aboveVirtualRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  useEffect(() => {
    const el = aboveVirtualRef.current;
    const scrollEl = scrollContainerRef.current;
    if (!el || !scrollEl) {
      setScrollMargin(0);
      return;
    }

    const updateMargin = () => {
      const scrollRect = scrollEl.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const margin = (elRect.bottom - scrollRect.top) + scrollEl.scrollTop;
      setScrollMargin(margin);
    };

    updateMargin();
    const observer = new ResizeObserver(updateMargin);
    observer.observe(el);
    return () => observer.disconnect();
  }, [debouncedSearchQuery, personnel, recentlyUsedCrew]);

  // Virtual list
  const rowVirtualizer = useVirtualizer({
    count: displayPersonnel.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 60, // Uniform 2-row card height (py-2 + 2 lines + pb-1 gap)
    overscan: 10,
    scrollMargin,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  // Sync detail panel content — re-runs whenever selection, data, or active state changes
  // While the create form is open (detail panel on desktop, ?selected overlay
  // on mobile), data-driven re-syncs must not clobber the in-progress entry —
  // but a user changing the selection ends create mode (see aircraft page).
  const creatingRef = useRef<false | { sel: string | null }>(false);

  const syncDetailPanel = useCallback(() => {
    if (!isActive) return;
    if (fieldType) return;
    if (creatingRef.current) {
      const sel = selectedCrewId ?? null;
      if (sel === NEW_SENTINEL || sel === creatingRef.current.sel) return;
      creatingRef.current = false;
    }

    if (isLoading) {
      setDetailContent(
        <PanelLoading />
      );
      return;
    }

    if (sortedPersonnel.length === 0) {
      setDetailContent(
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
          <p>No crew members</p>
        </div>
      );
      return;
    }

    if (selectedCrew) {
      setDetailContent(
        <CrewDetailPanel
          crewId={selectedCrew.id}
          onUpdated={() => mutate(CACHE_KEYS.personnel)}
          onBack={() => setSelectedCrewId(null)}
        />
      );
    } else {
      setDetailContent(null);
    }
  }, [isActive, fieldType, selectedCrewId, selectedCrew, sortedPersonnel, isLoading, setDetailContent, setSelectedCrewId]);

  // Update detail content when selection, data, or active state changes
  useEffect(() => {
    syncDetailPanel();
  }, [syncDetailPanel]);

  // Track active letter from virtualizer scroll position
  useEffect(() => {
    if (debouncedSearchQuery.trim()) return;

    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    let ticking = false;
    const handleScroll = () => {
      if (ticking || isFastScrollingRef.current) return;

      ticking = true;
      requestAnimationFrame(() => {
        const items = rowVirtualizer.getVirtualItems();
        if (items.length > 0) {
          const scrollOffset = rowVirtualizer.scrollOffset ?? 0;
          let topItem = items[0];
          for (const item of items) {
            if (item.start + scrollMargin >= scrollOffset) {
              topItem = item;
              break;
            }
          }
          const crew = displayPersonnel[topItem.index];
          if (crew) {
            const name = crew.name || "";
            const firstChar = name[0]?.toUpperCase();
            if (firstChar && /[A-Z]/.test(firstChar)) {
              setActiveLetterKey(firstChar);
            } else {
              setActiveLetterKey("#");
            }
          }
        }
        ticking = false;
      });
    };

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [displayPersonnel, debouncedSearchQuery, rowVirtualizer, scrollMargin]);

  // Handle FastScroll selection - uses scrollToIndex
  const handleFastScrollSelect = useCallback((letter: string) => {
    isFastScrollingRef.current = true;
    setActiveLetterKey(letter);
    // ★ is the pinned favourites/recent block at the very top, which has no
    // letter of its own.
    if (letter === FAST_SCROLL_TOP_KEY) {
      scrollToTop(rowVirtualizer);
      setTimeout(() => { isFastScrollingRef.current = false; }, 150);
      return;
    }
    const index = letterIndexMap.get(letter);
    if (index !== undefined) {
      // Settled, not a single call: the rows are dynamically measured, so one
      // scrollToIndex lands short of the letter (see lib/utils/virtual-scroll).
      scrollToIndexSettled(rowVirtualizer, index);
    }
    setTimeout(() => {
      isFastScrollingRef.current = false;
    }, 250);
  }, [letterIndexMap, rowVirtualizer]);

  const handleCrewSelect = useCallback(async (crew: (typeof personnel)[0]) => {
    if (fieldType && flightId) {
      const crewName = crew.isMe ? "Self" : crew.name;
      const updates: Partial<{ picId: string; picName: string; sicId: string; sicName: string }> = {};
      if (fieldType === "picId" || fieldType === "pic") {
        updates.picId = crew.id;
        updates.picName = crewName;
      } else if (fieldType === "sicId" || fieldType === "sic") {
        updates.sicId = crew.id;
        updates.sicName = crewName;
      }
      try {
        await updateFlight(flightId, updates);
        syncService.notifyDataChange();
      } catch (error) {
        console.error("Failed to update flight with crew:", error);
      }
      router.back();
    } else {
      setSelectedCrewId(crew.id);
    }
  }, [fieldType, flightId, router, setSelectedCrewId]);

  const openCreatePanel = useCallback(() => {
    creatingRef.current = { sel: selectedCrewId ?? null };
    setDetailContent(
      <CrewDetailPanel
        crewId="new"
        isNew
        onUpdated={async (saved) => {
          creatingRef.current = false;
          await mutate(CACHE_KEYS.personnel);
          if (saved) setSelectedCrewId(saved.id);
        }}
        onCancelNew={() => {
          creatingRef.current = false;
          if (selectedCrew) {
            setDetailContent(
              <CrewDetailPanel
                crewId={selectedCrew.id}
                onUpdated={() => mutate(CACHE_KEYS.personnel)}
                onBack={() => setSelectedCrewId(null)}
              />
            );
          } else {
            setSelectedCrewId(null);
            setDetailContent(null);
          }
        }}
      />
    );
  }, [selectedCrewId, selectedCrew, setDetailContent, setSelectedCrewId]);

  const handleAddCrew = useCallback(() => {
    if (fieldType) {
      // Picker flow (choosing crew for a flight) keeps the full-page route.
      const params = new URLSearchParams();
      params.set("field", fieldType);
      params.set("return", returnUrl);
      if (flightId) params.set("flightId", flightId);
      router.push(`/crew/new?${params.toString()}`);
      return;
    }
    // Create from state on both viewports — instant, no route mount. Desktop
    // renders into the detail panel; mobile selects the sentinel so the
    // ?selected overlay opens with the same form.
    openCreatePanel();
    if (!isDesktop) setSelectedCrewId(NEW_SENTINEL);
  }, [isDesktop, fieldType, returnUrl, flightId, router, openCreatePanel, setSelectedCrewId]);

  // Prefetch the standalone create route so the mobile [+] navigation is as
  // snappy as opening a card (no RSC fetch on tap).
  useEffect(() => {
    router.prefetch("/crew/new");
  }, [router]);

  // ?new=1 — set when /crew/new detects a desktop viewport (deep link, or a
  // window resized mid-create) and redirects here so the create form lives in
  // the detail panel instead of the main panel.
  const wantsNew = searchParams.get("new") === "1";
  useEffect(() => {
    if (!wantsNew) return;
    router.replace("/crew", { scroll: false });
    if (isDesktop) openCreatePanel();
  }, [wantsNew, isDesktop, router, openCreatePanel]);

  const handleToggleFavorite = useCallback(async (crewId: string) => {
    const crew = personnel.find((p) => p.id === crewId);
    if (!crew) return;
    await updatePersonnel(crewId, { favorite: !crew.favorite });
    await mutate(CACHE_KEYS.personnel);
  }, [personnel]);

  const performDelete = async (crew: (typeof personnel)[0]) => {
    await deletePersonnel(crew.id);
    await mutate(CACHE_KEYS.personnel);
  };

  const pageTitle = fieldType
    ? `Select ${
        fieldType === "pic"
          ? "PIC"
          : fieldType === "sic"
          ? "SIC"
          : "Crew"
      }`
    : "Crew";

  const showFastScroll = !debouncedSearchQuery && fastScrollItems.length > 1;

  // Desktop floating glass bar actions — expandable search + glass add button
  const crewActions = useMemo(() => (
    <>
      <GlassSearchButton
        isOpen={desktopSearchOpen}
        onToggle={() => setDesktopSearchOpen(prev => !prev)}
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search crew..."
      />
      <GlassIconButton ariaLabel="Add crew member" onClick={handleAddCrew}>
        <Plus className="h-5 w-5" />
      </GlassIconButton>
    </>
  ), [handleAddCrew, searchQuery, desktopSearchOpen]);

  useRegisterMainActions(crewActions, isActive);

  return (
    <PageContainer
      rightContent={
        showFastScroll ? (
          <FastScroll
            items={fastScrollItems}
            activeKey={activeLetterKey}
            onSelect={handleFastScrollSelect}
            indicatorPosition="left"
          />
        ) : null
      }
      mainRef={scrollContainerCallbackRef}
    >
      <div>
        <div className="px-panel pt-4">
          {/* Non-virtualized content above the virtual list */}
          <div ref={aboveVirtualRef}>
            {!debouncedSearchQuery.trim() && (
              <div className="space-y-3">
                {/* Self Section */}
                {sortedPersonnel.filter((p) => p.isMe).length > 0 && (
                  <div className="space-y-1">
                    {sortedPersonnel
                      .filter((p) => p.isMe)
                      .map((crew) => (
                        <SwipeableCrewCard
                          key={crew.id}
                          crew={crew}
                          onSelect={() => handleCrewSelect(crew)}
                          onDelete={() => performDelete(crew)}
                          isSelectMode={!!fieldType}
                          isSelected={!fieldType && selectedCrewId === crew.id}
                          isFavorite={!!crew.favorite}
                          onToggleFavorite={handleToggleFavorite}
                        />
                      ))}
                  </div>
                )}

                {/* Favorites Section */}
                {sortedPersonnel.filter((p) => p.favorite && !p.isMe).length > 0 && (
                  <div className="space-y-1.5">
                    <h2 className="text-xs font-semibold text-primary uppercase px-1 flex items-center gap-1">
                      <Star className="h-3 w-3 fill-primary" /> Favorites
                    </h2>
                    <div className="space-y-1">
                      {sortedPersonnel
                        .filter((p) => p.favorite && !p.isMe)
                        .map((crew) => (
                          <SwipeableCrewCard
                            key={crew.id}
                            crew={crew}
                            onSelect={() => handleCrewSelect(crew)}
                            onDelete={() => performDelete(crew)}
                            isSelectMode={!!fieldType}
                            isSelected={!fieldType && selectedCrewId === crew.id}
                            isFavorite
                            onToggleFavorite={handleToggleFavorite}
                          />
                        ))}
                    </div>
                    <div className="border-t border-border/50 my-4" />
                  </div>
                )}

                {/* Recent Section (excluding self and favorites) */}
                {recentlyUsedCrew.length > 0 && (
                  <div className="space-y-1.5">
                    <h2 className="text-xs font-semibold text-muted-foreground uppercase px-1">
                      Recent
                    </h2>
                    <div className="space-y-1">
                      {recentlyUsedCrew.map((crew) => (
                        <SwipeableCrewCard
                          key={`recent-${crew.id}`}
                          crew={crew}
                          onSelect={() => handleCrewSelect(crew)}
                          onDelete={() => performDelete(crew)}
                          isSelectMode={!!fieldType}
                          isSelected={!fieldType && selectedCrewId === crew.id}
                          isRecent
                          isFavorite={!!crew.favorite}
                          onToggleFavorite={handleToggleFavorite}
                        />
                      ))}
                    </div>
                    <div className="border-t border-border my-4" />
                  </div>
                )}
              </div>
            )}

            {debouncedSearchQuery.trim() && (
              <div className="space-y-3">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase px-1">
                  {filteredPersonnel.length} results
                </h2>
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : displayPersonnel.length === 0 ? (
            <div className="text-center py-12">
              <User className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-sm text-muted-foreground mb-4">
                No results found.
              </p>
              <Button onClick={handleAddCrew} variant="outline">
                <Plus className="h-4 w-4 mr-2" /> Add Crew Member
              </Button>
            </div>
          ) : (
            /* Virtualized crew list */
            <div>
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  width: "100%",
                  position: "relative",
                }}
              >
                {virtualItems.map((virtualRow) => {
                  const crew = displayPersonnel[virtualRow.index];
                  if (!crew) return null;
                  return (
                    <div
                      key={crew.id}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)`,
                      }}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                    >
                      <div className="pt-1">
                        <SwipeableCrewCard
                          crew={crew}
                          onSelect={() => handleCrewSelect(crew)}
                          onDelete={() => performDelete(crew)}
                          isSelectMode={!!fieldType}
                          isSelected={!fieldType && selectedCrewId === crew.id}
                          isRecent={recentCrewIds.has(crew.id)}
                          isFavorite={!!crew.favorite}
                          onToggleFavorite={handleToggleFavorite}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
