"use client";

import { Button, Modal, Pagination, Skeleton, Spinner } from "@heroui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshIcon,
  SearchIcon,
  WifiOffIcon,
} from "@/components/icons";
import { ApiRequestError } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { dictionaries, type TranslationKey } from "@/lib/i18n/dictionaries";
import { useI18n } from "@/lib/i18n/provider";

/* -------------------------------------------------------------------------- */
/* Data loading                                                               */
/* -------------------------------------------------------------------------- */

export interface AdminQueryResult<T> {
  data: T | null;
  error: ApiRequestError | null;
  isLoading: boolean;
  reload: () => void;
  /** Patch the cached result in place, so a row edit needs no round trip. */
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

/** Anything thrown that isn't already an ApiRequestError is a client-side bug,
 *  not an offline kiosk — give it a status that keeps `isNetworkError` false. */
function toApiError(cause: unknown): ApiRequestError {
  if (cause instanceof ApiRequestError) return cause;
  return new ApiRequestError(
    500,
    "unknown",
    cause instanceof Error ? cause.message : String(cause),
  );
}

/**
 * The single data-fetching contract for every admin view.
 *
 * `data`, `error` and `isLoading` are mutually exclusive by construction: a
 * start clears the error, a success clears it too, and a failure clears the
 * data. Views can therefore branch in one fixed order without guarding for
 * impossible combinations:
 *
 *   isLoading && !data  → <TableSkeleton />
 *   error               → <ErrorState error onRetry={reload} />
 *   empty result        → <EmptyState />
 *   otherwise           → the content
 *
 * `deps` drives refetching exactly like `useEffect` — and, like `useEffect`, it
 * must keep a constant length between renders. The loader itself is read from a
 * ref, so passing an inline arrow does not cause a refetch loop.
 */
export function useAdminQuery<T>(
  loader: () => Promise<T>,
  deps: React.DependencyList = [],
): AdminQueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadCount, setReloadCount] = useState(0);

  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  // Guards against a slow earlier request overwriting a newer result.
  const requestSeq = useRef(0);

  useEffect(() => {
    const seq = ++requestSeq.current;
    setIsLoading(true);
    setError(null);

    void loaderRef.current().then(
      (result) => {
        if (seq !== requestSeq.current) return;
        setData(result);
        setIsLoading(false);
      },
      (cause: unknown) => {
        if (seq !== requestSeq.current) return;
        setError(toApiError(cause));
        setData(null);
        setIsLoading(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadCount]);

  const reload = useCallback(() => setReloadCount((count) => count + 1), []);

  return { data, error, isLoading, reload, setData };
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                     */
/* -------------------------------------------------------------------------- */

export type StatTone = "neutral" | "ok" | "warn" | "bad" | "brand";

const STAT_TONE_CLASS: Record<StatTone, string> = {
  neutral: "text-ink",
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
  brand: "text-brand",
};

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: StatTone;
}) {
  return (
    <div className="bg-surface rounded-card p-6">
      <p className="type-caption text-ink-muted">{label}</p>
      <p className={`type-title tabular mt-2 ${STAT_TONE_CLASS[tone]}`}>{value}</p>
      {hint !== undefined && <p className="type-caption text-ink-subtle mt-2">{hint}</p>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="type-title text-ink">{title}</h1>
        {description !== undefined && (
          <p className="type-body text-ink-muted mt-1">{description}</p>
        )}
      </div>
      {actions !== undefined && (
        <div className="flex flex-wrap items-center gap-3">{actions}</div>
      )}
    </div>
  );
}

/**
 * The filter/search row above a table. Children are laid out end-aligned so a
 * label-above-control field (the house pattern) lines up with a bare button.
 */
export function Toolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-card mb-4 flex flex-wrap items-end gap-3 p-4">
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Loading / empty / error                                                    */
/* -------------------------------------------------------------------------- */

export function TableSkeleton({
  rows = 6,
  columns = 5,
}: {
  rows?: number;
  columns?: number;
}) {
  const { t } = useI18n();

  return (
    <div
      aria-busy="true"
      aria-label={t("admin.state.loading")}
      className="bg-surface rounded-card overflow-hidden"
      role="status"
    >
      <div className="bg-surface-sunken flex items-center gap-4 px-5 py-4">
        {Array.from({ length: columns }, (_, column) => (
          <Skeleton className="h-3.5 flex-1 rounded-full" key={column} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div className="border-hairline flex items-center gap-4 border-t px-5 py-5" key={row}>
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton className="h-4 flex-1 rounded-full" key={column} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-surface rounded-card flex flex-col items-center gap-3 p-10 text-center">
      <span className="bg-surface-sunken text-ink-subtle grid h-14 w-14 place-items-center rounded-full">
        <SearchIcon size={24} />
      </span>
      <p className="type-heading text-ink mt-1">{title}</p>
      {body !== undefined && <p className="type-body text-ink-muted max-w-md">{body}</p>}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * An unreachable API and a rejected request need different advice: one is fixed
 * at the network, the other by whoever operates the panel. The server's own
 * message is shown for the second case — admins can act on it, students never
 * see it.
 */
export function ErrorState({
  error,
  onRetry,
}: {
  error: ApiRequestError;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const isOffline = error.isNetworkError;

  return (
    <div
      className="bg-surface rounded-card flex flex-col items-center gap-4 p-10 text-center"
      role="alert"
    >
      <span
        className={`grid h-14 w-14 place-items-center rounded-full ${
          isOffline ? "bg-warn-bg text-warn" : "bg-bad-bg text-bad"
        }`}
      >
        {isOffline ? <WifiOffIcon size={24} /> : <AlertTriangleIcon size={24} />}
      </span>

      <div className="max-w-md">
        <p className="type-heading text-ink">
          {isOffline ? t("admin.state.offline.title") : t("admin.state.error.title")}
        </p>
        <p className="type-body text-ink-muted mt-1">
          {isOffline
            ? t("admin.state.offline.body")
            : error.message || t("admin.state.error.body")}
        </p>
      </div>

      <Button className="min-h-11" onPress={onRetry} variant="secondary">
        <RefreshIcon size={18} />
        {t("admin.action.retry")}
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

type StatusTone = "ok" | "warn" | "bad" | "neutral";

const STATUS_TONE: Record<string, StatusTone> = {
  success: "ok",
  paid: "ok",
  confirmed: "ok",
  active: "ok",

  pending: "warn",
  processing: "warn",

  failed: "bad",
  cancelled: "bad",

  refunded: "neutral",
  draft: "neutral",
  inactive: "neutral",
  archived: "neutral",
};

const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  bad: "bg-bad-bg text-bad",
  neutral: "bg-surface-sunken text-ink-muted",
};

/**
 * Rendered as a plain span rather than a HeroUI Chip so the fill comes straight
 * from our `-bg` status tokens (design.md §7.7) instead of the library's own
 * soft-variant colour maths.
 *
 * `status` is typed loosely on purpose: it arrives from the API, and a status
 * this build has never heard of must still render as readable text.
 */
export function StatusChip({ status }: { status: string }) {
  const { t } = useI18n();

  const tone = STATUS_TONE[status] ?? "neutral";
  const key = `admin.status.${status}` as TranslationKey;
  const label = key in dictionaries.en ? t(key) : status;

  return (
    <span
      className={`type-caption inline-flex h-7 items-center rounded-full px-3 font-semibold ${STATUS_TONE_CLASS[tone]}`}
    >
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Confirmation                                                               */
/* -------------------------------------------------------------------------- */

export type ConfirmTone = "danger" | "primary";

/**
 * The second tap every destructive admin action needs (design.md §6).
 *
 * `onConfirm` may be async; the dialog stays open and disabled while it runs
 * and only closes on success, so a failed delete leaves the operator looking at
 * the thing they tried to delete rather than at a list that silently didn't
 * change.
 */
export function ConfirmDialog({
  isOpen,
  onOpenChange,
  title,
  body,
  confirmLabel,
  tone = "danger",
  onConfirm,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  tone?: ConfirmTone;
  onConfirm: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [isBusy, setIsBusy] = useState(false);

  const confirm = async () => {
    setIsBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Modal.Backdrop isDismissable={!isBusy} isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container className="p-4" placement="center" scroll="inside" size="sm">
        <Modal.Dialog className="w-full">
          <Modal.Header>
            <Modal.Heading className="type-heading text-ink">{title}</Modal.Heading>
          </Modal.Header>

          {body !== undefined && (
            <Modal.Body className="type-body text-ink-muted">{body}</Modal.Body>
          )}

          <Modal.Footer className="gap-3">
            <Button
              className="min-h-11"
              isDisabled={isBusy}
              onPress={() => onOpenChange(false)}
              variant="secondary"
            >
              {t("admin.action.cancel")}
            </Button>
            <Button
              className="min-h-11"
              isDisabled={isBusy}
              onPress={() => void confirm()}
              variant={tone === "danger" ? "danger" : "primary"}
            >
              {isBusy && <Spinner size="sm" />}
              {confirmLabel ?? t("admin.action.confirm")}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                 */
/* -------------------------------------------------------------------------- */

const ELLIPSIS = "…";

/** First, last, current and its neighbours; everything else is elided. */
function pageWindow(current: number, totalPages: number): (number | typeof ELLIPSIS)[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

  const wanted = new Set([1, totalPages, current - 1, current, current + 1]);
  // Keep the strip a constant width, so it doesn't jump as you page through.
  if (current <= 3) [2, 3, 4].forEach((page) => wanted.add(page));
  if (current >= totalPages - 2)
    [totalPages - 3, totalPages - 2, totalPages - 1].forEach((page) => wanted.add(page));

  const pages = [...wanted].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);

  const out: (number | typeof ELLIPSIS)[] = [];
  pages.forEach((page, index) => {
    if (index > 0 && page - pages[index - 1] > 1) out.push(ELLIPSIS);
    out.push(page);
  });
  return out;
}

export function Pager({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useI18n();

  if (total === 0) return null;

  const size = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), totalPages);
  const from = (current - 1) * size + 1;
  const to = Math.min(current * size, total);

  return (
    <Pagination
      aria-label={t("admin.pager.label")}
      className="mt-4 flex-wrap items-center gap-3"
      size="sm"
    >
      <Pagination.Summary className="type-caption text-ink-muted tabular">
        {t("admin.pager.summary", {
          from: formatNumber(from),
          to: formatNumber(to),
          total: formatNumber(total),
        })}
      </Pagination.Summary>

      <Pagination.Content className="ms-auto">
        <Pagination.Item>
          <Pagination.Previous
            aria-label={t("admin.pager.previous")}
            isDisabled={current <= 1}
            onPress={() => onPageChange(current - 1)}
          >
            {/* Our own chevrons, mirrored explicitly, so back always points
                back — in Arabic that is the opposite side of the screen. */}
            <Pagination.PreviousIcon>
              <ChevronLeftIcon className="rtl:rotate-180" size={16} />
            </Pagination.PreviousIcon>
            <span className="hidden sm:inline">{t("admin.pager.previous")}</span>
          </Pagination.Previous>
        </Pagination.Item>

        {pageWindow(current, totalPages).map((entry, index) =>
          entry === ELLIPSIS ? (
            <Pagination.Item key={`gap-${index}`}>
              <Pagination.Ellipsis />
            </Pagination.Item>
          ) : (
            <Pagination.Item key={entry}>
              <Pagination.Link
                aria-label={t("admin.pager.page", { page: entry })}
                className="tabular min-w-11"
                isActive={entry === current}
                onPress={() => onPageChange(entry)}
              >
                {entry}
              </Pagination.Link>
            </Pagination.Item>
          ),
        )}

        <Pagination.Item>
          <Pagination.Next
            aria-label={t("admin.pager.next")}
            isDisabled={current >= totalPages}
            onPress={() => onPageChange(current + 1)}
          >
            <span className="hidden sm:inline">{t("admin.pager.next")}</span>
            <Pagination.NextIcon>
              <ChevronRightIcon className="rtl:rotate-180" size={16} />
            </Pagination.NextIcon>
          </Pagination.Next>
        </Pagination.Item>
      </Pagination.Content>
    </Pagination>
  );
}
