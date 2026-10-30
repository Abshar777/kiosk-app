"use client";

import type { PaymentMethod } from "@course-lms/shared";
import { Button, Table, Tabs, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { useState } from "react";
import {
  ChartFrame,
  ChartLegend,
  ColumnChart,
  RankBarChart,
  type ChartSeries,
  type ColumnDatum,
} from "@/components/admin/charts";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  TableSkeleton,
  useAdminQuery,
  type AdminQueryResult,
} from "@/components/admin/primitives";
import { RefreshIcon } from "@/components/icons";
import { adminApi } from "@/lib/api";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n/dictionaries";
import { useI18n } from "@/lib/i18n/provider";

/* -------------------------------------------------------------------------- */
/* Period                                                                     */
/* -------------------------------------------------------------------------- */

const PERIODS = ["daily", "weekly", "monthly"] as const;
type Period = (typeof PERIODS)[number];

const PERIOD_LABEL: Record<Period, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

/** What one column stands for, printed under the category axis. */
const PERIOD_AXIS_LABEL: Record<Period, string> = {
  daily: "Day",
  weekly: "Week",
  monthly: "Month",
};

/** How far back to ask for — a month of days, or a year of weeks and months. */
const BUCKET_LIMIT: Record<Period, number> = { daily: 30, weekly: 12, monthly: 12 };

const isPeriod = (value: string): value is Period =>
  (PERIODS as readonly string[]).includes(value);

const DAY_BUCKET = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_BUCKET = /^\d{4}-\d{2}$/;

/**
 * Bucket keys are not dates: weekly arrives as `2026-W44` and monthly as
 * `2026-10`, neither of which `new Date()` reads the way an operator would.
 * Only the daily key is a real date, so only it goes through formatDate.
 */
function bucketLabel(bucket: string, locale: Locale): string {
  if (DAY_BUCKET.test(bucket)) return formatDate(bucket, locale);

  if (MONTH_BUCKET.test(bucket)) {
    // format.ts has no month-and-year formatter, and formatDate() on the first
    // of the month would print "1 Oct 2026" for a row covering all of October.
    // Same locale mapping and Latin-digit policy as format.ts.
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-AE", {
      month: "short",
      numberingSystem: "latn",
      // The key is read back in the same zone it was built in. Without this a
      // browser behind UTC renders the 2026-10 bucket as "Sep 2026", because
      // UTC midnight on the 1st is still the previous month there.
      timeZone: "UTC",
      year: "numeric",
    }).format(new Date(`${bucket}-01T00:00:00Z`));
  }

  // ISO week keys are already readable, and an unrecognised key from a newer
  // API must still render as text rather than "Invalid Date".
  return bucket;
}

function PeriodSwitch({
  onChange,
  period,
}: {
  onChange: (period: Period) => void;
  period: Period;
}) {
  return (
    <ToggleButtonGroup
      aria-label="Report period"
      disallowEmptySelection
      onSelectionChange={(keys) => {
        const [next] = [...keys].map(String);
        if (next !== undefined && isPeriod(next)) onChange(next);
      }}
      selectedKeys={[period]}
      selectionMode="single"
    >
      {PERIODS.map((value) => (
        <ToggleButton className="min-h-11" id={value} key={value}>
          {PERIOD_LABEL[value]}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared panel plumbing                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The four states every admin view owes the operator, branched in the fixed
 * order documented on `useAdminQuery`.
 *
 * A period switch refetches without clearing the previous rows, so the loaded
 * branch also covers "showing the last answer while the next one lands" — it
 * dims rather than flashing a skeleton, and says so through `aria-busy`.
 */
function PanelBody<T>({
  children,
  isEmpty,
  query,
  skeleton,
}: {
  children: (data: T) => React.ReactNode;
  isEmpty: (data: T) => boolean;
  query: AdminQueryResult<T>;
  skeleton?: React.ReactNode;
}) {
  const { t } = useI18n();

  if (query.isLoading && query.data === null) return <>{skeleton ?? <TableSkeleton />}</>;
  if (query.error) return <ErrorState error={query.error} onRetry={query.reload} />;
  if (query.data === null || isEmpty(query.data)) {
    return (
      <EmptyState body={t("admin.state.empty.body")} title={t("admin.state.empty.title")} />
    );
  }

  return (
    <div
      aria-busy={query.isLoading || undefined}
      // Opacity only, so `prefers-reduced-motion` has nothing to object to.
      className={query.isLoading ? "opacity-60 transition-opacity" : undefined}
    >
      {children(query.data)}
    </div>
  );
}

interface ReportColumn {
  id: string;
  label: string;
  /** Numeric columns are end-aligned and tabular — design.md §7.6. */
  isNumeric?: boolean;
}

interface ReportRow {
  id: string;
  cells: React.ReactNode[];
  /** The totals row: same columns, read as a summary. */
  isTotal?: boolean;
}

/**
 * The figures behind the chart above it. A chart alone cannot be reconciled
 * against a bank statement, so every tab prints its numbers.
 */
function ReportTable({
  ariaLabel,
  columns,
  rows,
}: {
  ariaLabel: string;
  columns: ReportColumn[];
  rows: ReportRow[];
}) {
  return (
    <Table className="bg-surface rounded-card overflow-hidden" variant="secondary">
      <Table.ScrollContainer>
        <Table.Content aria-label={ariaLabel}>
          <Table.Header>
            {columns.map((column, index) => (
              <Table.Column
                className={`type-label text-ink-muted ${
                  column.isNumeric ? "text-end" : "text-start"
                }`}
                id={column.id}
                // React Aria needs exactly one header column per row.
                isRowHeader={index === 0}
                key={column.id}
              >
                {column.label}
              </Table.Column>
            ))}
          </Table.Header>

          <Table.Body>
            {rows.map((row) => (
              <Table.Row id={row.id} key={row.id}>
                {row.cells.map((cell, index) => {
                  const column = columns[index];
                  return (
                    <Table.Cell
                      className={`type-body h-16 ${
                        column?.isNumeric ? "tabular text-end" : "text-start"
                      } ${row.isTotal ? "text-ink font-semibold" : "text-ink"}`}
                      key={column?.id ?? index}
                    >
                      {cell}
                    </Table.Cell>
                  );
                })}
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

/** Gridlines land on quarters of a rounded axis top, which is not always a
 *  whole number of people. An unlabelled gridline beats a rounded lie. */
const formatCount = (value: number) => (Number.isInteger(value) ? formatNumber(value) : "");

const percent = (part: number, whole: number) =>
  whole > 0 ? `${formatNumber(Math.round((part / whole) * 100))}%` : "—";

/**
 * Compact money for the value axis.
 *
 * `formatCurrency` drops the decimals of a whole amount, which in compact
 * notation rounds to the nearest whole K: a 2,500 axis top printed as "3K"
 * (20% over the real maximum), and a 2,000 one labelling both its 1,500 and
 * 2,000 gridlines "2K". The gridlines are what the operator reads the bars
 * against, so they keep one decimal. Same Latin-digit locale as format.ts.
 */
const axisCurrency = (value: number, currency: string) =>
  new Intl.NumberFormat("en-AE", {
    currency,
    maximumFractionDigits: 1,
    notation: "compact",
    style: "currency",
  }).format(value);

/* -------------------------------------------------------------------------- */
/* Revenue                                                                    */
/* -------------------------------------------------------------------------- */

const REVENUE_SERIES: ChartSeries[] = [
  { key: "revenue", label: "Revenue", tone: "brand" },
  { key: "refunds", label: "Refunds", tone: "bad" },
];

function RevenuePanel({
  currency,
  nonce,
  onPeriodChange,
  period,
}: {
  currency: string;
  nonce: number;
  onPeriodChange: (period: Period) => void;
  period: Period;
}) {
  const { locale } = useI18n();
  const query = useAdminQuery(
    () => adminApi.revenueReport(period, BUCKET_LIMIT[period]),
    [period, nonce],
  );

  return (
    <div className="flex flex-col gap-4">
      <PeriodSwitch onChange={onPeriodChange} period={period} />

      <PanelBody isEmpty={(result) => result.rows.length === 0} query={query}>
        {(result) => {
          const totals = result.rows.reduce(
            (sum, row) => ({
              enrollments: sum.enrollments + row.enrollments,
              refunds: sum.refunds + row.refunds,
              revenue: sum.revenue + row.revenue,
            }),
            { enrollments: 0, refunds: 0, revenue: 0 },
          );

          const data: ColumnDatum[] = result.rows.map((row) => ({
            key: row.period,
            label: bucketLabel(row.period, locale),
            values: { refunds: row.refunds, revenue: row.revenue },
          }));

          return (
            <div className="flex flex-col gap-4">
              <ChartFrame
                // Not "the last N days": the report groups what it finds, so a
                // period with no payments is absent rather than a zero column.
                hint={`The ${formatNumber(result.rows.length)} most recent ${PERIOD_AXIS_LABEL[
                  period
                ].toLowerCase()}s with payments, taken against refunds.`}
                legend={<ChartLegend series={REVENUE_SERIES} />}
                title="Revenue"
              >
                <ColumnChart
                  ariaLabel={`Revenue and refunds per ${PERIOD_AXIS_LABEL[period].toLowerCase()}`}
                  categoryAxisLabel={PERIOD_AXIS_LABEL[period]}
                  data={data}
                  formatValue={(value) => axisCurrency(value, currency)}
                  series={REVENUE_SERIES}
                  valueAxisLabel={`Revenue (${currency})`}
                />
              </ChartFrame>

              <ReportTable
                ariaLabel="Revenue per period"
                columns={[
                  { id: "period", label: PERIOD_AXIS_LABEL[period] },
                  { id: "enrollments", isNumeric: true, label: "Enrollments" },
                  { id: "revenue", isNumeric: true, label: "Revenue" },
                  { id: "refunds", isNumeric: true, label: "Refunds" },
                  { id: "net", isNumeric: true, label: "Net" },
                ]}
                rows={[
                  ...result.rows.map((row) => ({
                    cells: [
                      bucketLabel(row.period, locale),
                      formatNumber(row.enrollments),
                      formatCurrency(row.revenue, currency),
                      row.refunds > 0 ? formatCurrency(row.refunds, currency) : "—",
                      formatCurrency(row.revenue - row.refunds, currency),
                    ],
                    id: row.period,
                  })),
                  {
                    cells: [
                      "Total",
                      formatNumber(totals.enrollments),
                      formatCurrency(totals.revenue, currency),
                      formatCurrency(totals.refunds, currency),
                      formatCurrency(totals.revenue - totals.refunds, currency),
                    ],
                    id: "__total",
                    isTotal: true,
                  },
                ]}
              />
            </div>
          );
        }}
      </PanelBody>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Enrollments                                                                */
/* -------------------------------------------------------------------------- */

/*
 * Stacked, not grouped: confirmed + failed + whatever is still open add up to
 * the total, so the column height is the total and the split is visible in the
 * same mark. "Open" is derived rather than reported — anything the API counts
 * in `enrollments` but in neither outcome.
 */
const ENROLLMENT_SERIES: ChartSeries[] = [
  { key: "confirmed", label: "Confirmed", tone: "ok" },
  { key: "failed", label: "Failed", tone: "bad" },
  { key: "open", label: "Open", tone: "neutral" },
];

function EnrollmentsPanel({
  nonce,
  onPeriodChange,
  period,
}: {
  nonce: number;
  onPeriodChange: (period: Period) => void;
  period: Period;
}) {
  const { locale } = useI18n();
  const query = useAdminQuery(() => adminApi.enrollmentReport(period), [period, nonce]);

  return (
    <div className="flex flex-col gap-4">
      <PeriodSwitch onChange={onPeriodChange} period={period} />

      <PanelBody isEmpty={(result) => result.rows.length === 0} query={query}>
        {(result) => {
          const totals = result.rows.reduce(
            (sum, row) => ({
              confirmed: sum.confirmed + row.confirmed,
              enrollments: sum.enrollments + row.enrollments,
              failed: sum.failed + row.failed,
            }),
            { confirmed: 0, enrollments: 0, failed: 0 },
          );

          const data: ColumnDatum[] = result.rows.map((row) => ({
            key: row.period,
            label: bucketLabel(row.period, locale),
            values: {
              confirmed: row.confirmed,
              failed: row.failed,
              open: Math.max(0, row.enrollments - row.confirmed - row.failed),
            },
          }));

          return (
            <div className="flex flex-col gap-4">
              <ChartFrame
                hint="Column height is every enrollment started in that period."
                legend={<ChartLegend series={ENROLLMENT_SERIES} />}
                title="Enrollments"
              >
                <ColumnChart
                  ariaLabel={`Enrollment outcomes per ${PERIOD_AXIS_LABEL[
                    period
                  ].toLowerCase()}`}
                  categoryAxisLabel={PERIOD_AXIS_LABEL[period]}
                  data={data}
                  formatValue={formatCount}
                  layout="stacked"
                  series={ENROLLMENT_SERIES}
                  valueAxisLabel="Enrollments"
                />
              </ChartFrame>

              <ReportTable
                ariaLabel="Enrollments per period"
                columns={[
                  { id: "period", label: PERIOD_AXIS_LABEL[period] },
                  { id: "total", isNumeric: true, label: "Started" },
                  { id: "confirmed", isNumeric: true, label: "Confirmed" },
                  { id: "failed", isNumeric: true, label: "Failed" },
                  { id: "rate", isNumeric: true, label: "Confirmed %" },
                ]}
                rows={[
                  ...result.rows.map((row) => ({
                    cells: [
                      bucketLabel(row.period, locale),
                      formatNumber(row.enrollments),
                      formatNumber(row.confirmed),
                      formatNumber(row.failed),
                      percent(row.confirmed, row.enrollments),
                    ],
                    id: row.period,
                  })),
                  {
                    cells: [
                      "Total",
                      formatNumber(totals.enrollments),
                      formatNumber(totals.confirmed),
                      formatNumber(totals.failed),
                      percent(totals.confirmed, totals.enrollments),
                    ],
                    id: "__total",
                    isTotal: true,
                  },
                ]}
              />
            </div>
          );
        }}
      </PanelBody>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Popular courses                                                            */
/* -------------------------------------------------------------------------- */

const POPULAR_LIMIT = 10;

function PopularCoursesPanel({ currency, nonce }: { currency: string; nonce: number }) {
  const query = useAdminQuery(() => adminApi.popularCourses(POPULAR_LIMIT), [nonce]);

  return (
    <PanelBody isEmpty={(rows) => rows.length === 0} query={query}>
      {(rows) => {
        const totals = rows.reduce(
          (sum, row) => ({
            enrollments: sum.enrollments + row.enrollments,
            revenue: sum.revenue + row.revenue,
          }),
          { enrollments: 0, revenue: 0 },
        );
        const peak = rows.reduce((max, row) => Math.max(max, row.enrollments), 0);

        return (
          <div className="flex flex-col gap-4">
            <ChartFrame
              hint={`The ${formatNumber(rows.length)} courses with the most enrollments.`}
              title="Popular courses"
            >
              <RankBarChart
                data={rows.map((row) => ({
                  key: row.courseId,
                  label: row.courseName,
                  value: row.enrollments,
                  valueLabel: formatNumber(row.enrollments),
                }))}
                scaleLabel={`Bar length is enrollments — the longest is ${formatNumber(peak)}.`}
              />
            </ChartFrame>

            <ReportTable
              ariaLabel="Popular courses"
              columns={[
                { id: "course", label: "Course" },
                { id: "enrollments", isNumeric: true, label: "Enrollments" },
                { id: "revenue", isNumeric: true, label: "Revenue" },
                { id: "share", isNumeric: true, label: "Share of revenue" },
              ]}
              rows={[
                ...rows.map((row) => ({
                  cells: [
                    row.courseName,
                    formatNumber(row.enrollments),
                    formatCurrency(row.revenue, currency),
                    percent(row.revenue, totals.revenue),
                  ],
                  id: row.courseId,
                })),
                {
                  cells: [
                    "Total",
                    formatNumber(totals.enrollments),
                    formatCurrency(totals.revenue, currency),
                    // These are the top courses only, so the shares above are a
                    // share of this subtotal, not of all revenue. With nothing
                    // taken there is no whole to be 100% of, and every row
                    // above reads "—".
                    totals.revenue > 0 ? "100%" : "—",
                  ],
                  id: "__total",
                  isTotal: true,
                },
              ]}
            />
          </div>
        );
      }}
    </PanelBody>
  );
}

/* -------------------------------------------------------------------------- */
/* Payment methods                                                            */
/* -------------------------------------------------------------------------- */

/** Partial by design: a method a newer API knows is listed by its raw id
 *  rather than dropped from the breakdown. */
const METHOD_LABEL: Partial<Record<PaymentMethod, string>> = {
  card: "Card (online)",
  card_present: "Card machine (in person)",
  netbanking: "Net banking",
  upi: "UPI",
};

function PaymentMethodsPanel({ currency, nonce }: { currency: string; nonce: number }) {
  const query = useAdminQuery(() => adminApi.paymentMethodBreakdown(), [nonce]);

  return (
    <PanelBody isEmpty={(rows) => rows.length === 0} query={query}>
      {(rows) => {
        const totals = rows.reduce(
          (sum, row) => ({ count: sum.count + row.count, revenue: sum.revenue + row.revenue }),
          { count: 0, revenue: 0 },
        );

        const label = (method: PaymentMethod) => METHOD_LABEL[method] ?? method;

        return (
          <div className="flex flex-col gap-4">
            <ChartFrame hint="Revenue taken through each method." title="Payment methods">
              <RankBarChart
                data={rows.map((row) => ({
                  key: row.method,
                  label: label(row.method),
                  value: row.revenue,
                  valueLabel: formatCurrency(row.revenue, currency),
                }))}
                scaleLabel={`Bar length is revenue — ${formatCurrency(
                  totals.revenue,
                  currency,
                )} in total.`}
              />
            </ChartFrame>

            <ReportTable
              ariaLabel="Payment method breakdown"
              columns={[
                { id: "method", label: "Method" },
                { id: "count", isNumeric: true, label: "Payments" },
                { id: "revenue", isNumeric: true, label: "Revenue" },
                { id: "share", isNumeric: true, label: "Share of revenue" },
              ]}
              rows={[
                ...rows.map((row) => ({
                  cells: [
                    label(row.method),
                    formatNumber(row.count),
                    formatCurrency(row.revenue, currency),
                    percent(row.revenue, totals.revenue),
                  ],
                  id: row.method,
                })),
                {
                  cells: [
                    "Total",
                    formatNumber(totals.count),
                    formatCurrency(totals.revenue, currency),
                    totals.revenue > 0 ? "100%" : "—",
                  ],
                  id: "__total",
                  isTotal: true,
                },
              ]}
            />
          </div>
        );
      }}
    </PanelBody>
  );
}

/* -------------------------------------------------------------------------- */
/* View                                                                       */
/* -------------------------------------------------------------------------- */

export function ReportsView() {
  const { t } = useI18n();
  const [tab, setTab] = useState<string>("revenue");
  const [period, setPeriod] = useState<Period>("daily");
  // Bumped by Refresh; every panel query depends on it, so one press refetches
  // whichever tab is open without each panel exposing a button of its own.
  const [nonce, setNonce] = useState(0);

  /*
   * The report rows carry amounts but never say which currency they are in, and
   * guessing a symbol is how a receipt ends up claiming the wrong money. Stats
   * is the one admin endpoint that states it, so it gates the whole view: no
   * figure is printed until the currency behind it is known.
   */
  const currencyQuery = useAdminQuery(() => adminApi.stats(), [nonce]);
  const stats = currencyQuery.data;

  return (
    <div>
      <PageHeader
        actions={
          <Button
            className="min-h-11"
            isDisabled={currencyQuery.isLoading}
            onPress={() => setNonce((count) => count + 1)}
            variant="secondary"
          >
            <RefreshIcon size={18} />
            {t("admin.action.refresh")}
          </Button>
        }
        description="Takings, enrollment outcomes and what students are signing up for."
        title={t("admin.nav.reports")}
      />

      {stats === null ? (
        currencyQuery.error ? (
          <ErrorState error={currencyQuery.error} onRetry={currencyQuery.reload} />
        ) : (
          <TableSkeleton columns={4} rows={5} />
        )
      ) : (
        <Tabs
          onSelectionChange={(key) => {
            if (key !== null) setTab(String(key));
          }}
          selectedKey={tab}
        >
          <Tabs.ListContainer className="mb-5">
            {/* `Tabs.Indicator` is the whole selected-tab affordance: the
                library's `.tabs__indicator` is the white pill behind the tab
                label, and `.tabs__tab[data-selected]` only darkens the text.
                Without it the open tab differs from the other three by text
                colour alone, on the same accent fill. It belongs inside the
                tab — react-aria's Tab is what tells it whether it is shown. */}
            <Tabs.List aria-label="Reports">
              <Tabs.Tab className="min-h-11" id="revenue">
                <Tabs.Indicator />
                Revenue
              </Tabs.Tab>
              <Tabs.Tab className="min-h-11" id="enrollments">
                <Tabs.Indicator />
                {t("admin.nav.enrollments")}
              </Tabs.Tab>
              <Tabs.Tab className="min-h-11" id="courses">
                <Tabs.Indicator />
                Popular courses
              </Tabs.Tab>
              <Tabs.Tab className="min-h-11" id="methods">
                <Tabs.Indicator />
                Payment methods
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>

          {/* Only the open panel mounts, so a tab is not fetched until asked for. */}
          <Tabs.Panel id="revenue">
            <RevenuePanel
              currency={stats.currency}
              nonce={nonce}
              onPeriodChange={setPeriod}
              period={period}
            />
          </Tabs.Panel>

          <Tabs.Panel id="enrollments">
            <EnrollmentsPanel nonce={nonce} onPeriodChange={setPeriod} period={period} />
          </Tabs.Panel>

          <Tabs.Panel id="courses">
            <PopularCoursesPanel currency={stats.currency} nonce={nonce} />
          </Tabs.Panel>

          <Tabs.Panel id="methods">
            <PaymentMethodsPanel currency={stats.currency} nonce={nonce} />
          </Tabs.Panel>
        </Tabs>
      )}
    </div>
  );
}
