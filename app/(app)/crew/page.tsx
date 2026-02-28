"use client";

import type React from "react";
import { useState, useMemo, useRef, useEffect, useCallback, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { PageContainer } from "@/components/page-container";
import { useDebounce } from "@/hooks/use-debounce";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { usePersonnel } from "@/hooks/data";
import { deletePersonnel, updateFlight } from "@/lib/db";
import { syncService } from "@/lib/sync";
import {
  Search,
  Loader2,
  User,
  Plus,
  Trash2,
  ChevronRight,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { mutate } from "swr";
import { CACHE_KEYS } from "@/hooks/data";
import { SwipeableCard } from "@/components/swipeable-card";
import { useDeleteConfirmation } from "@/components/delete-confirmation-dialog";
import { StandardPageHeader } from "@/components/standard-page-header";
import { FastScroll, generateAlphabetItemsFromList } from "@/components/ui/fast-scroll";
import { useDetailPanel } from "@/hooks/use-detail-panel";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { CrewDetailPanel } from "@/components/crew-detail-panel";

// Memoized crew card to prevent unnecessary re-renders during virtualization
const SwipeableCrewCard = memo(function SwipeableCrewCard({
  crew,
  onSelect,
  onDelete,
  isSelectMode,
  isSelected = false,
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
        },
      ]}
    >
      <button
        className={cn(
          "w-full text-left bg-card border border-border rounded-lg py-2 pl-3 pr-6 transition-all active:scale-[0.98]",
          crew.isMe &&
            "bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20",
          isSelected && "bg-primary/20 border-primary"
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
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        </div>
      </button>
    </SwipeableCard>
  );
});

// --- Main CrewPage Component ---
export default function CrewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fieldType = searchParams.get("field");
  const returnUrl = searchParams.get("return") || "/new-flight";
  const flightId = searchParams.get("flightId");
  const selectedFromUrl = searchParams.get("selected");
  const isDesktop = useIsDesktop();

  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const scrollContainerCallbackRef = useCallback((el: HTMLElement | null) => {
    scrollContainerRef.current = el;
  }, []);

  const { personnel, isLoading } = usePersonnel();
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 150);
  const { confirmDelete, handleDelete, DeleteDialog } = useDeleteConfirmation<(typeof personnel)[0]>();

  // Detail panel integration
  const {
    selectedId: selectedCrewId,
    setSelectedId: setSelectedCrewId,
    setDetailContent,
  } = useDetailPanel();

  // FastScroll state
  const [activeLetterKey, setActiveLetterKey] = useState<string | undefined>(undefined);
  const isFastScrollingRef = useRef(false);

  // Handle selection from URL (when redirected from mobile detail view)
  useEffect(() => {
    if (selectedFromUrl && isDesktop) {
      setSelectedCrewId(selectedFromUrl);
      const url = new URL(window.location.href);
      url.searchParams.delete("selected");
      window.history.replaceState({}, "", url.toString());
    }
  }, [selectedFromUrl, isDesktop, setSelectedCrewId]);

  const sortedPersonnel = useMemo(() => {
    return [...personnel].sort((a, b) => {
      if (a.isMe && !b.isMe) return -1;
      if (!a.isMe && b.isMe) return 1;
      if (a.favorite && !b.favorite) return -1;
      if (!a.favorite && b.favorite) return 1;
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [personnel]);

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

  // The list to virtualize
  const displayPersonnel = debouncedSearchQuery.trim() ? filteredPersonnel : sortedPersonnel;

  // Generate FastScroll items from crew names (excluding self and favorites)
  const fastScrollItems = useMemo(() => {
    const regularCrew = sortedPersonnel.filter((p) => !p.isMe && !p.favorite);
    return generateAlphabetItemsFromList(regularCrew.map((p) => p.name || ""), {
      numberPosition: "end",
    });
  }, [sortedPersonnel]);

  // Pre-compute letter -> virtual list index mapping for fast scroll
  const letterIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    sortedPersonnel.forEach((crew, index) => {
      if (crew.isMe || crew.favorite) return;
      const name = crew.name || "";
      const firstChar = name[0]?.toUpperCase();
      const letter = firstChar && /[A-Z]/.test(firstChar) ? firstChar : "#";
      if (!map.has(letter)) {
        map.set(letter, index);
      }
    });
    return map;
  }, [sortedPersonnel]);

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
  }, [debouncedSearchQuery, personnel]);

  // Virtual list
  const rowVirtualizer = useVirtualizer({
    count: displayPersonnel.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 60, // Uniform 2-row card height (py-2 + 2 lines + pb-1 gap)
    overscan: 10,
    scrollMargin,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  // Auto-select first crew when loading (desktop only, not in select mode)
  useEffect(() => {
    if (isDesktop && !fieldType && !isLoading && sortedPersonnel.length > 0 && !selectedCrewId) {
      setSelectedCrewId(sortedPersonnel[0].id);
    }
  }, [isDesktop, fieldType, isLoading, sortedPersonnel, selectedCrewId, setSelectedCrewId]);

  // Update detail content when selection changes
  useEffect(() => {
    if (fieldType) return;

    if (isLoading) {
      setDetailContent(
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
        </div>
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

    if (selectedCrewId) {
      setDetailContent(
        <CrewDetailPanel
          key={selectedCrewId}
          crewId={selectedCrewId}
          onUpdated={() => mutate(CACHE_KEYS.personnel)}
        />
      );
    } else if (isDesktop && sortedPersonnel.length > 0) {
      setSelectedCrewId(sortedPersonnel[0].id);
    }
  }, [isDesktop, fieldType, selectedCrewId, sortedPersonnel, isLoading, setDetailContent, setSelectedCrewId]);

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
          if (crew && !crew.isMe && !crew.favorite) {
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
    const index = letterIndexMap.get(letter);
    if (index !== undefined) {
      isFastScrollingRef.current = true;
      setActiveLetterKey(letter);
      rowVirtualizer.scrollToIndex(index, {
        align: "start",
        behavior: "auto",
      });
      setTimeout(() => {
        isFastScrollingRef.current = false;
      }, 150);
    }
  }, [letterIndexMap, rowVirtualizer]);

  // Scroll to selected crew from URL after data loads
  useEffect(() => {
    if (selectedFromUrl && isDesktop && !isLoading && sortedPersonnel.length > 0) {
      const index = sortedPersonnel.findIndex((p) => p.id === selectedFromUrl);
      if (index !== -1) {
        setTimeout(() => {
          rowVirtualizer.scrollToIndex(index, { align: "center", behavior: "auto" });
        }, 100);
      }
    }
  }, [selectedFromUrl, isDesktop, isLoading, sortedPersonnel, rowVirtualizer]);

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
  }, [fieldType, flightId, isDesktop, router, setSelectedCrewId]);

  const handleAddCrew = () => {
    const params = new URLSearchParams();
    if (fieldType) {
      params.set("field", fieldType);
      params.set("return", returnUrl);
      if (flightId) params.set("flightId", flightId);
    }
    const query = params.toString();
    router.push(query ? `/crew/new?${query}` : "/crew/new");
  };

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

  return (
    <PageContainer
      header={
        <StandardPageHeader
          title={pageTitle}
          showBack={!!fieldType}
          onBack={fieldType ? () => router.back() : undefined}
        />
      }
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
        <div className="px-4 pt-4 pb-safe">
          {/* Sticky search bar - outside aboveVirtualRef so it stays visible during scroll */}
          <div className="sticky top-0 z-40 pb-3 bg-background/30 backdrop-blur-xl -mx-3 px-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type="text"
                  placeholder="Search crew..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 h-10 bg-background/30 backdrop-blur-xl"
                />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              </div>
              <Button
                onClick={handleAddCrew}
                size="icon"
                className="h-10 w-10 flex-shrink-0"
              >
                <Plus className="h-5 w-5" />
              </Button>
            </div>
          </div>

          {/* Non-virtualized content above the virtual list */}
          <div ref={aboveVirtualRef}>
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
                      <div className="pb-1">
                        <SwipeableCrewCard
                          crew={crew}
                          onSelect={() => handleCrewSelect(crew)}
                          onDelete={() => confirmDelete(crew)}
                          isSelectMode={!!fieldType}
                          isSelected={!fieldType && selectedCrewId === crew.id}
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

      <DeleteDialog
        title="Delete Crew Member"
        description="Are you sure you want to delete this crew member? This action cannot be undone."
        onConfirm={() => handleDelete(performDelete)}
      />
    </PageContainer>
  );
}
