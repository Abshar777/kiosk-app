"use client";

import type { Batch, Course } from "@course-lms/shared";
import { Button, Chip, Separator } from "@heroui/react";
import {
  CalendarIcon,
  CertificateIcon,
  CheckIcon,
  ClockIcon,
  UserIcon,
} from "@/components/icons";
import { Dialog, ResponsiveDialog } from "@/components/ui/ResponsiveDialog";
import { formatCurrency, formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { CourseCover } from "./CourseCover";

function SummaryRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span className="text-ink-subtle mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <dt className="type-caption text-ink-subtle">{label}</dt>
        <dd className="type-body text-ink font-medium">{children}</dd>
      </div>
    </div>
  );
}

function BatchRow({
  batch,
  isSelected,
  onSelect,
}: {
  batch: Batch;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { locale, t } = useI18n();
  const isFull = batch.seatsAvailable <= 0;

  return (
    <button
      className={`rounded-control ring-focus w-full p-4 text-start transition ${
        isSelected ? "ring-selected bg-surface-accent" : "bg-surface hover:bg-surface-accent"
      } ${isFull ? "cursor-not-allowed opacity-50" : ""}`}
      data-ripple
      disabled={isFull}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="type-label text-ink">{batch.label}</span>
        <span
          className={`type-caption shrink-0 rounded-full px-2.5 py-1 font-semibold ${
            isFull
              ? "bg-bad-bg text-bad"
              : batch.seatsAvailable <= 5
                ? "bg-warn-bg text-warn"
                : "bg-ok-bg text-ok"
          }`}
        >
          {isFull ? t("course.seatsFull") : t("course.seatsLeft", { count: batch.seatsAvailable })}
        </span>
      </div>
      <p className="type-caption text-ink-muted mt-1.5">
        {formatDate(batch.startDate, locale)} — {formatDate(batch.endDate, locale)}
      </p>
      <p className="type-caption text-ink-muted">
        {batch.days} · {batch.time}
      </p>
    </button>
  );
}

/**
 * Details *content* only — the surrounding dialog is owned by CourseFlowDialog,
 * so moving to the enrollment step swaps the view inside one overlay instead of
 * closing one and opening another (which races React Aria's focus handling).
 */
export function CourseDetailsView({
  course,
  selectedBatchId,
  onSelectBatch,
  onEnroll,
}: {
  course: Course;
  selectedBatchId: string | null;
  onSelectBatch: (batchId: string | null) => void;
  onEnroll: () => void;
}) {
  const { locale, t } = useI18n();

  const hasDiscount = course.originalPrice !== null && course.originalPrice > course.price;

  return (
    <>
      {/* Body scrolls; the price/enroll footer stays pinned — design.md §7.5. */}
      <Dialog.Body className="min-h-0 flex-1 overflow-y-auto p-0">
        <div className="relative">
          <div className="bg-surface-sunken relative aspect-[21/9] w-full">
            <CourseCover
              imageUrl={course.imageUrl}
              name={course.name}
              sizes="880px"
              slug={course.slug}
            />
          </div>
          <Dialog.CloseTrigger
            aria-label={t("course.close")}
            className="absolute end-4 top-4 z-10 grid h-12 w-12 place-items-center rounded-full bg-black/45 text-white backdrop-blur transition hover:bg-black/65"
          />
        </div>

        <div className="p-6 md:p-8">
          <div className="flex flex-wrap gap-2">
            <Chip color="accent" size="sm" variant="soft">
              {course.categoryName}
            </Chip>
            <Chip size="sm" variant="soft">
              {t(`mode.${course.mode}`)}
            </Chip>
            <Chip size="sm" variant="soft">
              {t(`level.${course.level}`)}
            </Chip>
            {course.hasCertificate && (
              <Chip color="success" size="sm" variant="soft">
                {t("course.certificate")}
              </Chip>
            )}
          </div>

          <Dialog.Heading className="type-title text-ink mt-4">{course.name}</Dialog.Heading>

          <div className="mt-6 grid gap-8 md:grid-cols-[1fr_300px]">
            <div className="min-w-0">
              <h3 className="type-label text-ink-muted">{t("course.about")}</h3>
              <p className="type-body-lg text-ink mt-2">{course.fullDescription}</p>

              {course.learningOutcomes.length > 0 && (
                <>
                  <h3 className="type-label text-ink-muted mt-8">{t("course.outcomes")}</h3>
                  <ul className="mt-3 space-y-2.5">
                    {course.learningOutcomes.map((outcome) => (
                      <li className="flex gap-3" key={outcome}>
                        <span className="bg-ok-bg text-ok mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full">
                          <CheckIcon size={14} />
                        </span>
                        <span className="type-body text-ink">{outcome}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <aside className="bg-surface-sunken rounded-card h-fit p-5">
              <dl className="space-y-4">
                <SummaryRow icon={<ClockIcon size={18} />} label={t("course.duration")}>
                  {course.durationLabel}
                </SummaryRow>
                <SummaryRow icon={<CalendarIcon size={18} />} label={t("course.mode")}>
                  {t(`mode.${course.mode}`)}
                </SummaryRow>
                {course.instructor.name && (
                  <SummaryRow icon={<UserIcon size={18} />} label={t("course.instructor")}>
                    {course.instructor.name}
                    <span className="type-caption text-ink-muted block font-normal">
                      {course.instructor.title}
                    </span>
                  </SummaryRow>
                )}
                <SummaryRow icon={<CertificateIcon size={18} />} label={t("course.certificate")}>
                  {course.hasCertificate
                    ? t("course.certificateYes")
                    : t("course.certificateNo")}
                </SummaryRow>
              </dl>

              <Separator className="my-5" />

              <h3 className="type-label text-ink-muted">{t("course.batches")}</h3>
              {course.batches.length === 0 ? (
                <p className="type-caption text-ink-subtle mt-2">{t("course.noBatches")}</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {course.batches.map((batch) => (
                    <BatchRow
                      batch={batch}
                      isSelected={selectedBatchId === batch.id}
                      key={batch.id}
                      onSelect={() =>
                        onSelectBatch(selectedBatchId === batch.id ? null : batch.id)
                      }
                    />
                  ))}
                </div>
              )}
            </aside>
          </div>
        </div>
      </Dialog.Body>

      <Dialog.Footer className="border-hairline bg-surface flex shrink-0 flex-wrap items-center justify-between gap-4 border-t p-5 md:p-6">
        <div>
          <span className="type-caption text-ink-subtle block">{t("course.price")}</span>
          <span className="flex items-baseline gap-2">
            <span className="type-title text-ink tabular">
              {course.price === 0
                ? t("common.free")
                : formatCurrency(course.price, course.currency)}
            </span>
            {hasDiscount && (
              <span className="type-body text-ink-subtle tabular line-through">
                {formatCurrency(course.originalPrice!, course.currency)}
              </span>
            )}
          </span>
        </div>

        <div className="flex flex-1 items-center justify-end gap-3">
          <Button className="max-md:hidden" size="lg" slot="close" variant="ghost">
            {t("course.close")}
          </Button>
          <Button
            className="px-10 max-md:flex-1"
            onPress={onEnroll}
            size="lg"
            variant="primary"
          >
            {t("course.enrollNow")}
          </Button>
        </div>
      </Dialog.Footer>
    </>
  );
}
