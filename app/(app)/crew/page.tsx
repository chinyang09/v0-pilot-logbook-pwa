"use client";

import type React from "react";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { PageContainer } from "@/components/page-container";
import { useDebounce } from "@/hooks/use-debounce";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SyncStatus } from "@/components/sync-status";
import { usePersonnel } from "@/hooks/data";
import { deletePersonnel } from "@/lib/db";
import {
  Search,
  Loader2,
  User,
  Plus,
  ArrowLeft,
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

const ITEMS_PER_PAGE = 50;

// --- SwipeableCrewCard Component ---
function SwipeableCrewCard({
  crew,
  onSelect,
  onDelete,
  isSelectMode,
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
}) {
  const displayName = crew.isMe ? "Self" : crew.name;

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
          "w-full text-left bg-card border border-border rounded-lg p-3 transition-all active:scale-[0.98]",
          crew.isMe &&
            "bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-semibold text-foreground">
                  {displayName}
                </span>
                {crew.crewId && (
                  <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    {crew.crewId}
                  </span>
                )}
                {crew.isMe && (
                  <span className="text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                    Me
                  </span>
                )}
              </div>
              {crew.organization && (
                <div className="text-sm text-muted-foreground truncate">
                  {crew.organization}
                </div>
              )}
              {crew.roles && crew.roles.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {crew.roles.map((role) => (
                    <span
                      key={role}
                      className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary"
                    >
                      {role}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
        </div>
      </button>
    </SwipeableCard>
  );
}

// --- Main CrewPage Component ---
export default function CrewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fieldType = searchParams.get("field");
  const returnUrl = searchParams.get("return") || "/new-flight";

  const { personnel, isLoading } = usePersonnel();
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 150);
  const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE);
  const { confirmDelete, handleDelete, DeleteDialog } = useDeleteConfirmation<(typeof personnel)[0]>();

  const observerTarget = useRef<HTMLDivElement>(null);

  const sortedPersonnel = useMemo(() => {
    return [...personnel].sort((a, b) => {
      if (a.isMe && !b.isMe) return -1;
      if (!a.isMe && b.isMe) return 1;
      if (a.favorite && !b.favorite) return -1;
      if (!a.favorite && b.favorite) return 1;
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [personnel]);

  const filteredPersonnel = useMemo(() => {
    const query = debouncedSearchQuery.toLowerCase().trim();
    if (!query) return sortedPersonnel.slice(0, displayCount);
    return sortedPersonnel
      .filter(
        (p) =>
          p.name?.toLowerCase().includes(query) ||
          p.crewId?.toLowerCase().includes(query) ||
          p.organization?.toLowerCase().includes(query) ||
          p.roles?.some((r) => r.toLowerCase().includes(query))
      )
      .slice(0, displayCount);
  }, [sortedPersonnel, debouncedSearchQuery, displayCount]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoading) {
          setDisplayCount((prev) =>
            Math.min(prev + ITEMS_PER_PAGE, personnel.length)
          );
        }
      },
      { threshold: 0.1 }
    );
    const target = observerTarget.current;
    if (target) observer.observe(target);
    return () => {
      if (target) observer.unobserve(target);
    };
  }, [isLoading, personnel.length]);

  useEffect(() => {
    setDisplayCount(ITEMS_PER_PAGE);
  }, [searchQuery]);

  // FastScroll state
  const [activeLetterKey, setActiveLetterKey] = useState<string | undefined>(undefined);
  const isFastScrollingRef = useRef(false);

  // Generate FastScroll items from crew names (excluding self and favorites)
  const fastScrollItems = useMemo(() => {
    const regularCrew = sortedPersonnel.filter((p) => !p.isMe && !p.favorite);
    return generateAlphabetItemsFromList(regularCrew.map((p) => p.name || ""));
  }, [sortedPersonnel]);

  // Track visible crew and update activeLetterKey on scroll
  useEffect(() => {
    if (debouncedSearchQuery || filteredPersonnel.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isFastScrollingRef.current) return;

        // Find the topmost visible non-self, non-favorite crew
        for (const entry of entries) {
          if (entry.isIntersecting && entry.boundingClientRect.top >= 0) {
            const id = entry.target.id.replace("crew-", "");
            const crew = personnel.find((p) => p.id === id);
            if (crew && !crew.isMe && !crew.favorite) {
              const name = crew.name || "";
              const firstChar = name[0]?.toUpperCase();
              if (firstChar && /[A-Z]/.test(firstChar)) {
                setActiveLetterKey(firstChar);
              } else {
                setActiveLetterKey("#");
              }
              break;
            }
          }
        }
      },
      { threshold: 0, rootMargin: "-100px 0px -80% 0px" }
    );

    // Observe all crew cards
    const cards = document.querySelectorAll('[id^="crew-"]');
    cards.forEach((card) => observer.observe(card));

    return () => observer.disconnect();
  }, [filteredPersonnel, personnel, debouncedSearchQuery]);

  // Handle FastScroll selection
  const handleFastScrollSelect = useCallback((letter: string) => {
    isFastScrollingRef.current = true;
    setActiveLetterKey(letter);

    // Find first crew member starting with this letter (skip self and favorites)
    const targetCrew = sortedPersonnel.find((p) => {
      if (p.isMe || p.favorite) return false;
      const name = p.name || "";
      const firstChar = name[0]?.toUpperCase();
      if (letter === "#") {
        return !/[A-Z]/.test(firstChar || "");
      }
      return firstChar === letter;
    });

    if (targetCrew) {
      // Make sure we've loaded enough items to show this crew
      const index = sortedPersonnel.findIndex((p) => p.id === targetCrew.id);
      if (index >= displayCount) {
        setDisplayCount(index + ITEMS_PER_PAGE);
      }

      // Scroll to the element with instant behavior for snappy feedback
      setTimeout(() => {
        const element = document.getElementById(`crew-${targetCrew.id}`);
        if (element) {
          element.scrollIntoView({ behavior: "instant", block: "start" });
        }
        // Reset fast scrolling flag after scroll completes
        setTimeout(() => {
          isFastScrollingRef.current = false;
        }, 100);
      }, 50);
    } else {
      isFastScrollingRef.current = false;
    }
  }, [sortedPersonnel, displayCount]);

  const handleCrewSelect = (crew: (typeof personnel)[0]) => {
    if (fieldType) {
      const params = new URLSearchParams();
      params.set("field", fieldType);
      params.set("crewId", crew.id);
      params.set("crewName", crew.isMe ? "Self" : crew.name);
      router.push(`${returnUrl}?${params.toString()}`);
    } else {
      router.push(`/crew/${crew.id}`);
    }
  };

  const handleAddCrew = () => {
    const url = fieldType
      ? `/crew/new?field=${fieldType}&return=${encodeURIComponent(returnUrl)}`
      : "/crew/new";
    router.push(url);
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

  return (
    <PageContainer
      header={
        <StandardPageHeader
          title={pageTitle}
          showBack={!!fieldType}
        />
      }
    >
      <div className="container mx-auto px-3 pt-3 pb-safe">
        <div className="sticky top-0 z-40 pb-3 bg-background/80 backdrop-blur-xl -mx-3 px-3">
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

        {isLoading && displayCount === ITEMS_PER_PAGE ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className={`space-y-3 ${!debouncedSearchQuery && fastScrollItems.length > 1 ? "pr-8" : ""}`}>
            {debouncedSearchQuery && (
              <h2 className="text-xs font-semibold text-muted-foreground uppercase px-1">
                {filteredPersonnel.length} results
              </h2>
            )}

            <div className="space-y-2">
              {filteredPersonnel.map((crew) => (
                <SwipeableCrewCard
                  key={crew.id}
                  crew={crew}
                  onSelect={() => handleCrewSelect(crew)}
                  onDelete={() => confirmDelete(crew)}
                  isSelectMode={!!fieldType}
                />
              ))}
            </div>

            <div ref={observerTarget} className="h-4" />

            {filteredPersonnel.length === 0 && !isLoading && (
              <div className="text-center py-12">
                <User className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-sm text-muted-foreground mb-4">
                  No results found.
                </p>
                <Button onClick={handleAddCrew} variant="outline">
                  <Plus className="h-4 w-4 mr-2" /> Add Crew Member
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* FastScroll rail - fixed position */}
      {!debouncedSearchQuery && fastScrollItems.length > 1 && (
        <div className="fixed right-1 top-1/2 -translate-y-1/2 z-40">
          <FastScroll
            items={fastScrollItems}
            activeKey={activeLetterKey}
            onSelect={handleFastScrollSelect}
            indicatorPosition="left"
          />
        </div>
      )}

      <DeleteDialog
        title="Delete Crew Member"
        description="Are you sure you want to delete this crew member? This action cannot be undone."
        onConfirm={() => handleDelete(performDelete)}
      />
    </PageContainer>
  );
}
