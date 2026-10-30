"use client";

import { useI18n } from "@/lib/i18n/provider";

/* -------------------------------------------------------------------------- */
/* Tones                                                                      */
/* -------------------------------------------------------------------------- */

export type ChartTone = "brand" | "slate" | "ok" | "bad" | "warn" | "neutral";

/** SVG marks take `fill-*`; the HTML legend swatches and bars take `bg-*`. */
const BAR_FILL: Record<ChartTone, string> = {
  brand: "fill-brand",
  slate: "fill-slate",
  ok: "fill-ok",
  bad: "fill-bad",
  warn: "fill-warn",
  neutral: "fill-ink-subtle",
};

const BAR_BG: Record<ChartTone, string> = {
  brand: "bg-brand",
  slate: "bg-slate",
  ok: "bg-ok",
  bad: "bg-bad",
  warn: "bg-warn",
  neutral: "bg-ink-subtle",
};

/* -------------------------------------------------------------------------- */
/* Scale                                                                      */
/* -------------------------------------------------------------------------- */

const NICE_STEPS = [1, 2, 2.5, 5, 10];

/**
 * Rounds the axis top up to a figure an operator can read off a gridline.
 *
 * Returns 1 for an empty, zero or non-finite series. Every scale calculation
 * downstream divides by this, so it must never be 0 — an all-zero day is a
 * normal reading at a kiosk, not an error, and it has to render as a flat
 * baseline rather than a blank box or a column of NaNs.
 */
function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = NICE_STEPS.find((candidate) => value <= candidate * magnitude) ?? 10;
  return step * magnitude;
}

/* -------------------------------------------------------------------------- */
/* Frame + legend                                                             */
/* -------------------------------------------------------------------------- */

export function ChartFrame({
  title,
  hint,
  legend,
  children,
}: {
  title: string;
  hint?: string;
  legend?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface rounded-card p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/* h2: the only heading above it is the page title in PageHeader. */}
          <h2 className="type-subheading text-ink">{title}</h2>
          {hint !== undefined && <p className="type-caption text-ink-muted mt-1">{hint}</p>}
        </div>
        {legend}
      </div>
      {children}
    </section>
  );
}

export interface ChartSeries {
  key: string;
  label: string;
  tone: ChartTone;
}

export function ChartLegend({ series }: { series: ChartSeries[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-4">
      {series.map((entry) => (
        <li className="flex items-center gap-2" key={entry.key}>
          <span
            aria-hidden="true"
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${BAR_BG[entry.tone]}`}
          />
          <span className="type-caption text-ink-muted">{entry.label}</span>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Column chart                                                              */
/* -------------------------------------------------------------------------- */

export interface ColumnDatum {
  key: string;
  /** Tick text under the column. Thinned automatically when buckets crowd. */
  label: string;
  values: Record<string, number>;
}

/*
 * One fixed viewBox, scaled by CSS. Width is not measured, so the chart needs
 * no resize observer and renders identically on the server and the client.
 */
const VIEW_W = 720;
const VIEW_H = 280;
const PAD_TOP = 14;
const PAD_BOTTOM = 42;
const PAD_AXIS = 76; // the value-axis gutter, on whichever side `dir` puts it
const PAD_EDGE = 12;

const PLOT_W = VIEW_W - PAD_AXIS - PAD_EDGE;
const PLOT_H = VIEW_H - PAD_TOP - PAD_BOTTOM;
const BASELINE_Y = PAD_TOP + PLOT_H;
const TICK_FRACTIONS = [0, 0.25, 0.5, 0.75, 1];

/** At most this many ticks on the category axis before labels are thinned. */
const MAX_CATEGORY_LABELS = 8;

const BAR_GAP = 3;
/** Below this, a grouped bar is thinner than the gap beside it — so drop the gap. */
const MIN_GAPPED_BAR = BAR_GAP + 2;

/**
 * Hand-rolled column chart — grouped or stacked.
 *
 * The figures live in the table below it; this is the shape of the trend, so it
 * carries no tooltips and nothing is hover-only (design.md §6). SVG does not
 * mirror under `dir="rtl"`, so the time axis is laid out from the end edge
 * instead and the value axis moves with it — otherwise an Arabic operator reads
 * the oldest bucket where they expect the newest.
 */
export function ColumnChart({
  ariaLabel,
  categoryAxisLabel,
  data,
  formatValue,
  layout = "grouped",
  series,
  valueAxisLabel,
}: {
  ariaLabel: string;
  categoryAxisLabel: string;
  data: ColumnDatum[];
  formatValue: (value: number) => string;
  layout?: "grouped" | "stacked";
  series: ChartSeries[];
  valueAxisLabel: string;
}) {
  const { dir } = useI18n();
  const isRtl = dir === "rtl";

  if (data.length === 0) return null;

  const total = (datum: ColumnDatum) =>
    series.reduce((sum, entry) => sum + (datum.values[entry.key] ?? 0), 0);

  // Stacked columns are as tall as their sum; grouped ones only as tall as
  // their largest single bar.
  const peak = data.reduce((highest, datum) => {
    const candidate =
      layout === "stacked"
        ? total(datum)
        : series.reduce((max, entry) => Math.max(max, datum.values[entry.key] ?? 0), 0);
    return Math.max(highest, candidate);
  }, 0);

  const axisMax = niceCeil(peak);
  const scale = (value: number) => (Math.max(value, 0) / axisMax) * PLOT_H;

  // Nothing happened in this window. Keep the baseline and its zero, and drop
  // the gridlines — quartering the fallback axis top would print a ladder of
  // amounts that were never taken.
  const tickFractions = peak > 0 ? TICK_FRACTIONS : [0];

  const plotStart = isRtl ? PAD_EDGE : PAD_AXIS;
  const plotEnd = isRtl ? VIEW_W - PAD_AXIS : VIEW_W - PAD_EDGE;
  const band = PLOT_W / data.length;

  const bandStart = (index: number) =>
    isRtl ? plotEnd - (index + 1) * band : plotStart + index * band;

  // A single bucket must not become one bar the width of the chart, so the
  // drawn slot is capped independently of the band it sits in.
  const slotWidth = Math.min(band * 0.7, layout === "stacked" ? 64 : 24 * series.length + 48);
  const barCount = layout === "stacked" ? 1 : series.length;
  // The gap is the first thing to give when buckets crowd. Reserving it
  // unconditionally would push the outermost bar past the plot edge once the
  // band drops below a few pixels, so a tight slot gets touching bars instead.
  const gap = barCount > 1 && slotWidth / barCount > MIN_GAPPED_BAR ? BAR_GAP : 0;
  const barWidth = (slotWidth - gap * (barCount - 1)) / barCount;

  const labelEvery = Math.max(1, Math.ceil(data.length / MAX_CATEGORY_LABELS));

  // The final label is worth showing — it dates the right edge of the chart —
  // but only when thinning has not already drawn one close enough to collide
  // with it. Forcing it unconditionally overlaps the two into mush.
  const lastLabelled = Math.floor((data.length - 1) / labelEvery) * labelEvery;
  const showLastLabel = data.length - 1 - lastLabelled >= Math.ceil(labelEvery / 2);

  return (
    <div>
      <p className="type-caption text-ink-subtle mb-1">{valueAxisLabel}</p>

      <svg
        aria-label={ariaLabel}
        className="w-full"
        role="img"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      >
        {tickFractions.map((fraction) => {
          const y = BASELINE_Y - fraction * PLOT_H;
          return (
            <g key={fraction}>
              <line
                className={fraction === 0 ? "stroke-ink-subtle" : "stroke-hairline"}
                x1={plotStart}
                x2={plotEnd}
                y1={y}
                y2={y}
              />
              <text
                className="fill-ink-subtle"
                dominantBaseline="middle"
                fontSize={11}
                textAnchor={isRtl ? "start" : "end"}
                x={isRtl ? plotEnd + 10 : plotStart - 10}
                y={y}
              >
                {formatValue(axisMax * fraction)}
              </text>
            </g>
          );
        })}

        {data.map((datum, index) => {
          const slotX = bandStart(index) + (band - slotWidth) / 2;
          let stackedTop = BASELINE_Y;

          return (
            <g key={datum.key}>
              {series.map((entry, seriesIndex) => {
                const height = scale(datum.values[entry.key] ?? 0);
                // A zero reading draws nothing: a 1px stub would read as a
                // small sale rather than none at all.
                if (height <= 0) return null;

                const x =
                  layout === "stacked" ? slotX : slotX + seriesIndex * (barWidth + gap);
                const y = layout === "stacked" ? stackedTop - height : BASELINE_Y - height;
                if (layout === "stacked") stackedTop -= height;

                return (
                  <rect
                    className={BAR_FILL[entry.tone]}
                    height={height}
                    key={entry.key}
                    rx={2}
                    width={barWidth}
                    x={x}
                    y={y}
                  />
                );
              })}

              {(index % labelEvery === 0 ||
                (index === data.length - 1 && showLastLabel)) && (
                <text
                  className="fill-ink-subtle"
                  fontSize={11}
                  textAnchor="middle"
                  x={bandStart(index) + band / 2}
                  y={BASELINE_Y + 20}
                >
                  {datum.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <p className="type-caption text-ink-subtle mt-1 text-center">{categoryAxisLabel}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Ranked bar chart                                                          */
/* -------------------------------------------------------------------------- */

export interface RankDatum {
  key: string;
  label: string;
  value: number;
  /** Pre-formatted, so the caller owns currency and digit grouping. */
  valueLabel: string;
  tone?: ChartTone;
}

/**
 * Horizontal bars in plain CSS rather than SVG: course names are long and
 * sometimes Arabic, and `inline-size` on a block track mirrors under RTL for
 * free, which an SVG `x` offset does not.
 */
export function RankBarChart({
  data,
  scaleLabel,
}: {
  data: RankDatum[];
  scaleLabel: string;
}) {
  const peak = data.reduce((max, datum) => Math.max(max, datum.value), 0);

  return (
    <div>
      <ol className="flex flex-col gap-4">
        {data.map((datum, index) => {
          // An all-zero series has no peak to divide by; every bar is simply empty.
          const ratio = peak > 0 ? Math.max(datum.value, 0) / peak : 0;

          return (
            <li key={datum.key}>
              <div className="flex items-baseline justify-between gap-4">
                <span className="type-body text-ink min-w-0 truncate">
                  <span className="text-ink-subtle tabular me-2">{index + 1}</span>
                  {datum.label}
                </span>
                <span className="type-label text-ink tabular shrink-0">{datum.valueLabel}</span>
              </div>
              <div className="bg-surface-sunken mt-2 h-2.5 overflow-hidden rounded-full">
                <div
                  className={`h-full rounded-full ${BAR_BG[datum.tone ?? "brand"]}`}
                  // 2% floor so the smallest non-zero figure still leaves a mark.
                  style={{ inlineSize: ratio === 0 ? 0 : `${Math.max(ratio * 100, 2)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ol>

      <p className="type-caption text-ink-subtle mt-4">{scaleLabel}</p>
    </div>
  );
}
