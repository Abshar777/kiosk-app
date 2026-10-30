"use client";

import type { PosSaleState, PosSaleStatus } from "@course-lms/shared";
import { Button, Spinner } from "@heroui/react";
import { AlertIcon, CheckIcon } from "@/components/icons";
import { formatCurrency } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";

/**
 * Instruction copy is keyed off the shared state union rather than a chain of
 * conditionals, so a state added to PosSaleState in @course-lms/shared fails
 * the build here instead of silently rendering a blank screen at a customer.
 *
 * The strings are literals: the dictionary has no `pos.*` keys yet and
 * lib/i18n/dictionaries.ts belongs to another agent. See the report.
 */
const INSTRUCTION: Record<PosSaleState, { headline: string; hint: string | null }> = {
  connecting: {
    headline: "Connecting to the card machine",
    hint: "This takes a moment.",
  },
  waiting_for_card: {
    headline: "Follow the prompts on the card machine",
    hint: "Tap, insert or swipe",
  },
  processing: {
    // The "do not remove your card" line is carried by the callout below
    // instead, where it is loud enough to actually stop a hand mid-reach.
    headline: "Authorising — please wait",
    hint: null,
  },
  approved: { headline: "Payment approved", hint: null },
  declined: { headline: "Card declined", hint: null },
  cancelled: {
    headline: "Payment cancelled",
    hint: "Nothing has been charged.",
  },
  error: { headline: "Card machine problem", hint: null },
};

/**
 * Which affordances each state gets: the spinner-and-wait screen, the approved
 * receipt, or the recover-from-here screen.
 *
 * A Record keyed by the union rather than the two `readonly PosSaleState[]`
 * arrays this replaced. Those arrays compiled fine when a state was added to
 * PosSaleState — INSTRUCTION forced new copy, but the new state matched neither
 * array, so it rendered a headline with no icon, no amount and, critically, no
 * buttons: a customer stranded mid-payment with no way off the screen. Keyed
 * this way, that omission is a build error instead.
 */
const PHASE: Record<PosSaleState, "waiting" | "approved" | "recoverable"> = {
  connecting: "waiting",
  waiting_for_card: "waiting",
  processing: "waiting",
  approved: "approved",
  declined: "recoverable",
  cancelled: "recoverable",
  error: "recoverable",
};

/**
 * `state` is only a string at runtime: lib/api.ts casts the poll response to
 * PosSaleStatus, it does not parse it. A value outside the union — a backend
 * ahead of a kiosk running a cached bundle — threw on the INSTRUCTION lookup
 * and white-screened the kiosk with a card in the machine.
 *
 * An unknown state resolves to `error`, which is the only honest choice: it
 * claims nothing about whether money moved (unlike `cancelled`, whose copy
 * promises "nothing has been charged") and it still offers Retry and Change
 * method, so the customer is never stuck.
 */
function resolveState(raw: string): PosSaleState {
  return raw in PHASE ? (raw as PosSaleState) : "error";
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-hairline flex items-baseline justify-between gap-6 border-t py-3 first:border-t-0">
      <dt className="type-body text-ink-muted">{label}</dt>
      <dd className="type-body-lg text-ink tabular text-end font-semibold">{value}</dd>
    </div>
  );
}

export interface CardMachinePanelProps {
  /** Latest poll from the backend. `null` before the first one lands. */
  status: PosSaleStatus | null;
  /** Abandon the card-present attempt and return to the method chooser. */
  onCancel: () => void;
  /** Start a fresh sale on the terminal. */
  onRetry: () => void;
  /** Acknowledge an approved sale; the parent moves on to the receipt. */
  onDone: (status: PosSaleStatus) => void;
}

/**
 * The one screen a customer sees while a sale runs on the physical terminal.
 *
 * Pure presentation. It never polls and never fetches — the parent owns the
 * sale lifecycle and feeds `status` in. That split is what lets this component
 * be rendered from a story or a mock transport with no backend at all.
 */
export function CardMachinePanel({ status, onCancel, onRetry, onDone }: CardMachinePanelProps) {
  const { t } = useI18n();

  // Before the first poll returns we are, factually, connecting.
  const state: PosSaleState = status === null ? "connecting" : resolveState(status.state);
  const { headline, hint } = INSTRUCTION[state];
  const phase = PHASE[state];

  const isWaiting = phase === "waiting";
  const isApproved = phase === "approved" && status !== null;
  const canRetry = phase === "recoverable";

  /*
   * The backend's two fields are not interchangeable, and the split holds for
   * every terminal state:
   *
   *   message       — the line written for a customer to read. "Insufficient
   *                   funds", "Card expired", "Tap limit reached — insert the
   *                   card", "Could not reach the card machine. Check that it
   *                   is on and connected."
   *   failureReason — a machine code for logs and reconciliation.
   *                   INSUFFICIENT_FUNDS, EXPIRED_CARD, CONTACTLESS_LIMIT,
   *                   UNREACHABLE, UNKNOWN_RESULT_CODE:99.
   *
   * See the RESULTS table in backend/src/lib/pos/genericEcr.ts and the catch in
   * sale.ts. So the explanation renders `message`; `failureReason` is a last
   * resort for a reply that carried no text at all, which the generic ECR
   * adapter never produces.
   */
  const terminalText = status?.message?.trim() ?? "";
  const explanation = terminalText || status?.failureReason || null;

  /*
   * While waiting, the same field is a progress echo of the terminal's own
   * display — but the backend seeds it at waiting_for_card with the exact
   * string this screen already uses as its headline, so echo it only when it
   * says something the customer is not already reading.
   */
  const progressEcho =
    terminalText && terminalText !== headline && terminalText !== hint ? terminalText : null;

  /*
   * Cancel is deliberately unavailable once the terminal is authorising.
   *
   * At that point the card has been read and the request is with the acquirer.
   * Pulling the sale out from under it does not un-charge anything — it just
   * means the customer's card is debited while we have no approval to record,
   * which is the charged-but-unrecorded case this flow exists to avoid. Let the
   * terminal finish and report; the parent reconciles from the stored
   * terminalRef if we lose the answer.
   */
  const isCancelDisabled = state === "processing";

  return (
    <section className="kiosk-nonselectable flex min-h-[460px] flex-col items-center justify-center py-10 text-center">
      {/* One live region for the whole screen: a reader announces the new
          instruction on each state change without re-reading the chrome. */}
      <div aria-live="polite" className="flex w-full flex-col items-center" role="status">
        {isWaiting && (
          <span className="bg-surface-sunken text-ink grid h-28 w-28 place-items-center rounded-full">
            <Spinner size="xl" />
          </span>
        )}

        {isApproved && (
          <span className="bg-brand text-brand-ink grid h-28 w-28 place-items-center rounded-full">
            <CheckIcon size={52} />
          </span>
        )}

        {canRetry && (
          <span
            className={`grid h-28 w-28 place-items-center rounded-full ${
              state === "cancelled" ? "bg-warn-bg text-warn" : "bg-bad-bg text-bad"
            }`}
          >
            <AlertIcon size={52} />
          </span>
        )}

        <h2 className="type-display text-ink mt-10 max-w-[32ch] text-balance">{headline}</h2>

        {hint && <p className="type-heading text-ink-muted mt-5 max-w-[34ch]">{hint}</p>}

        {/* Inside the live region deliberately: this is the one line on the
            screen that prevents a failed transaction, and the `processing`
            headline does not carry it, so a reader that only announces the
            region would otherwise never speak it. */}
        {state === "processing" && (
          <p className="bg-warn-bg text-warn rounded-control type-heading mt-8 px-8 py-5">
            Do not remove your card
          </p>
        )}
      </div>

      {/* The amount stays on screen through the whole wait so the customer can
          check it against the figure the terminal is showing them. */}
      {status && isWaiting && (
        <p className="type-title text-ink tabular mt-8 font-bold">
          {formatCurrency(status.amount, status.currency)}
        </p>
      )}

      {/* Mirror of the terminal's own display. Kept quiet — it is a progress
          echo, not the instruction, and it can be blank or a repeat. */}
      {isWaiting && progressEcho && (
        <p className="type-body-lg text-ink-subtle mt-4 max-w-[40ch]">{progressEcho}</p>
      )}

      {/* A cancellation is a normal outcome, not a fault, so it stays on the
          warning ramp — only a decline or a fault earns the danger colour. */}
      {canRetry && explanation && (
        <div
          className={`rounded-control mt-8 flex w-full max-w-[36rem] items-start gap-4 p-6 text-start ${
            state === "cancelled" ? "bg-warn-bg" : "bg-bad-bg"
          }`}
        >
          <span
            className={`mt-0.5 shrink-0 ${state === "cancelled" ? "text-warn" : "text-bad"}`}
          >
            <AlertIcon size={24} />
          </span>
          <p className="type-body-lg text-ink">{explanation}</p>
        </div>
      )}

      {isApproved && status && (
        <dl className="bg-surface-sunken rounded-card mt-8 w-full max-w-[36rem] px-8 py-4 text-start">
          <Detail
            label={t("payment.total")}
            value={formatCurrency(status.amount, status.currency)}
          />
          {/* status.instrument is already masked upstream ("VISA ****4242").
              A raw PAN must never reach this component, so there is nothing to
              truncate or redact here — render it verbatim or not at all. */}
          {status.instrument && <Detail label="Card" value={status.instrument} />}
          {status.authCode && <Detail label="Authorisation code" value={status.authCode} />}
          {status.terminalRef && <Detail label="Terminal reference" value={status.terminalRef} />}
        </dl>
      )}

      <div className="mt-10 flex w-full max-w-[36rem] flex-col gap-3">
        {isApproved && status && (
          <Button
            className="min-h-touch-lg w-full"
            onPress={() => onDone(status)}
            size="lg"
            variant="primary"
          >
            Continue
          </Button>
        )}

        {canRetry && (
          <>
            <Button
              className="min-h-touch-lg w-full"
              onPress={onRetry}
              size="lg"
              variant="primary"
            >
              {t("payment.retry")}
            </Button>
            <Button className="min-h-touch w-full" onPress={onCancel} size="lg" variant="secondary">
              {t("payment.changeMethod")}
            </Button>
          </>
        )}

        {/* Secondary by weight and position: the customer's job on this screen
            is the card machine, not this button. */}
        {isWaiting && (
          <Button
            className="min-h-touch w-full"
            isDisabled={isCancelDisabled}
            onPress={onCancel}
            size="lg"
            variant="tertiary"
          >
            Cancel payment
          </Button>
        )}

        {isCancelDisabled && (
          <p className="type-body text-ink-subtle">
            Cancelling is unavailable while the payment is being authorised.
          </p>
        )}
      </div>
    </section>
  );
}
