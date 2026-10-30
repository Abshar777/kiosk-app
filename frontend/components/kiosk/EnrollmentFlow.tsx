"use client";

import type {
  Course,
  CreatePaymentRequest,
  EnrollmentReceipt,
  GatewayOption,
  PaymentGatewayId,
  PaymentMethod,
  PosSaleStatus,
} from "@course-lms/shared";
import { Button, Input, Label, ListBox, Select, Spinner, TextField } from "@heroui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfig } from "@/app/providers";
import {
  AlertIcon,
  BankIcon,
  CardIcon,
  CheckIcon,
  ShieldIcon,
  UpiIcon,
} from "@/components/icons";
import { Dialog } from "@/components/ui/ResponsiveDialog";
import { ApiRequestError, api } from "@/lib/api";
import { formatCurrency, formatMobile } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { loadRazorpay, openRazorpayCheckout } from "@/lib/razorpay";
import { CardMachinePanel } from "./CardMachinePanel";
import { ConfirmationPanel } from "./ConfirmationPanel";

export type Stage =
  | "details"
  | "gateway"
  | "instrument"
  | "card_machine"
  | "processing"
  | "failed"
  | "success";

/**
 * Tiles for methods the kiosk collects itself. `card_present` is deliberately
 * absent — the card machine prompts for the card on its own screen, so there is
 * nothing for us to render.
 */
const METHOD_META = {
  upi: { icon: <UpiIcon />, labelKey: "payment.upi", hintKey: "payment.upiHint" },
  card: { icon: <CardIcon />, labelKey: "payment.card", hintKey: "payment.cardHint" },
  netbanking: {
    icon: <BankIcon />,
    labelKey: "payment.netbanking",
    hintKey: "payment.netbankingHint",
  },
} as const;

/** Methods the kiosk renders a tile for — `card_present` is prompted on the device. */
type TileableMethod = keyof typeof METHOD_META;

const hasTile = (method: PaymentMethod): method is TileableMethod => method in METHOD_META;

/** Mirrors the server's rules so the kiosk fails fast without a round-trip. */
function validateDetails(fullName: string, mobile: string) {
  const errors: Record<string, "required" | "invalid"> = {};

  const name = fullName.trim();
  if (!name) errors.fullName = "required";
  else if (!/^[\p{L}\p{M}][\p{L}\p{M}\s'.-]*$/u.test(name) || name.length < 2)
    errors.fullName = "invalid";

  const raw = mobile.trim();
  if (!raw) errors.mobile = "required";
  else {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15 || /^(\d)\1+$/.test(digits))
      errors.mobile = "invalid";
  }
  return errors;
}

function Field({
  label,
  value,
  onChange,
  onBlur,
  error,
  placeholder,
  type = "text",
  inputMode,
  autoComplete,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  placeholder?: string;
  type?: string;
  inputMode?: "text" | "tel" | "numeric";
  autoComplete?: string;
  maxLength?: number;
}) {
  return (
    <TextField
      className="w-full"
      isInvalid={Boolean(error)}
      onBlur={onBlur}
      onChange={onChange}
      type={type}
      value={value}
    >
      <Label className="type-label text-ink mb-2 block">{label}</Label>
      <Input
        autoComplete={autoComplete}
        className="min-h-touch w-full text-[17px]"
        inputMode={inputMode}
        maxLength={maxLength}
        placeholder={placeholder}
      />
      {error && (
        <p className="type-caption text-bad mt-2 flex items-center gap-1.5">
          <AlertIcon size={14} />
          {error}
        </p>
      )}
    </TextField>
  );
}

/** A large, tappable choice tile used for both gateways and payment methods. */
function ChoiceTile({
  icon,
  title,
  hint,
  isSelected,
  onSelect,
  badge,
}: {
  icon?: React.ReactNode;
  title: string;
  hint: string;
  isSelected: boolean;
  onSelect: () => void;
  badge?: string;
}) {
  return (
    <button
      className={`rounded-control ring-focus flex w-full items-start gap-3 p-4 text-start transition ${
        isSelected
          ? "ring-selected bg-surface-accent"
          : "bg-surface-sunken hover:bg-surface-accent"
      }`}
      data-ripple
      onClick={onSelect}
      type="button"
    >
      {icon && (
        <span className={`mt-0.5 shrink-0 ${isSelected ? "text-ink" : "text-ink-muted"}`}>
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="type-label text-ink">{title}</span>
          {badge && (
            <span className="bg-warn-bg text-warn type-caption rounded-full px-2 py-0.5 font-semibold">
              {badge}
            </span>
          )}
        </span>
        <span className="type-caption text-ink-muted mt-0.5 block">{hint}</span>
      </span>
      <span
        className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${
          isSelected ? "border-slate bg-slate text-white" : "border-hairline"
        }`}
      >
        {isSelected && <CheckIcon size={14} />}
      </span>
    </button>
  );
}

export function EnrollmentView({
  course,
  batchId,
  onBack,
  onDone,
  onStageChange,
}: {
  course: Course;
  batchId: string | null;
  onBack: () => void;
  onDone: () => void;
  onStageChange?: (stage: Stage) => void;
}) {
  const { t } = useI18n();
  const { config, banks } = useConfig();

  const [stage, setStage] = useState<Stage>("details");
  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const [enrollmentId, setEnrollmentId] = useState<string | null>(null);
  const [gateways, setGateways] = useState<GatewayOption[]>([]);
  const [gateway, setGateway] = useState<PaymentGatewayId>("razorpay");
  const [posStatus, setPosStatus] = useState<PosSaleStatus | null>(null);
  const posSaleIdRef = useRef<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("upi");
  const [instrument, setInstrument] = useState<Record<string, string>>({});
  const [busyMessage, setBusyMessage] = useState<string>("");
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<EnrollmentReceipt | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const methods = config.enabledPaymentMethods;

  useEffect(() => {
    onStageChange?.(stage);
  }, [onStageChange, stage]);

  useEffect(() => {
    api
      .gateways()
      .then((items) => {
        setGateways(items);
        if (items[0]) setGateway(items[0].id);
      })
      .catch(() => setGateways([]));
  }, []);

  useEffect(() => {
    setMethod((current) => (methods.includes(current) ? current : (methods[0] ?? "upi")));
  }, [methods]);

  const clientErrors = useMemo(() => validateDetails(fullName, mobile), [fullName, mobile]);

  const errorFor = (field: "fullName" | "mobile"): string | undefined => {
    if (serverErrors[field]) return serverErrors[field];
    if (!touched[field]) return undefined;
    const kind = clientErrors[field];
    if (!kind) return undefined;
    return field === "fullName"
      ? t(kind === "required" ? "enroll.error.nameRequired" : "enroll.error.nameInvalid")
      : t(kind === "required" ? "enroll.error.mobileRequired" : "enroll.error.mobileInvalid");
  };

  // ---- step 1: capture the two fields and hold a draft enrollment ----------
  const submitDetails = useCallback(async () => {
    setTouched({ fullName: true, mobile: true });
    setServerErrors({});
    setFormError(null);
    if (Object.keys(clientErrors).length > 0) return;

    setIsSubmitting(true);
    try {
      const enrollment = await api.createEnrollment({
        courseId: course.id,
        fullName: fullName.trim(),
        mobile: mobile.trim(),
        batchId,
      });
      setEnrollmentId(enrollment.id);
      setStage("gateway");
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setServerErrors(error.fields);
        if (Object.keys(error.fields).length === 0) setFormError(error.message);
      } else {
        setFormError(t("listing.loadError"));
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [batchId, clientErrors, course.id, fullName, mobile, t]);

  // ---- step 2a: hosted gateway (Razorpay) ---------------------------------
  const payWithHostedGateway = useCallback(async () => {
    if (!enrollmentId) return;
    setFailureReason(null);
    setBusyMessage(t("gateway.opening"));
    setStage("processing");

    try {
      await loadRazorpay();
      const intent = await api.paymentIntent(enrollmentId, gateway);
      const outcome = await openRazorpayCheckout(intent, {
        description: course.name,
        themeColor: "#3f4857",
      });

      if (outcome.status === "dismissed") {
        setFailureReason(t("gateway.cancelled"));
        setStage("failed");
        void api.recordPaymentFailure({
          enrollmentId,
          gateway,
          reason: "Checkout dismissed by the student",
        });
        return;
      }

      if (outcome.status === "failed") {
        setFailureReason(outcome.reason);
        setStage("failed");
        void api.recordPaymentFailure({ enrollmentId, gateway, reason: outcome.reason });
        return;
      }

      // The server re-verifies the signature; the browser's word isn't enough.
      setBusyMessage(t("gateway.verifying"));
      const result = await api.verifyPayment({
        enrollmentId,
        gateway,
        razorpayOrderId: outcome.payload.razorpay_order_id,
        razorpayPaymentId: outcome.payload.razorpay_payment_id,
        razorpaySignature: outcome.payload.razorpay_signature,
      });
      setReceipt(result.receipt);
      setStage("success");
    } catch (error) {
      setFailureReason(
        error instanceof ApiRequestError ? error.message : t("gateway.loadFailed"),
      );
      setStage("failed");
    }
  }, [course.name, enrollmentId, gateway, t]);

  // ---- step 2b: simulated gateway (inline instrument form) ----------------
  const payWithSimulatedGateway = useCallback(async () => {
    if (!enrollmentId) return;
    setServerErrors({});
    setFailureReason(null);
    setBusyMessage(t("payment.processing"));
    setStage("processing");

    const payload: CreatePaymentRequest = { enrollmentId, method, ...instrument };

    try {
      const result = await api.pay(payload);
      if (result.payment.status === "success") {
        setReceipt(result.receipt);
        setStage("success");
      } else {
        setFailureReason(result.payment.failureReason ?? t("payment.failed"));
        setStage("failed");
      }
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setServerErrors(error.fields);
        setFailureReason(error.message);
        setStage(Object.keys(error.fields).length > 0 ? "instrument" : "failed");
      } else {
        setFailureReason(t("payment.failed"));
        setStage("failed");
      }
    }
  }, [enrollmentId, instrument, method, t]);

  // ---- step 2c: card machine (POS terminal) -------------------------------
  //
  // The sale runs on the physical terminal, so the kiosk starts it and then
  // polls. A customer hunting for their card outlasts any HTTP timeout, which
  // is why this is not one long request.
  const payWithCardMachine = useCallback(async () => {
    if (!enrollmentId) return;
    setStage("card_machine");
    setPosStatus(null);

    try {
      const started = await api.startPosSale(enrollmentId);
      setPosStatus(started);
      posSaleIdRef.current = started.saleId;
    } catch (error) {
      setFailureReason(
        error instanceof ApiRequestError ? error.message : t("gateway.loadFailed"),
      );
      setStage("failed");
    }
  }, [enrollmentId, t]);

  const startPayment = useCallback(() => {
    if (gateway === "simulated") {
      setStage("instrument");
      return;
    }
    if (gateway === "pos_terminal") {
      void payWithCardMachine();
      return;
    }
    void payWithHostedGateway();
  }, [gateway, payWithCardMachine, payWithHostedGateway]);

  const cancelCardMachine = useCallback(() => {
    const saleId = posSaleIdRef.current;
    if (saleId) void api.cancelPosSale(saleId).catch(() => undefined);
  }, []);

  /**
   * Follows the sale until the terminal reaches a final state.
   *
   * Polls on a self-rescheduling timeout rather than setInterval: a slow
   * response must not stack up overlapping requests against a terminal that is
   * mid-authorisation. A transient poll failure is ignored — losing one reply
   * is not a reason to abandon a sale the customer is actively paying for.
   */
  useEffect(() => {
    if (stage !== "card_machine") return;
    const saleId = posSaleIdRef.current;
    if (!saleId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const next = await api.posSale(saleId);
        if (cancelled) return;
        setPosStatus(next);
        if (next.isTerminal) return;
      } catch {
        if (cancelled) return;
      }
      timer = setTimeout(poll, config.pos?.pollIntervalMs ?? 1000);
    };

    timer = setTimeout(poll, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [config.pos?.pollIntervalMs, stage]);

  /** Approval is the only path that advances; everything else stays put. */
  const finishCardMachine = useCallback(
    async (final: PosSaleStatus) => {
      if (final.state !== "approved") return;
      try {
        setBusyMessage(t("gateway.verifying"));
        setStage("processing");
        setReceipt(await api.receipt(final.enrollmentId));
        setStage("success");
      } catch (error) {
        setFailureReason(
          error instanceof ApiRequestError ? error.message : t("gateway.loadFailed"),
        );
        setStage("failed");
      }
    },
    [t],
  );

  const retry = useCallback(() => {
    setFailureReason(null);
    setStage(gateway === "simulated" ? "instrument" : "gateway");
  }, [gateway]);

  const total = formatCurrency(course.price, course.currency);
  const isSuccess = stage === "success";
  const selectedGateway = gateways.find((option) => option.id === gateway);

  const orderSummary = (
    <dl className="bg-surface-sunken rounded-control space-y-3 p-5">
      <div className="flex items-start justify-between gap-4">
        <dt className="type-caption text-ink-muted">{t("payment.course")}</dt>
        <dd className="type-body text-ink text-end font-medium">{course.name}</dd>
      </div>
      <div className="flex items-start justify-between gap-4">
        <dt className="type-caption text-ink-muted">{t("payment.student")}</dt>
        <dd className="type-body text-ink text-end font-medium">{fullName}</dd>
      </div>
      <div className="flex items-start justify-between gap-4">
        <dt className="type-caption text-ink-muted">{t("payment.mobile")}</dt>
        <dd className="type-body text-ink tabular text-end font-medium">
          {formatMobile(mobile)}
        </dd>
      </div>
      <div className="border-hairline flex items-center justify-between gap-4 border-t pt-3">
        <dt className="type-label text-ink">{t("payment.total")}</dt>
        <dd className="type-title text-ink tabular font-bold">{total}</dd>
      </div>
    </dl>
  );

  return (
    <div className="relative flex min-h-0 flex-col overflow-y-auto p-6 md:p-10">
      {stage !== "processing" && !isSuccess && (
        <Dialog.CloseTrigger
          aria-label={t("enroll.cancel")}
          className="text-ink-muted hover:bg-surface-sunken absolute end-4 top-4 z-10 grid h-12 w-12 place-items-center rounded-full transition"
        />
      )}

      {/* ------------------------------------------------------- details ---- */}
      {stage === "details" && (
        <>
          <Dialog.Header className="block p-0">
            <Dialog.Heading className="type-display text-ink">
              {t("enroll.heading")}
            </Dialog.Heading>
            <p className="type-body-lg text-ink-muted mt-2">{t("enroll.subheading")}</p>
          </Dialog.Header>

          <Dialog.Body className="p-0">
            <div className="bg-surface-sunken rounded-control mt-6 flex items-center justify-between gap-4 p-4">
              <span className="type-label text-ink min-w-0 truncate">{course.name}</span>
              <span className="type-label text-ink tabular shrink-0">{total}</span>
            </div>

            <div className="mt-6 space-y-4">
              <Field
                autoComplete="name"
                error={errorFor("fullName")}
                label={t("enroll.fullName")}
                onBlur={() => setTouched((prev) => ({ ...prev, fullName: true }))}
                onChange={setFullName}
                placeholder={t("enroll.fullNamePlaceholder")}
                value={fullName}
              />
              <Field
                autoComplete="tel"
                error={errorFor("mobile")}
                inputMode="tel"
                label={t("enroll.mobile")}
                maxLength={20}
                onBlur={() => setTouched((prev) => ({ ...prev, mobile: true }))}
                onChange={setMobile}
                placeholder={t("enroll.mobilePlaceholder")}
                type="tel"
                value={mobile}
              />
            </div>

            {formError && (
              <p className="bg-bad-bg text-bad type-body rounded-control mt-4 flex items-center gap-2 p-3">
                <AlertIcon size={18} />
                {formError}
              </p>
            )}
          </Dialog.Body>

          <Dialog.Footer className="mt-8 block p-0">
            <Button
              className="w-full"
              isDisabled={isSubmitting}
              onPress={submitDetails}
              size="lg"
              variant="primary"
            >
              {isSubmitting ? <Spinner size="sm" /> : t("enroll.continue")}
            </Button>
            <Button
              className="mt-3 w-full"
              onPress={onBack}
              size="lg"
              variant="secondary"
            >
              {t("common.back")}
            </Button>
          </Dialog.Footer>
        </>
      )}

      {/* ------------------------------------------- gateway selection ------ */}
      {stage === "gateway" && (
        <>
          <Dialog.Header className="block p-0">
            <Dialog.Heading className="type-title text-ink">
              {t("gateway.heading")}
            </Dialog.Heading>
            <p className="type-body text-ink-muted mt-2">{t("gateway.subheading")}</p>
          </Dialog.Header>

          <Dialog.Body className="p-0">
            <div className="mt-5">{orderSummary}</div>

            <div className="mt-5 space-y-3">
              {gateways.map((option) => (
                <ChoiceTile
                  badge={option.isTestMode ? t("gateway.testMode") : undefined}
                  hint={option.description}
                  icon={<ShieldIcon />}
                  isSelected={gateway === option.id}
                  key={option.id}
                  onSelect={() => setGateway(option.id)}
                  title={option.name}
                />
              ))}
              {gateways.length === 0 && (
                <p className="type-body text-ink-muted">{t("common.loading")}…</p>
              )}
            </div>

            <p className="type-caption text-ink-subtle mt-4">{t("payment.securityNote")}</p>
          </Dialog.Body>

          <Dialog.Footer className="mt-8 block p-0">
            <Button
              className="w-full"
              isDisabled={!selectedGateway}
              onPress={startPayment}
              size="lg"
              variant="primary"
            >
              {t("gateway.continue")} · {total}
            </Button>
            <Button
              className="mt-3 w-full"
              onPress={() => setStage("details")}
              size="lg"
              variant="secondary"
            >
              {t("common.back")}
            </Button>
          </Dialog.Footer>
        </>
      )}

      {/* -------------------------- simulated gateway instrument form ------- */}
      {stage === "instrument" && (
        <>
          <Dialog.Header className="block p-0">
            <Dialog.Heading className="type-title text-ink">
              {t("payment.heading")}
            </Dialog.Heading>
          </Dialog.Header>

          <Dialog.Body className="p-0">
            <div className="mt-5">{orderSummary}</div>

            <h3 className="type-label text-ink mt-6">{t("payment.method")}</h3>
            <div className="mt-3 space-y-3">
              {methods.filter(hasTile).map((option) => {
                const meta = METHOD_META[option];
                return (
                  <ChoiceTile
                    hint={t(meta.hintKey)}
                    icon={meta.icon}
                    isSelected={method === option}
                    key={option}
                    onSelect={() => {
                      setMethod(option);
                      setInstrument({});
                      setServerErrors({});
                    }}
                    title={t(meta.labelKey)}
                  />
                );
              })}
            </div>

            <div className="mt-5 space-y-4">
              {method === "upi" && (
                <Field
                  error={serverErrors.upiId}
                  label={t("payment.upiId")}
                  onChange={(value) => setInstrument({ upiId: value })}
                  placeholder={t("payment.upiIdPlaceholder")}
                  value={instrument.upiId ?? ""}
                />
              )}

              {method === "card" && (
                <>
                  <Field
                    autoComplete="cc-number"
                    error={serverErrors.cardNumber}
                    inputMode="numeric"
                    label={t("payment.cardNumber")}
                    maxLength={19}
                    onChange={(value) =>
                      setInstrument((prev) => ({ ...prev, cardNumber: value }))
                    }
                    placeholder="4242 4242 4242 4242"
                    value={instrument.cardNumber ?? ""}
                  />
                  <Field
                    autoComplete="cc-name"
                    error={serverErrors.cardHolder}
                    label={t("payment.cardHolder")}
                    onChange={(value) =>
                      setInstrument((prev) => ({ ...prev, cardHolder: value }))
                    }
                    value={instrument.cardHolder ?? ""}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <Field
                      autoComplete="cc-exp"
                      error={serverErrors.cardExpiry}
                      inputMode="numeric"
                      label={t("payment.cardExpiry")}
                      maxLength={5}
                      onChange={(value) =>
                        setInstrument((prev) => ({ ...prev, cardExpiry: value }))
                      }
                      placeholder="12/29"
                      value={instrument.cardExpiry ?? ""}
                    />
                    <Field
                      autoComplete="cc-csc"
                      error={serverErrors.cardCvv}
                      inputMode="numeric"
                      label={t("payment.cardCvv")}
                      maxLength={4}
                      onChange={(value) =>
                        setInstrument((prev) => ({ ...prev, cardCvv: value }))
                      }
                      placeholder="123"
                      type="password"
                      value={instrument.cardCvv ?? ""}
                    />
                  </div>
                </>
              )}

              {method === "netbanking" && (
                <Select
                  className="w-full"
                  onChange={(key) => setInstrument({ bankCode: String(key ?? "") })}
                  placeholder={t("payment.bank")}
                  value={instrument.bankCode ?? null}
                >
                  <Label className="type-label text-ink mb-2 block">{t("payment.bank")}</Label>
                  <Select.Trigger className="min-h-touch w-full">
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {banks.map((bank) => (
                        <ListBox.Item id={bank.code} key={bank.code} textValue={bank.name}>
                          {bank.name}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              )}
            </div>
          </Dialog.Body>

          <Dialog.Footer className="mt-8 block p-0">
            <Button
              className="w-full"
              onPress={payWithSimulatedGateway}
              size="lg"
              variant="primary"
            >
              {t("payment.pay", { amount: total })}
            </Button>
            <Button
              className="mt-3 w-full"
              onPress={() => setStage("gateway")}
              size="lg"
              variant="secondary"
            >
              {t("common.back")}
            </Button>
          </Dialog.Footer>
        </>
      )}

      {/* ---------------------------------------------------- processing ---- */}
      {stage === "card_machine" && (
        <CardMachinePanel
          onCancel={cancelCardMachine}
          onDone={(final) => void finishCardMachine(final)}
          onRetry={() => void payWithCardMachine()}
          status={posStatus}
        />
      )}

      {stage === "processing" && (
        <div className="flex min-h-[380px] flex-col items-center justify-center gap-5 text-center">
          <Spinner size="xl" />
          <p className="type-title text-ink">{busyMessage || t("payment.processing")}</p>
          <p className="type-body-lg text-ink-muted">{t("payment.processingHint")}</p>
          <p className="type-title text-ink tabular mt-2 font-bold">{total}</p>
        </div>
      )}

      {/* -------------------------------------------------------- failed ---- */}
      {stage === "failed" && (
        <>
          <Dialog.Header className="block p-0">
            <Dialog.Heading className="type-title text-ink">
              {t("payment.failed")}
            </Dialog.Heading>
          </Dialog.Header>

          <Dialog.Body className="p-0">
            <div className="bg-bad-bg rounded-control mt-5 flex gap-3 p-4">
              <span className="text-bad mt-0.5 shrink-0">
                <AlertIcon size={20} />
              </span>
              <p className="type-body text-ink">{failureReason}</p>
            </div>
            <div className="mt-5">{orderSummary}</div>
          </Dialog.Body>

          <Dialog.Footer className="mt-8 block p-0">
            <Button className="w-full" onPress={retry} size="lg" variant="primary">
              {t("payment.retry")}
            </Button>
            <Button
              className="mt-3 w-full"
              onPress={() => setStage("gateway")}
              size="lg"
              variant="secondary"
            >
              {t("payment.changeMethod")}
            </Button>
          </Dialog.Footer>
        </>
      )}

      {/* ------------------------------------------------------- success ---- */}
      {isSuccess && receipt && (
        <ConfirmationPanel
          autoPrint={config.kiosk.autoPrintReceipt}
          autoPrintDelayMs={config.kiosk.autoPrintDelayMs}
          autoReturnSeconds={config.kiosk.autoReturnSeconds}
          onAnother={onDone}
          receipt={receipt}
        />
      )}

      {isSuccess && !receipt && (
        <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 text-center">
          <span className="bg-brand text-brand-ink grid h-18 w-18 place-items-center rounded-full">
            <CheckIcon size={36} />
          </span>
          <p className="type-title text-ink">{t("confirm.heading")}</p>
          <Button onPress={onDone} size="lg" variant="primary">
            {t("confirm.another")}
          </Button>
        </div>
      )}
    </div>
  );
}
