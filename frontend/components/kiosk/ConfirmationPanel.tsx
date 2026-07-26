"use client";

import type { EnrollmentReceipt } from "@course-lms/shared";
import { Button, Separator, Spinner } from "@heroui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, DownloadIcon, PrintIcon } from "@/components/icons";
import { formatCurrency, formatDateTime, formatMobile } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { buildReceiptHtml, downloadReceipt, printReceipt } from "@/lib/receipt";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="type-body text-ink-muted shrink-0">{label}</dt>
      <dd className="type-body text-ink text-end font-medium">{children}</dd>
    </div>
  );
}

export function ConfirmationPanel({
  receipt,
  onAnother,
  autoReturnSeconds,
  autoPrint = false,
  autoPrintDelayMs = 900,
}: {
  receipt: EnrollmentReceipt;
  onAnother: () => void;
  autoReturnSeconds: number;
  autoPrint?: boolean;
  autoPrintDelayMs?: number;
}) {
  const { locale, t } = useI18n();
  const [remaining, setRemaining] = useState(autoReturnSeconds);
  const [isPaused, setIsPaused] = useState(false);
  const [printState, setPrintState] = useState<"idle" | "printing" | "done">("idle");

  const onAnotherRef = useRef(onAnother);
  onAnotherRef.current = onAnother;

  const { enrollment, payment } = receipt;

  const print = useCallback(async () => {
    setPrintState("printing");
    try {
      await printReceipt(buildReceiptHtml(receipt));
    } finally {
      setPrintState("done");
    }
  }, [receipt]);

  // Auto-print once per enrollment. The ref guard matters: React 19 StrictMode
  // runs effects twice in development, and nobody wants two receipts.
  const hasAutoPrinted = useRef(false);
  useEffect(() => {
    if (!autoPrint || hasAutoPrinted.current) return;
    hasAutoPrinted.current = true;

    // Let the confirmation paint before the print dialog steals focus.
    const timer = setTimeout(() => void print(), autoPrintDelayMs);
    return () => clearTimeout(timer);
  }, [autoPrint, autoPrintDelayMs, print]);

  // Auto-return so the kiosk is ready for the next student. Held while the
  // receipt is printing, and cancelled outright by any interaction.
  useEffect(() => {
    if (autoReturnSeconds <= 0 || isPaused || printState === "printing") return;
    if (remaining <= 0) {
      onAnotherRef.current();
      return;
    }
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [autoReturnSeconds, isPaused, printState, remaining]);

  const progress = autoReturnSeconds > 0 ? (remaining / autoReturnSeconds) * 100 : 0;

  return (
    <div
      onKeyDown={() => setIsPaused(true)}
      onPointerDown={() => setIsPaused(true)}
      role="presentation"
    >
      <div className="flex flex-col items-center text-center">
        <span className="bg-brand text-brand-ink grid h-18 w-18 place-items-center rounded-full">
          <CheckIcon size={36} />
        </span>
        <h2 className="type-display text-ink mt-5">{t("confirm.heading")}</h2>
        <p className="type-body-lg text-ink-muted mt-2">{t("confirm.subheading")}</p>
      </div>

      <div className="bg-surface-sunken rounded-control mt-6 p-5 text-center">
        <span className="type-caption text-ink-muted">{t("confirm.enrollmentId")}</span>
        <p className="type-title text-ink tabular mt-1 font-bold select-all">
          {enrollment.enrollmentId}
        </p>
      </div>

      {printState === "printing" && (
        <p className="bg-surface-accent text-ink type-body rounded-control mt-4 flex items-center justify-center gap-2 p-3">
          <Spinner size="sm" />
          {t("confirm.printing")}
        </p>
      )}

      <dl className="mt-5">
        <Row label={t("confirm.course")}>{enrollment.courseName}</Row>
        <Separator />
        <Row label={t("confirm.student")}>{enrollment.fullName}</Row>
        <Separator />
        <Row label={t("confirm.mobile")}>
          <span className="tabular">{formatMobile(enrollment.mobile)}</span>
        </Row>
        <Separator />
        <Row label={t("confirm.paymentStatus")}>
          <span className="bg-ok-bg text-ok type-caption rounded-full px-3 py-1 font-semibold">
            {t("status.success")}
          </span>
        </Row>
        <Separator />
        <Row label={t("confirm.reference")}>
          <span className="tabular">{payment.reference}</span>
        </Row>
        <Separator />
        <Row label={t("confirm.dateTime")}>
          <span className="tabular">
            {formatDateTime(payment.completedAt ?? payment.createdAt, locale)}
          </span>
        </Row>
        <Separator />
        <Row label={t("payment.total")}>
          <span className="tabular font-bold">
            {formatCurrency(payment.amount, payment.currency)}
          </span>
        </Row>
      </dl>

      <div className="mt-7 space-y-3">
        <Button
          className="w-full"
          onPress={() => downloadReceipt(buildReceiptHtml(receipt), enrollment.enrollmentId)}
          size="lg"
          variant="primary"
        >
          <DownloadIcon />
          {t("confirm.download")}
        </Button>
        <Button
          className="w-full"
          isDisabled={printState === "printing"}
          onPress={() => void print()}
          size="lg"
          variant="secondary"
        >
          <PrintIcon />
          {printState === "done" ? t("confirm.printAgain") : t("confirm.print")}
        </Button>
        <Button className="w-full" onPress={onAnother} size="lg" variant="ghost">
          {t("confirm.another")}
        </Button>
      </div>

      {autoReturnSeconds > 0 && !isPaused && printState !== "printing" && (
        <div className="mt-6">
          <div className="bg-surface-sunken h-1.5 w-full overflow-hidden rounded-full">
            <div
              className="bg-slate h-full rounded-full transition-[width] duration-1000 ease-linear"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="type-caption text-ink-subtle mt-2 text-center">
            {t("confirm.returning", { seconds: remaining })} · {t("confirm.tapToStay")}
          </p>
        </div>
      )}
    </div>
  );
}
