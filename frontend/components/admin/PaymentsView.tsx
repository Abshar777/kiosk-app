"use client";

import type { PaymentMethod } from "@course-lms/shared";
import { PAYMENT_STATUSES } from "@course-lms/shared";
import {
  Button,
  Input,
  Label,
  ListBox,
  NumberField,
  SearchField,
  Select,
  Table,
  TextField,
} from "@heroui/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AlertIcon, RefreshIcon } from "@/components/icons";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Pager,
  StatusChip,
  TableSkeleton,
  Toolbar,
  useAdminQuery,
} from "@/components/admin/primitives";
import type { PaymentListItem } from "@/lib/api";
import { ApiRequestError, adminApi } from "@/lib/api";
import { formatCurrency, formatDateTime, formatMobile } from "@/lib/format";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { useI18n } from "@/lib/i18n/provider";

const PAGE_SIZE = 25;

/** One request per keystroke is a lot of round trips over a site's own wifi. */
const SEARCH_DEBOUNCE_MS = 350;

/*
 * `card_present` is a protocol value, not a word an operator would use — on the
 * floor the thing is "the card machine". The other three keep their familiar
 * names so a row matches what the student saw on the kiosk.
 */
const METHOD_LABEL: Record<PaymentMethod, string> = {
  upi: "UPI",
  card: "Card (online)",
  netbanking: "Net banking",
  card_present: "Card machine",
};

/** Select has no "unselected" key, so the all-statuses row needs its own id. */
const ALL = "__all__";

/*
 * `.table__column` ships `text-left`, which has to be overridden for RTL — but
 * `text-start` and `text-end` cannot both sit on one element: HeroUI composes
 * classes with tailwind-variants' `cx`, which concatenates without resolving
 * Tailwind conflicts, and Tailwind emits `.text-end` *before* `.text-start`, so
 * `text-start` would win the cascade and silently start-align the numeric
 * headers. The two alignments therefore get their own class strings.
 */
const COLUMN_BASE = "type-label text-ink-muted bg-surface-sunken px-5 py-3";
const COLUMN_CLASS = `${COLUMN_BASE} text-start`;
const COLUMN_END_CLASS = `${COLUMN_BASE} text-end`;
const CELL_CLASS = "type-body text-ink px-5 py-5 align-middle";

/* -------------------------------------------------------------------------- */
/* Filters                                                                    */
/* -------------------------------------------------------------------------- */

interface Filters {
  q: string;
  status: string;
  /** Plain `YYYY-MM-DD`; the API widens `to` to the end of that day itself. */
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { q: "", status: "", from: "", to: "" };

const hasFilters = (filters: Filters): boolean =>
  filters.q !== "" || filters.status !== "" || filters.from !== "" || filters.to !== "";

function DateFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    /*
     * A native date input rather than HeroUI's DatePicker: that one is driven by
     * `DateValue` objects from @internationalized/date, which is not a declared
     * dependency of this workspace and so cannot be imported here. The native
     * control also hands back exactly the `YYYY-MM-DD` the API filters on.
     */
    <TextField className="w-[168px] shrink-0" onChange={onChange} type="date" value={value}>
      <Label className="type-caption text-ink-muted mb-1.5 block">{label}</Label>
      <Input className="min-h-14 w-full" />
    </TextField>
  );
}

function PaymentFilters({
  filters,
  search,
  onSearch,
  onChange,
  onClear,
}: {
  filters: Filters;
  /** What is typed, which runs ahead of `filters.q` by one debounce. */
  search: string;
  onSearch: (value: string) => void;
  onChange: (patch: Partial<Filters>) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();

  return (
    <Toolbar>
      <SearchField
        className="min-w-[240px] flex-1"
        onChange={onSearch}
        value={search}
      >
        <Label className="type-caption text-ink-muted mb-1.5 block">
          {t("admin.action.search")}
        </Label>
        <SearchField.Group className="min-h-14 w-full">
          <SearchField.SearchIcon />
          <SearchField.Input
            className="w-full"
            placeholder="Reference, student, mobile or enrollment ID"
          />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>

      {/* HeroUI v3 Select is controlled with value/onChange — React Aria's
          selectedKey/onSelectionChange silently does nothing here. */}
      <Select
        className="w-[168px] shrink-0"
        onChange={(key) => onChange({ status: key === ALL ? "" : String(key ?? "") })}
        value={filters.status === "" ? ALL : filters.status}
      >
        <Label className="type-caption text-ink-muted mb-1.5 block">Status</Label>
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
            {PAYMENT_STATUSES.map((status) => {
              const label = t(`admin.status.${status}` as TranslationKey);
              return (
                <ListBox.Item id={status} key={status} textValue={label}>
                  {label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              );
            })}
          </ListBox>
        </Select.Popover>
      </Select>

      <DateFilter
        label="From"
        onChange={(value) => onChange({ from: value })}
        value={filters.from}
      />
      <DateFilter label="To" onChange={(value) => onChange({ to: value })} value={filters.to} />

      {/* Reads the typed text, not the debounced copy, so Clear appears with
          the first keystroke rather than a third of a second later. */}
      {hasFilters({ ...filters, q: search }) && (
        <Button className="min-h-14" onPress={onClear} variant="ghost">
          {t("admin.action.clear")}
        </Button>
      )}
    </Toolbar>
  );
}

/* -------------------------------------------------------------------------- */
/* Session                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A 401 is not a failed request to retry — the cookie is gone and every retry
 * will fail the same way. Only the login screen can fix it, so say so rather
 * than leaving an operator pressing "Try again".
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
        <p className="type-heading text-ink">Your session expired</p>
        <p className="type-body text-ink-muted mt-1">
          Sign in again to see payments and issue refunds.
        </p>
      </div>
      <Button className="min-h-11" onPress={() => router.replace("/admin/login")} variant="primary">
        Sign in again
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Table                                                                      */
/* -------------------------------------------------------------------------- */

function PaymentsTable({
  items,
  onRefund,
}: {
  items: PaymentListItem[];
  onRefund: (payment: PaymentListItem) => void;
}) {
  const { locale, t } = useI18n();

  return (
    /* The root's own fill would be the sunken grey; design.md §7.6 wants the
       rows on a white card with only the header row sunken. */
    <Table className="bg-surface rounded-card p-0">
      <Table.ScrollContainer>
        <Table.Content aria-label={t("admin.nav.payments")}>
          <Table.Header>
            <Table.Column className={COLUMN_CLASS} id="reference" isRowHeader>
              Reference
            </Table.Column>
            <Table.Column className={COLUMN_CLASS} id="student">
              Student
            </Table.Column>
            <Table.Column className={COLUMN_CLASS} id="course">
              Course
            </Table.Column>
            <Table.Column className={COLUMN_CLASS} id="method">
              Method
            </Table.Column>
            <Table.Column className={COLUMN_END_CLASS} id="amount">
              Amount
            </Table.Column>
            <Table.Column className={COLUMN_CLASS} id="status">
              Status
            </Table.Column>
            <Table.Column className={COLUMN_CLASS} id="time">
              Created
            </Table.Column>
            <Table.Column className={COLUMN_END_CLASS} id="actions">
              Actions
            </Table.Column>
          </Table.Header>

          <Table.Body>
            {items.map((payment) => (
              <Table.Row id={payment.id} key={payment.id}>
                <Table.Cell className={`${CELL_CLASS} tabular font-semibold whitespace-nowrap`}>
                  {payment.reference}
                </Table.Cell>

                <Table.Cell className={CELL_CLASS}>
                  {payment.studentName}
                  <span className="type-caption text-ink-subtle tabular mt-1 block">
                    {formatMobile(payment.studentMobile)}
                  </span>
                </Table.Cell>

                <Table.Cell className={CELL_CLASS}>
                  {payment.courseName}
                  <span className="type-caption text-ink-subtle tabular mt-1 block">
                    {payment.enrollmentCode}
                  </span>
                </Table.Cell>

                <Table.Cell className={CELL_CLASS}>{METHOD_LABEL[payment.method]}</Table.Cell>

                <Table.Cell className={`${CELL_CLASS} tabular text-end whitespace-nowrap`}>
                  {formatCurrency(payment.amount, payment.currency)}
                  {payment.refundedAmount !== null && payment.refundedAmount > 0 && (
                    <span className="type-caption text-ink-subtle mt-1 block">
                      {`−${formatCurrency(payment.refundedAmount, payment.currency)} refunded`}
                    </span>
                  )}
                </Table.Cell>

                <Table.Cell className={CELL_CLASS}>
                  <StatusChip status={payment.status} />
                </Table.Cell>

                <Table.Cell className={`${CELL_CLASS} tabular whitespace-nowrap`}>
                  {formatDateTime(payment.createdAt, locale)}
                  {/* A card-machine sale can sit on the terminal for a minute,
                      so when it completed is its own fact. */}
                  {payment.completedAt !== null && payment.completedAt !== payment.createdAt && (
                    <span className="type-caption text-ink-subtle mt-1 block">
                      {`Completed ${formatDateTime(payment.completedAt, locale)}`}
                    </span>
                  )}
                </Table.Cell>

                <Table.Cell className={`${CELL_CLASS} text-end`}>
                  {/* The API refuses anything but a successful payment, so the
                      button only exists where it can actually work. */}
                  {payment.status === "success" && (
                    <Button
                      className="min-h-11"
                      onPress={() => onRefund(payment)}
                      variant="secondary"
                    >
                      Refund
                    </Button>
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

/* -------------------------------------------------------------------------- */
/* Refund                                                                     */
/* -------------------------------------------------------------------------- */

function RefundBody({
  payment,
  amount,
  onAmountChange,
  error,
}: {
  payment: PaymentListItem;
  amount: number;
  onAmountChange: (amount: number) => void;
  error: string | null;
}) {
  const full = formatCurrency(payment.amount, payment.currency);

  return (
    <div className="flex flex-col gap-4">
      <p>
        {`Refund ${payment.reference} for ${payment.studentName}. The enrollment is marked refunded and cannot be charged again.`}
      </p>

      <NumberField
        className="w-full"
        // Capped at the payment: the operator cannot type their way past it,
        // and the amount is checked again before the request is built.
        maxValue={payment.amount}
        minValue={0}
        onChange={onAmountChange}
        value={amount}
      >
        <Label className="type-label text-ink mb-2 block">
          {`Refund amount (${payment.currency})`}
        </Label>
        <NumberField.Group className="min-h-14 w-full">
          <NumberField.Input className="tabular w-full" />
          <NumberField.DecrementButton />
          <NumberField.IncrementButton />
        </NumberField.Group>
        <p className="type-caption text-ink-subtle mt-1.5">
          {`Full payment is ${full}. Lower it for a partial refund.`}
        </p>
      </NumberField>

      {error !== null && (
        <p className="bg-bad-bg text-bad type-body rounded-control flex items-start gap-2 p-3">
          <AlertIcon className="mt-0.5 shrink-0" size={16} />
          {error}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* View                                                                       */
/* -------------------------------------------------------------------------- */

export function PaymentsView() {
  const { t } = useI18n();

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const query = useAdminQuery(
    () =>
      adminApi.payments({
        q: filters.q,
        status: filters.status,
        from: filters.from,
        to: filters.to,
        page,
        pageSize: PAGE_SIZE,
      }),
    [filters.q, filters.status, filters.from, filters.to, page],
  );

  // The typed value lands in `filters.q` one debounce later, which is also what
  // resets the page — a narrower search has fewer pages than the one you're on.
  useEffect(() => {
    if (search === filters.q) return;
    const timer = setTimeout(() => {
      setFilters((current) => ({ ...current, q: search }));
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, filters.q]);

  const patchFilters = (patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const clearFilters = () => {
    setSearch("");
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  /* --- refund ------------------------------------------------------------ */

  const [target, setTarget] = useState<PaymentListItem | null>(null);
  const [refundAmount, setRefundAmount] = useState(0);
  const [refundError, setRefundError] = useState<string | null>(null);

  /*
   * ConfirmDialog closes itself as soon as `onConfirm` resolves. A failed
   * refund resolves rather than rejects — rejecting from an onPress handler
   * surfaces as an unhandled rejection in the dev overlay — so the close it
   * then asks for is vetoed exactly once, leaving the operator on the message.
   * Cancel and the backdrop are unaffected: nothing sets this but a failure.
   */
  const keepOpenRef = useRef(false);

  const openRefund = (payment: PaymentListItem) => {
    setTarget(payment);
    setRefundAmount(payment.amount);
    setRefundError(null);
  };

  const submitRefund = async () => {
    if (target === null) return;

    // An emptied NumberField reports NaN, and the API reads `0` as "refund
    // everything" — neither may reach it from a box meant for a partial amount.
    if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
      keepOpenRef.current = true;
      setRefundError("Enter a refund amount greater than zero.");
      return;
    }
    if (refundAmount > target.amount) {
      keepOpenRef.current = true;
      setRefundError(
        `A refund cannot exceed the payment of ${formatCurrency(target.amount, target.currency)}.`,
      );
      return;
    }

    try {
      // Omitting the amount lets the server record its own full figure, so a
      // full refund never depends on this screen rounding the same way it does.
      const isFull = refundAmount === target.amount;
      const refunded = await adminApi.refund(target.id, isFull ? undefined : refundAmount);

      // Patch the one row instead of refetching: the operator keeps their page
      // and filters, and the server's own echo is what gets rendered.
      query.setData((current) =>
        current === null
          ? current
          : {
              ...current,
              items: current.items.map((item) =>
                item.id === refunded.id ? { ...item, ...refunded } : item,
              ),
            },
      );
      setRefundError(null);
    } catch (cause) {
      keepOpenRef.current = true;
      setRefundError(
        cause instanceof ApiRequestError && cause.status === 401
          ? "Your session expired. Sign in again, then retry the refund."
          : cause instanceof Error
            ? cause.message
            : String(cause),
      );
    }
  };

  /* --- render ------------------------------------------------------------ */

  const body = () => {
    if (query.isLoading && query.data === null) return <TableSkeleton columns={8} rows={8} />;
    if (query.error?.status === 401) return <SessionExpired />;
    if (query.error) return <ErrorState error={query.error} onRetry={query.reload} />;
    if (query.data === null) return null;

    if (query.data.items.length === 0) {
      return (
        <EmptyState
          action={
            hasFilters(filters) ? (
              <Button className="min-h-11" onPress={clearFilters} variant="secondary">
                {t("admin.action.clear")}
              </Button>
            ) : undefined
          }
          body={
            hasFilters(filters)
              ? "No payment matches these filters. Widen the dates or clear the search."
              : t("admin.state.empty.body")
          }
          title={hasFilters(filters) ? "No matching payments" : t("admin.state.empty.title")}
        />
      );
    }

    return (
      <>
        {/* A refetch keeps the old rows on screen; dimming them says the page
            is about to change rather than pretending it already has. */}
        <div aria-busy={query.isLoading} className={query.isLoading ? "opacity-60" : undefined}>
          <PaymentsTable items={query.data.items} onRefund={openRefund} />
        </div>
        <Pager
          onPageChange={setPage}
          page={query.data.page}
          pageSize={query.data.pageSize}
          total={query.data.total}
        />
      </>
    );
  };

  return (
    <div>
      <PageHeader
        actions={
          <Button
            className="min-h-11"
            isDisabled={query.isLoading}
            onPress={query.reload}
            variant="secondary"
          >
            <RefreshIcon size={18} />
            {t("admin.action.refresh")}
          </Button>
        }
        description="Every payment taken on the kiosk, and the refunds issued against them."
        title={t("admin.nav.payments")}
      />

      <PaymentFilters
        filters={filters}
        onChange={patchFilters}
        onClear={clearFilters}
        onSearch={setSearch}
        search={search}
      />

      {body()}

      {/* Mounted only while a refund is pending, so each one opens with the
          dialog's own busy state fresh rather than whatever the last left. */}
      {target !== null && (
        <ConfirmDialog
          body={
            <RefundBody
              amount={refundAmount}
              error={refundError}
              onAmountChange={setRefundAmount}
              payment={target}
            />
          }
          confirmLabel="Refund"
          isOpen
          onConfirm={submitRefund}
          onOpenChange={(open) => {
            if (open) return;
            if (keepOpenRef.current) {
              keepOpenRef.current = false;
              return;
            }
            setTarget(null);
          }}
          title="Refund this payment?"
          tone="danger"
        />
      )}
    </div>
  );
}
