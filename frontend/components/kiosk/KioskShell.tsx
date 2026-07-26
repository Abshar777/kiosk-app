"use client";

import type { Category, Course, CourseMode, CourseLevel, DurationBucketId } from "@course-lms/shared";
import { Button } from "@heroui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConfig } from "@/app/providers";
import { SearchIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n/provider";
import { useScrollDirection } from "@/lib/useScrollDirection";
import { CourseCard, CourseCardSkeleton } from "./CourseCard";
import { CourseFlowDialog } from "./CourseFlowDialog";
import { EMPTY_FILTERS, FilterBar, type Filters } from "./FilterBar";
import { KioskHeader } from "./KioskHeader";

/** Debounce keeps instant-search responsive without a request per keystroke. */
const SEARCH_DEBOUNCE_MS = 220;

export function KioskShell() {
  const { config } = useConfig();
  const { t } = useI18n();
  const { isVisible, isPinned } = useScrollDirection();

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [categories, setCategories] = useState<Category[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [activeCourse, setActiveCourse] = useState<Course | null>(null);
  const [isFlowOpen, setIsFlowOpen] = useState(false);

  // Guards against a slow earlier request overwriting a newer result.
  const requestSeq = useRef(0);

  useEffect(() => {
    api
      .categories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  const loadCourses = useCallback(async (current: Filters) => {
    const seq = ++requestSeq.current;
    setIsLoading(true);
    setLoadError(false);
    try {
      const result = await api.courses({
        q: current.q || undefined,
        category: current.category || undefined,
        mode: (current.mode || undefined) as CourseMode | undefined,
        level: (current.level || undefined) as CourseLevel | undefined,
        duration: (current.duration || undefined) as DurationBucketId | undefined,
        sort: current.sort,
        pageSize: 48,
      });
      if (seq !== requestSeq.current) return;
      setCourses(result.items);
      setTotal(result.total);
    } catch {
      if (seq !== requestSeq.current) return;
      setLoadError(true);
      setCourses([]);
      setTotal(0);
    } finally {
      if (seq === requestSeq.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void loadCourses(filters), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filters, loadCourses]);

  // Idle reset: return a half-finished session to the listing so the next
  // student never walks up to someone else's details on screen.
  useEffect(() => {
    const idleSeconds = config.kiosk.idleResetSeconds;
    if (idleSeconds <= 0) return;

    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        setIsFlowOpen(false);
        setActiveCourse(null);
        setFilters(EMPTY_FILTERS);
      }, idleSeconds * 1000);
    };

    const events = ["pointerdown", "keydown", "wheel"] as const;
    events.forEach((event) => window.addEventListener(event, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, reset));
    };
  }, [config.kiosk.idleResetSeconds]);

  const openCourse = (course: Course) => {
    setActiveCourse(course);
    setIsFlowOpen(true);
  };

  const finishFlow = () => {
    setIsFlowOpen(false);
    setActiveCourse(null);
    setFilters(EMPTY_FILTERS);
    void loadCourses(EMPTY_FILTERS);
  };

  return (
    <div className="flex min-h-screen flex-col">
      <KioskHeader />

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-6 py-8 md:px-10">
        <div className="mb-6">
          <h1 className="type-display text-ink">{t("listing.heading")}</h1>
          <p className="type-body-lg text-ink-muted mt-2">{t("listing.subheading")}</p>
        </div>

        {/*
         * Slides away as the student scrolls into the grid and returns on any
         * upward scroll. Once pinned it breaks out of the page gutters to span
         * the full viewport width, so it reads as a toolbar rather than a card
         * floating over the results.
         */}
        <div
          className={`sticky top-0 z-20 transition-transform duration-300 ease-out ${
            isPinned
              ? "-mx-6 border-b border-hairline bg-surface px-6 shadow-[0_6px_20px_rgb(16_24_40/0.06)] md:-mx-10 md:px-10"
              : ""
          } ${isVisible ? "translate-y-0" : "-translate-y-[calc(100%+1rem)]"}`}
        >
          <FilterBar
            categories={categories}
            filters={filters}
            isPinned={isPinned}
            onChange={(patch) => setFilters((prev) => ({ ...prev, ...patch }))}
            onClear={() => setFilters(EMPTY_FILTERS)}
            resultCount={total}
          />
        </div>

        <div className="mt-6">
          {isLoading && courses.length === 0 ? (
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {Array.from({ length: 8 }, (_, index) => (
                <CourseCardSkeleton key={index} />
              ))}
            </div>
          ) : loadError ? (
            <div className="bg-surface rounded-card flex flex-col items-center gap-4 p-16 text-center">
              <p className="type-heading text-ink">{t("listing.loadError")}</p>
              <Button
                className="min-h-touch"
                onPress={() => void loadCourses(filters)}
                size="lg"
                variant="primary"
              >
                {t("listing.retry")}
              </Button>
            </div>
          ) : courses.length === 0 ? (
            <div className="bg-surface rounded-card flex flex-col items-center gap-3 p-16 text-center">
              <span className="bg-surface-sunken text-ink-subtle grid h-16 w-16 place-items-center rounded-full">
                <SearchIcon size={28} />
              </span>
              <p className="type-heading text-ink mt-2">{t("listing.empty.title")}</p>
              <p className="type-body-lg text-ink-muted">{t("listing.empty.body")}</p>
              <Button
                className="min-h-touch mt-2"
                onPress={() => setFilters(EMPTY_FILTERS)}
                size="lg"
                variant="secondary"
              >
                {t("listing.clearFilters")}
              </Button>
            </div>
          ) : (
            <div
              className={`grid gap-6 transition-opacity duration-200 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 ${
                isLoading ? "opacity-60" : "opacity-100"
              }`}
            >
              {courses.map((course) => (
                <CourseCard course={course} key={course.id} onOpen={openCourse} />
              ))}
            </div>
          )}
        </div>
      </main>

      {config.academy.supportNumber && (
        <footer className="type-caption text-ink-subtle kiosk-nonselectable px-6 py-6 text-center md:px-10">
          {t("nav.support")} <span className="tabular">{config.academy.supportNumber}</span>
        </footer>
      )}

      <CourseFlowDialog
        course={activeCourse}
        isOpen={isFlowOpen}
        onDone={finishFlow}
        onOpenChange={setIsFlowOpen}
      />
    </div>
  );
}
