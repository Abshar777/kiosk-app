"use client";

import type { Course, Paginated } from "@course-lms/shared";
import { PAYMENT_STATUSES } from "@course-lms/shared";
import {
  Button,
  Label,
  ListBox,
  Modal,
  SearchField,
  Select,
  Separator,
  Spinner,
  Table,
} from "@heroui/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AlertIcon, DownloadIcon } from "@/components/icons";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Pager,
  StatusChip,
  TableSkeleton,
  Toolbar,
  useAdminQuery,
} from "@/components/admin/primitives";
import {
  adminApi,
  ApiRequestError,
  type EnrollmentListItem,
  type PaymentListItem,
} from "@/lib/api";
import { formatCurrency, formatDate, formatDateTime, formatMobile } from "@/lib/format";
import { dictionaries, type TranslationKey } from "@/lib/i18n/dictionaries";
import { useI18n } from "@/lib/i18n/provider";

const PAGE_SIZE = 25;

/** HeroUI's Select cannot hold an empty key, so "no filter" needs a sentinel. */
const ALL = "__all__";

/**
 * Long enough that typing a ten-digit mobile number is one request rather than
 * ten, short enough that the table still feels live.
 */
const SEARCH_DEBOUNCE_MS = 300;

/* -------------------------------------------------------------------------- */
/* Filters                                                                    */
/* -------------------------------------------------------------------------- */

interface EnrollmentFilters {
  q: string;
  courseId: string;
  paymentStatus: string;
  /** Plain YYYY-MM-DD; the API extends `to` to end-of-day itself. */
  from: string;
  to: string;
}

const EMPTY_FILTERS: EnrollmentFilters = {
  q: "",
  courseId: "",
  paymentStatus: "",
  from: "",
  to: "",
};

/**
 * The single place filters become query params, so the table and the CSV export
 * can never disagree about what is on screen. Blank values are dropped rather
 * than sent empty — the API treats a present-but-empty `paymentStatus` as a
 * filter and would return nothing.
 */
function toQuery(filters: EnrollmentFilters): Record<string, string | undefined> {
  return {
    q: filters.q.trim() || undefined,
    courseId: filters.courseId || undefined,
    paymentStatus: filters.paymentStatus || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
  };
}

/**
 * HeroUI v3 Select is controlled with `value`/`onChange` — React Aria's
 * `selectedKey`/`onSelectionChange` silently does nothing here.
 */
function FilterSelect({
  label,
  value,
  onChange,
  options,
  isDisabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { id: string; label: string }[];
  isDisabled?: boolean;
}) {
  const { t } = useI18n();

  return (
    <Select
      className="w-[200px] shrink-0"
      isDisabled={isDisabled}
      onChange={(key) => onChange(key === ALL ? "" : String(key ?? ""))}
      value={value === "" ? ALL : value}
    >
      <Label className="type-caption text-ink-muted mb-1.5 block">{label}</Label>
      <Select.Trigger className="min-h-14 w-full">
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id={ALL} textValue={t("filter.all")}>
            {t("filter.all")}
            <ListBox.ItemIndicator />
          </ListBox.Item>
          {options.map((option) => (
            <ListBox.Item id={option.id} key={option.id} textValue={option.label}>
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

/**
 * A native date input rather than HeroUI's DatePicker.
 *
 * DatePicker is controlled with `CalendarDate` objects from
 * @internationalized/date, which this workspace only has as a transitive
 * dependency — it does not resolve from `frontend/`, and adding it belongs in a
 * package.json change, not here. The native control also yields exactly the
 * `YYYY-MM-DD` string the API's `from`/`to` filters expect, with no conversion
 * step to get wrong.
 */
function DateFilter({
  id,
  label,
  value,
  max,
  min,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  max?: string;
  min?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="shrink-0">
      <label className="type-caption text-ink-muted mb-1.5 block" htmlFor={id}>
        {label}
      </label>
      {/*
       * `ring-focus` carries the focus state instead of the native outline,
       * which is painted outside the box and gets clipped where the toolbar
       * wraps. It is a real replacement, not just a reset — a bare
       * `outline-none` would leave the field with no visible focus at all.
       */}
      <input
        className="bg-surface-sunken rounded-control type-body text-ink ring-focus min-h-14 w-[170px] px-4"
        id={id}
        max={max}
        min={min}
        onChange={(event) => onChange(event.target.value)}
        type="date"
        value={value}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Session expiry                                                             */
/* -------------------------------------------------------------------------- */

/**
 * AdminAuthGate only checks the session when the admin area mounts, so a cookie
 * that expires while the operator is reading a table surfaces here as a 401 and
 * nowhere else. Retrying cannot fix it, so this offers the one action that can.
 */
function SessionExpired() {
  const router = useRouter();

  return (
    <div
      className="bg-surface rounded-card flex flex-col items-center gap-4 p-10 text-center"
      role="alert"
    >
      <span className="bg-warn-bg text-warn grid h-14 w-14 place-items-center rounded-full">
        <AlertIcon size={24} />
      </span>
      <div className="max-w-md">
        <p className="type-heading text-ink">Your session has expired</p>
        <p className="type-body text-ink-muted mt-1">
          Sign in again to keep managing enrollments.
        </p>
      </div>
      {/*
       * `replace`, not `push`: the page behind this notice is dead — every
       * request from it 401s — so leaving it in history only gives the back
       * button somewhere useless to land, which AdminAuthGate then bounces
       * straight back to the login screen.
       */}
      <Button className="min-h-11" onPress={() => router.replace("/admin/login")} variant="primary">
        Go to sign-in
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Detail dialog                                                              */
/* -------------------------------------------------------------------------- */

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-hairline flex flex-wrap items-baseline justify-between gap-3 border-b py-3 last:border-b-0">
      <dt className="type-caption text-ink-muted">{label}</dt>
      <dd className="type-body text-ink text-end">{value}</dd>
    </div>
  );
}

const METHOD_LABEL: Record<string, string> = {
  upi: "UPI",
  card: "Card (online)",
  netbanking: "Net banking",
  card_present: "Card machine (in person)",
};

function PaymentSection({ enrollment }: { enrollment: EnrollmentListItem }) {
  const { locale } = useI18n();

  /*
   * There is no GET /api/admin/enrollments/:id, and the list row carries only a
   * payment summary — not the instrument, gateway reference, failure reason or
   * refund. The admin payments list is the authenticated route to the full
   * record: its `q` matches the enrollment code. The exact comparison afterwards
   * guards against `q` being a LIKE match that landed on some other row.
   */
  const query = useAdminQuery<PaymentListItem | null>(
    () =>
      adminApi
        .payments({ q: enrollment.enrollmentId, pageSize: 10 })
        .then(
          (page) =>
            page.items.find((item) => item.enrollmentCode === enrollment.enrollmentId) ?? null,
        ),
    [enrollment.enrollmentId],
  );

  if (query.isLoading && query.data === null) {
    return (
      <div aria-busy="true" className="flex items-center gap-3 py-4" role="status">
        <Spinner size="sm" />
        <span className="type-body text-ink-muted">Loading the payment record…</span>
      </div>
    );
  }

  /*
   * A failed lookup must not hide the summary the row already proved: fall back
   * to it rather than leaving the payment block empty.
   */
  if (query.error !== null) {
    return (
      <>
        <p className="type-caption text-warn mb-3 flex items-center gap-1.5">
          <AlertIcon size={14} />
          {query.error.status === 401
            ? "Session expired — sign in again for the full payment record."
            : "Could not load the full payment record. Showing what the list returned."}
        </p>
        <dl>
          <DetailRow
            label="Payment status"
            value={
              enrollment.paymentStatus === null ? (
                <span className="text-ink-subtle">Not attempted</span>
              ) : (
                <StatusChip status={enrollment.paymentStatus} />
              )
            }
          />
          {enrollment.paymentReference !== null && (
            <DetailRow
              label="Reference"
              value={<span className="tabular">{enrollment.paymentReference}</span>}
            />
          )}
          {enrollment.paymentMethod !== null && (
            <DetailRow
              label="Method"
              value={METHOD_LABEL[enrollment.paymentMethod] ?? enrollment.paymentMethod}
            />
          )}
        </dl>
      </>
    );
  }

  const payment = query.data;

  if (payment === null) {
    return (
      <p className="type-body text-ink-muted py-2">
        No payment has been attempted for this enrollment yet.
      </p>
    );
  }

  return (
    <dl>
      <DetailRow label="Payment status" value={<StatusChip status={payment.status} />} />
      <DetailRow
        label="Reference"
        value={<span className="tabular">{payment.reference}</span>}
      />
      <DetailRow label="Method" value={METHOD_LABEL[payment.method] ?? payment.method} />
      <DetailRow
        label="Amount"
        value={
          <span className="tabular font-bold">
            {formatCurrency(payment.amount, payment.currency)}
          </span>
        }
      />
      {payment.instrument !== null && (
        <DetailRow
          label="Instrument"
          value={<span className="tabular">{payment.instrument}</span>}
        />
      )}
      {payment.gatewayRef !== null && (
        <DetailRow
          label="Gateway reference"
          value={<span className="tabular">{payment.gatewayRef}</span>}
        />
      )}
      {payment.failureReason !== null && (
        <DetailRow
          label="Failure reason"
          value={<span className="text-bad">{payment.failureReason}</span>}
        />
      )}
      {payment.refundedAmount !== null && (
        <DetailRow
          label="Refunded"
          value={
            <span className="tabular">
              {formatCurrency(payment.refundedAmount, payment.currency)}
            </span>
          }
        />
      )}
      {payment.completedAt !== null && (
        <DetailRow label="Completed" value={formatDateTime(payment.completedAt, locale)} />
      )}
      {payment.refundedAt !== null && (
        <DetailRow label="Refunded at" value={formatDateTime(payment.refundedAt, locale)} />
      )}
    </dl>
  );
}

function EnrollmentDetailDialog({
  enrollment,
  onClose,
}: {
  enrollment: EnrollmentListItem;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();

  return (
    <Modal.Backdrop isOpen onOpenChange={(open) => !open && onClose()}>
      <Modal.Container className="p-4" placement="center" scroll="inside" size="lg">
        <Modal.Dialog className="w-full">
          <Modal.Header>
            <Modal.Heading className="type-title text-ink tabular font-bold">
              {enrollment.enrollmentId}
            </Modal.Heading>
          </Modal.Header>

          <Modal.Body>
            <dl>
              <DetailRow label="Student" value={enrollment.fullName} />
              <DetailRow
                label="Mobile"
                value={<span className="tabular">{formatMobile(enrollment.mobile)}</span>}
              />
              <DetailRow label="Course" value={enrollment.courseName} />
              {enrollment.batchLabel !== null && (
                <DetailRow label="Batch" value={enrollment.batchLabel} />
              )}
              <DetailRow
                label="Amount"
                value={
                  <span className="tabular font-bold">
                    {formatCurrency(enrollment.amount, enrollment.currency)}
                  </span>
                }
              />
              <DetailRow
                label="Enrollment status"
                value={<StatusChip status={enrollment.status} />}
              />
              <DetailRow label="Created" value={formatDateTime(enrollment.createdAt, locale)} />
              {enrollment.confirmedAt !== null && (
                <DetailRow
                  label="Confirmed"
                  value={formatDateTime(enrollment.confirmedAt, locale)}
                />
              )}
            </dl>

            <Separator className="my-5" />

            <h3 className="type-subheading text-ink mb-2">Payment</h3>
            <PaymentSection enrollment={enrollment} />
          </Modal.Body>

          <Modal.Footer>
            <Button className="min-h-11" onPress={onClose} variant="secondary">
              {t("admin.action.close")}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

/* -------------------------------------------------------------------------- */
/* CSV export                                                                 */
/* -------------------------------------------------------------------------- */

/** `attachment; filename="enrollments-2026-10-30.csv"` → the bare filename. */
function filenameFrom(disposition: string | null): string | null {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? "");
  return match?.[1] ?? null;
}

/* -------------------------------------------------------------------------- */
/* View                                                                       */
/* -------------------------------------------------------------------------- */

export function EnrollmentsView() {
  const { t, locale } = useI18n();

  const [filters, setFilters] = useState<EnrollmentFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<EnrollmentListItem | null>(null);

  // What is in the search box, before debouncing commits it to `filters.q`.
  const [searchInput, setSearchInput] = useState("");

  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  /**
   * Any filter change reshapes the result set, so the current page number is
   * meaningless against it — page 7 of the old set is almost certainly past the
   * end of the new one, which would strand the operator on an empty table.
   */
  const patchFilters = useCallback((patch: Partial<EnrollmentFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }, []);

  useEffect(() => {
    // Equal on mount, and again on the render after a commit, so neither fires
    // a redundant request nor resets the page the operator is already on.
    if (searchInput === filters.q) return;
    const timer = setTimeout(() => {
      setFilters((current) => ({ ...current, q: searchInput }));
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, filters.q]);

  const query = useAdminQuery<Paginated<EnrollmentListItem>>(
    () => adminApi.enrollments({ ...toQuery(filters), page, pageSize: PAGE_SIZE }),
    [filters.q, filters.courseId, filters.paymentStatus, filters.from, filters.to, page],
  );

  /*
   * One page of 100 covers every realistic catalogue, and the picker is a
   * filter rather than the page's subject: if it fails the table still works,
   * so the failure degrades to an "All"-only list instead of an error screen.
   */
  const coursesQuery = useAdminQuery<Paginated<Course>>(() => adminApi.courses({ pageSize: 100 }));

  const exportCsv = useCallback(async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      /*
       * Not a bare <a href>: the export endpoint authenticates with the admin
       * session cookie, and a plain navigation cannot be given
       * `credentials: "include"`, nor can it report a 401 — the operator would
       * get a downloaded error page instead of a message.
       */
      const response = await fetch(adminApi.enrollmentsExportUrl(toQuery(filters)), {
        credentials: "include",
      });

      if (!response.ok) {
        throw new ApiRequestError(
          response.status,
          "EXPORT_FAILED",
          response.status === 401
            ? "Your session expired. Sign in again to export."
            : `The export failed (${response.status}).`,
        );
      }

      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      // Content-Disposition is unreadable cross-origin unless the API exposes
      // it, so a local name is the fallback rather than the exception.
      link.download =
        filenameFrom(response.headers.get("content-disposition")) ??
        `enrollments-${new Date().toISOString().slice(0, 10)}.csv`;
      // Firefox ignores .click() on an anchor that was never in the document.
      document.body.append(link);
      link.click();
      link.remove();
      // Revoking in the same tick can cancel a download that has not started
      // reading the blob yet, so give the browser one first.
      setTimeout(() => URL.revokeObjectURL(href), 0);
    } catch (cause) {
      /*
       * This fetch bypasses api.ts's `request()`, so nothing has already
       * translated a rejected fetch into readable advice: a dead API would
       * otherwise put the browser's own "Failed to fetch" in front of the
       * operator. Only our own ApiRequestError carries a message worth showing.
       */
      setExportError(
        cause instanceof ApiRequestError
          ? cause.message
          : "Cannot reach the server. Please check the connection and try again.",
      );
    } finally {
      setIsExporting(false);
    }
  }, [filters]);

  const hasFilters =
    filters.q !== "" ||
    filters.courseId !== "" ||
    filters.paymentStatus !== "" ||
    filters.from !== "" ||
    filters.to !== "";

  const clearFilters = useCallback(() => {
    setSearchInput("");
    setFilters(EMPTY_FILTERS);
    setPage(1);
  }, []);

  const paymentStatusOptions = PAYMENT_STATUSES.map((status) => {
    const key = `admin.status.${status}` as TranslationKey;
    return { id: status, label: key in dictionaries.en ? t(key) : status };
  });

  /** Ordered loading → error → empty → content, per the useAdminQuery contract. */
  const table = (() => {
    if (query.isLoading && query.data === null) return <TableSkeleton columns={7} rows={8} />;

    if (query.error !== null) {
      if (query.error.status === 401) return <SessionExpired />;
      return <ErrorState error={query.error} onRetry={query.reload} />;
    }

    if (query.data === null) return null;

    if (query.data.items.length === 0) {
      return (
        <EmptyState
          action={
            hasFilters ? (
              <Button className="min-h-11" onPress={clearFilters} variant="secondary">
                {t("admin.action.clear")}
              </Button>
            ) : undefined
          }
          body={
            hasFilters
              ? "No enrollment matches these filters. Try widening the date range or clearing the search."
              : t("admin.state.empty.body")
          }
          title={hasFilters ? "No matching enrollments" : t("admin.state.empty.title")}
        />
      );
    }

    return (
      <>
        <Table className="bg-surface rounded-card overflow-hidden">
          <Table.ScrollContainer>
            <Table.Content aria-label={t("admin.nav.enrollments")}>
              <Table.Header>
                <Table.Column isRowHeader>Enrollment ID</Table.Column>
                <Table.Column>Student</Table.Column>
                <Table.Column>Mobile</Table.Column>
                <Table.Column>Course</Table.Column>
                <Table.Column>Payment</Table.Column>
                <Table.Column className="text-end">Amount</Table.Column>
                <Table.Column className="text-end">Created</Table.Column>
              </Table.Header>

              <Table.Body>
                {query.data.items.map((row) => (
                  /*
                   * No data-ripple here: the ripple needs overflow:hidden on the
                   * tappable element, which is undefined on a <tr>. The row
                   * reports its own hover and press state instead.
                   */
                  <Table.Row
                    className="cursor-pointer data-[hovered=true]:bg-surface-sunken data-[pressed=true]:bg-surface-accent"
                    id={row.id}
                    key={row.id}
                    onAction={() => setSelected(row)}
                    textValue={`${row.enrollmentId} ${row.fullName}`}
                  >
                    <Table.Cell className="tabular font-bold">{row.enrollmentId}</Table.Cell>
                    <Table.Cell>{row.fullName}</Table.Cell>
                    <Table.Cell className="tabular">{formatMobile(row.mobile)}</Table.Cell>
                    <Table.Cell>{row.courseName}</Table.Cell>
                    <Table.Cell>
                      {row.paymentStatus === null ? (
                        <span className="type-caption text-ink-subtle">—</span>
                      ) : (
                        <StatusChip status={row.paymentStatus} />
                      )}
                    </Table.Cell>
                    <Table.Cell className="tabular text-end">
                      {formatCurrency(row.amount, row.currency)}
                    </Table.Cell>
                    <Table.Cell className="tabular text-ink-muted text-end">
                      {formatDate(row.createdAt, locale)}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>

        <Pager
          onPageChange={setPage}
          page={query.data.page}
          pageSize={query.data.pageSize}
          total={query.data.total}
        />
      </>
    );
  })();

  return (
    <div>
      <PageHeader
        actions={
          <Button
            className="min-h-14"
            isDisabled={isExporting}
            onPress={() => void exportCsv()}
            variant="secondary"
          >
            {isExporting ? <Spinner size="sm" /> : <DownloadIcon size={18} />}
            {t("admin.action.export")}
          </Button>
        }
        description="Every enrollment taken at the kiosk, with its payment outcome."
        title={t("admin.nav.enrollments")}
      />

      {exportError !== null && (
        <p className="type-caption text-bad mb-4 flex items-center gap-1.5" role="alert">
          <AlertIcon size={14} />
          {exportError}
        </p>
      )}

      <Toolbar>
        <SearchField
          className="w-[min(360px,45vw)] min-w-[220px] grow"
          onChange={setSearchInput}
          value={searchInput}
        >
          <Label className="type-caption text-ink-muted mb-1.5 block">
            {t("admin.action.search")}
          </Label>
          <SearchField.Group className="min-h-14 w-full">
            <SearchField.SearchIcon />
            <SearchField.Input className="w-full" placeholder="Name or mobile number" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>

        <FilterSelect
          isDisabled={coursesQuery.isLoading}
          label={t("admin.nav.courses")}
          onChange={(courseId) => patchFilters({ courseId })}
          options={(coursesQuery.data?.items ?? []).map((course) => ({
            id: course.id,
            label: course.name,
          }))}
          value={filters.courseId}
        />

        <FilterSelect
          label="Payment status"
          onChange={(paymentStatus) => patchFilters({ paymentStatus })}
          options={paymentStatusOptions}
          value={filters.paymentStatus}
        />

        <DateFilter
          id="enrollments-from"
          label="From"
          max={filters.to || undefined}
          onChange={(from) => patchFilters({ from })}
          value={filters.from}
        />

        <DateFilter
          id="enrollments-to"
          label="To"
          min={filters.from || undefined}
          onChange={(to) => patchFilters({ to })}
          value={filters.to}
        />

        {hasFilters && (
          <Button className="min-h-14" onPress={clearFilters} variant="ghost">
            {t("admin.action.clear")}
          </Button>
        )}
      </Toolbar>

      {table}

      {selected !== null && (
        <EnrollmentDetailDialog enrollment={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
