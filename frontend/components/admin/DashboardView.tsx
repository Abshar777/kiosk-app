"use client";

import type { ActivityLog, LogEvent, PopularCourseRow } from "@course-lms/shared";
import { Button, Skeleton, Spinner } from "@heroui/react";
import Link from "next/link";
import { useMemo } from "react";
import { AlertIcon, RefreshIcon } from "@/components/icons";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  StatCard,
  useAdminQuery,
} from "@/components/admin/primitives";
import type { ApiRequestError } from "@/lib/api";
import { adminApi } from "@/lib/api";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";

/* -------------------------------------------------------------------------- */
/* Relative time                                                              */
/* -------------------------------------------------------------------------- */

/** Largest first, so the first unit that fits is the one worth naming. */
const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_557_600_000],
  ["month", 2_629_800_000],
  ["week", 604_800_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/**
 * One formatter per locale rather than one per log row.
 *
 * Latin digits are forced in Arabic for the same reason prices are (design.md
 * §9) — an operator reading a timestamp off the screen to support should be
 * reading the same glyphs the server logged.
 */
function useRelativeTime(): (iso: string) => string {
  const { locale } = useI18n();

  return useMemo(() => {
    const format = new Intl.RelativeTimeFormat(
      locale === "ar" ? "ar-AE-u-nu-latn" : "en-AE",
      { numeric: "auto" },
    );

    return (iso: string): string => {
      const at = new Date(iso).getTime();
      // A timestamp this build cannot parse is still better shown than hidden.
      if (Number.isNaN(at)) return iso;

      const elapsed = at - Date.now();
      const magnitude = Math.abs(elapsed);

      for (const [unit, size] of RELATIVE_UNITS) {
        if (magnitude >= size) return format.format(Math.round(elapsed / size), unit);
      }
      return format.format(Math.round(elapsed / 1000), "second");
    };
  }, [locale]);
}

/* -------------------------------------------------------------------------- */
/* Activity vocabulary                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Typed against `LogEvent` on purpose: an event added to shared/src/index.ts
 * breaks this build rather than reaching an operator as a raw dotted string.
 */
const EVENT_LABEL: Record<LogEvent, string> = {
  "enrollment.created": "Enrollment started",
  "enrollment.confirmed": "Enrollment confirmed",
  "enrollment.failed": "Enrollment failed",
  "payment.initiated": "Payment started",
  "payment.succeeded": "Payment succeeded",
  "payment.failed": "Payment failed",
  "payment.refunded": "Payment refunded",
  "pos.sale.started": "Card machine sale started",
  "pos.sale.failed": "Card machine sale declined",
  "pos.sale.error": "Card machine error",
  "pos.sale.unsettled": "Card machine sale unsettled",
  "course.created": "Course created",
  "course.updated": "Course updated",
  "course.deleted": "Course deleted",
  "course.status_changed": "Course status changed",
};

type EventTone = "ok" | "bad" | "warn" | "neutral";

const EVENT_TONE: Partial<Record<LogEvent, EventTone>> = {
  "enrollment.confirmed": "ok",
  "payment.succeeded": "ok",
  "enrollment.failed": "bad",
  "payment.failed": "bad",
  "pos.sale.failed": "bad",
  "pos.sale.error": "bad",
  // Money took at the terminal that the gateway has not settled needs chasing,
  // which is a warning, not a failure.
  "pos.sale.unsettled": "warn",
};

const TONE_DOT: Record<EventTone, string> = {
  ok: "bg-ok",
  bad: "bg-bad",
  warn: "bg-warn",
  neutral: "bg-ink-subtle",
};

/** A server newer than this build can log an event the map above never heard of. */
function eventLabel(event: LogEvent): string {
  const known = (EVENT_LABEL as Record<string, string | undefined>)[event];
  return known ?? event.replace(/[._]/g, " ");
}

/* -------------------------------------------------------------------------- */
/* Panels                                                                     */
/* -------------------------------------------------------------------------- */

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface rounded-card p-6">
      <h2 className="type-heading text-ink">{title}</h2>
      {description !== undefined && (
        <p className="type-body text-ink-muted mt-1">{description}</p>
      )}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** Rows of a list, not a table: same hairline rhythm, no header to carry. */
function RowSkeleton({ rows }: { rows: number }) {
  const { t } = useI18n();

  return (
    <div aria-busy="true" aria-label={t("admin.state.loading")} role="status">
      {Array.from({ length: rows }, (_, row) => (
        <div
          className={`flex items-center gap-4 py-3 ${row > 0 ? "border-hairline border-t" : ""}`}
          key={row}
        >
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <Skeleton className="h-4 flex-1 rounded-full" />
          <Skeleton className="h-4 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function StatTilesSkeleton() {
  const { t } = useI18n();

  return (
    <div
      aria-busy="true"
      aria-label={t("admin.state.loading")}
      className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
      role="status"
    >
      {Array.from({ length: 5 }, (_, tile) => (
        <div className="bg-surface rounded-card p-6" key={tile}>
          <Skeleton className="h-3 w-24 rounded-full" />
          <Skeleton className="mt-3 h-7 w-32 rounded-full" />
          <Skeleton className="mt-3 h-3 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function PopularCourses({
  rows,
  currency,
}: {
  rows: PopularCourseRow[];
  currency: string | null;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        body="Courses appear here once students start enrolling."
        title="No enrollments yet"
      />
    );
  }

  return (
    <ol>
      {rows.map((row, index) => (
        <li
          className={`flex items-center gap-4 py-3 ${
            index > 0 ? "border-hairline border-t" : ""
          }`}
          /*
           * Keyed by the group the server actually returned, not by course
           * id alone: the report groups by (course_id, course_name) over a
           * denormalised enrollment snapshot, so a renamed course comes back
           * as two rows sharing one id.
           */
          key={`${row.courseId}:${row.courseName}`}
        >
          <span className="bg-surface-sunken text-ink-muted type-caption tabular grid h-8 w-8 shrink-0 place-items-center rounded-full">
            {index + 1}
          </span>

          <div className="min-w-0 flex-1">
            <p className="type-body text-ink truncate">{row.courseName}</p>
            <p className="type-caption text-ink-subtle tabular mt-0.5">
              {`${formatNumber(row.enrollments)} enrollments`}
            </p>
          </div>

          {/*
           * The row carries an amount but no currency of its own, so it is
           * printed only once the stats call has said which currency the
           * academy takes — a guessed symbol on a money figure is worse than
           * no figure.
           */}
          {currency !== null && (
            <p className="type-label text-ink tabular shrink-0 text-end">
              {formatCurrency(row.revenue, currency)}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

function RecentActivity({ logs }: { logs: ActivityLog[] }) {
  const { locale } = useI18n();
  const relative = useRelativeTime();

  if (logs.length === 0) {
    return (
      <EmptyState
        body="Enrollments, payments and course edits are recorded here."
        title="Nothing has happened yet"
      />
    );
  }

  return (
    <ul>
      {logs.map((log, index) => (
        <li
          className={`flex items-start gap-3 py-3 ${
            index > 0 ? "border-hairline border-t" : ""
          }`}
          key={log.id}
        >
          <span
            aria-hidden="true"
            className={`mt-2 h-2 w-2 shrink-0 rounded-full ${
              TONE_DOT[EVENT_TONE[log.event] ?? "neutral"]
            }`}
          />

          <div className="min-w-0 flex-1">
            <p className="type-label text-ink">{eventLabel(log.event)}</p>
            <p className="type-caption text-ink-muted mt-0.5 break-words">{log.message}</p>
          </div>

          {/* Relative reads faster when scanning; the exact stamp stays in the
              markup for anyone who needs to quote it. */}
          <time
            className="type-caption text-ink-subtle tabular shrink-0"
            dateTime={log.createdAt}
            title={formatDateTime(log.createdAt, locale)}
          >
            {relative(log.createdAt)}
          </time>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Session expiry                                                             */
/* -------------------------------------------------------------------------- */

/**
 * AdminAuthGate only checks the session on mount, so a cookie that expires
 * while the panel is open surfaces here first — as three identical 401s. Saying
 * so beats three "Something went wrong" cards the operator cannot act on.
 */
function SessionExpiredNotice() {
  return (
    <div
      className="bg-bad-bg text-bad rounded-control type-body mb-6 flex flex-wrap items-center gap-2 p-4"
      role="alert"
    >
      <AlertIcon size={18} />
      <span>Your admin session has expired.</span>
      <Link
        className="type-label rounded-control ring-focus ms-auto flex min-h-11 items-center px-3 underline"
        data-ripple
        href="/admin/login"
      >
        Sign in again
      </Link>
    </div>
  );
}

const isSessionExpired = (error: ApiRequestError | null): boolean => error?.status === 401;

/* -------------------------------------------------------------------------- */
/* View                                                                       */
/* -------------------------------------------------------------------------- */

export function DashboardView() {
  const { t } = useI18n();

  const stats = useAdminQuery(() => adminApi.stats());
  const popular = useAdminQuery(() => adminApi.popularCourses(5));
  const activity = useAdminQuery(() => adminApi.logs({ limit: 8 }));

  const isBusy = stats.isLoading || popular.isLoading || activity.isLoading;

  /*
   * `request()` resolves `undefined`, not `null`, for a 200 that carries no
   * JSON body — a proxy's HTML error page in front of the API is the realistic
   * case on a kiosk. A strict `=== null` test lets that through to the tiles
   * below, which then dereference it and take the whole route down, so the
   * payload is normalised to null once here.
   */
  const summary = stats.data ?? null;

  const refreshAll = () => {
    stats.reload();
    popular.reload();
    activity.reload();
  };

  const sessionExpired =
    isSessionExpired(stats.error) ||
    isSessionExpired(popular.error) ||
    isSessionExpired(activity.error);

  return (
    <div>
      <PageHeader
        actions={
          <Button className="min-h-11" isDisabled={isBusy} onPress={refreshAll} variant="secondary">
            {isBusy ? <Spinner size="sm" /> : <RefreshIcon size={18} />}
            {t("admin.action.refresh")}
          </Button>
        }
        description="Today's activity and the totals behind it."
        title={t("admin.nav.dashboard")}
      />

      {sessionExpired && <SessionExpiredNotice />}

      {/* Each block owns its own four states, so one failed endpoint never
          blanks the whole dashboard. */}
      {stats.isLoading && summary === null ? (
        <StatTilesSkeleton />
      ) : stats.error ? (
        <ErrorState error={stats.error} onRetry={stats.reload} />
      ) : summary === null ? null : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <StatCard
            hint={`${formatNumber(summary.activeCourses)} active`}
            label="Total courses"
            value={formatNumber(summary.totalCourses)}
          />
          <StatCard
            label="Total enrollments"
            value={formatNumber(summary.totalEnrollments)}
          />
          <StatCard
            label="Total revenue"
            value={formatCurrency(summary.totalRevenue, summary.currency)}
          />
          <StatCard
            hint="Since midnight"
            label="Today's enrollments"
            value={formatNumber(summary.todayEnrollments)}
          />
          <StatCard
            hint="Since midnight"
            label="Today's revenue"
            value={formatCurrency(summary.todayRevenue, summary.currency)}
          />
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel description="By enrollments taken." title="Popular courses">
          {popular.isLoading && popular.data === null ? (
            <RowSkeleton rows={5} />
          ) : popular.error ? (
            <ErrorState error={popular.error} onRetry={popular.reload} />
          ) : (
            <PopularCourses
              currency={summary?.currency ?? null}
              rows={popular.data ?? []}
            />
          )}
        </Panel>

        <Panel description="The last few things the kiosk recorded." title="Recent activity">
          {activity.isLoading && activity.data === null ? (
            <RowSkeleton rows={6} />
          ) : activity.error ? (
            <ErrorState error={activity.error} onRetry={activity.reload} />
          ) : (
            <RecentActivity logs={activity.data ?? []} />
          )}
        </Panel>
      </div>
    </div>
  );
}
