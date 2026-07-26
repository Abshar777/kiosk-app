"use client";

import type { Course } from "@course-lms/shared";
import { Chip } from "@heroui/react";
import { ClockIcon } from "@/components/icons";
import { formatCurrency, formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { CourseCover } from "./CourseCover";

const MODE_COLOR = {
  online: "accent",
  offline: "default",
  hybrid: "warning",
} as const;

export function CourseCard({
  course,
  onOpen,
}: {
  course: Course;
  onOpen: (course: Course) => void;
}) {
  const { t } = useI18n();
  const hasDiscount = course.originalPrice !== null && course.originalPrice > course.price;

  return (
    // The whole card is the target — design.md §7.3. A button element keeps it
    // keyboard- and screen-reader-operable without a nested interactive child.
    <button
      aria-label={course.name}
      className="bg-surface rounded-card group ring-focus flex w-full flex-col overflow-hidden p-5 text-start transition duration-150 ease-out hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)] active:translate-y-0"
      data-ripple
      data-testid="course-card"
      onClick={() => onOpen(course)}
      type="button"
    >
      <div className="rounded-image bg-surface-sunken relative aspect-video w-full overflow-hidden">
        <div className="absolute inset-0 transition duration-300 group-hover:scale-[1.03]">
          <CourseCover
            imageUrl={course.imageUrl}
            name={course.name}
            sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 25vw"
            slug={course.slug}
          />
        </div>
        {hasDiscount && (
          <span className="bg-brand text-brand-ink type-caption absolute end-3 top-3 rounded-full px-3 py-1 font-semibold">
            {Math.round(100 - (course.price / course.originalPrice!) * 100)}% off
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-1 flex-col">
        <div className="flex flex-wrap gap-2">
          <Chip color={MODE_COLOR[course.mode]} size="sm" variant="soft">
            {t(`mode.${course.mode}`)}
          </Chip>
          <Chip size="sm" variant="soft">
            {t(`level.${course.level}`)}
          </Chip>
        </div>

        <h3 className="type-subheading text-ink mt-3 clamp-2">{course.name}</h3>
        <p className="type-body text-ink-muted mt-2 clamp-2">{course.shortDescription}</p>

        <div className="border-hairline mt-auto flex items-end justify-between border-t pt-4">
          <span className="type-caption text-ink-muted inline-flex items-center gap-1.5">
            <ClockIcon size={16} />
            {course.durationLabel}
          </span>

          <span className="text-end">
            {hasDiscount && (
              <span className="type-caption text-ink-subtle tabular block line-through">
                {formatCurrency(course.originalPrice!, course.currency)}
              </span>
            )}
            <span className="type-subheading text-ink tabular">
              {course.price === 0
                ? t("common.free")
                : formatCurrency(course.price, course.currency)}
            </span>
          </span>
        </div>

        {course.enrollmentCount > 0 && (
          <p className="type-caption text-ink-subtle mt-2">
            {t("course.enrolled", { count: formatNumber(course.enrollmentCount) })}
          </p>
        )}
      </div>
    </button>
  );
}

export function CourseCardSkeleton() {
  return (
    <div className="bg-surface rounded-card p-5">
      <div className="rounded-image bg-surface-sunken aspect-video w-full animate-pulse" />
      <div className="mt-4 space-y-3">
        <div className="bg-surface-sunken h-6 w-24 animate-pulse rounded-full" />
        <div className="bg-surface-sunken h-6 w-3/4 animate-pulse rounded-lg" />
        <div className="bg-surface-sunken h-4 w-full animate-pulse rounded-lg" />
        <div className="bg-surface-sunken h-4 w-1/2 animate-pulse rounded-lg" />
      </div>
    </div>
  );
}
