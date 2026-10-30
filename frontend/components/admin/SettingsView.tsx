"use client";

import type {
  AcademyConfig,
  AppConfig,
  KioskConfig,
  PaymentMethod,
  PosConfig,
  PosLanConfig,
  PosSerialConfig,
} from "@course-lms/shared";
import { PAYMENT_METHODS } from "@course-lms/shared";
import { Button, Spinner, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertIcon, CheckIcon, TrashIcon, UploadIcon } from "@/components/icons";
import {
  FieldGrid,
  NumberSetting,
  PosSettingsSection,
  SelectSetting,
  SettingsCard,
  SwitchSetting,
  TextSetting,
} from "@/components/admin/PosSettingsSection";
import { ErrorState, PageHeader, useAdminQuery } from "@/components/admin/primitives";
import { adminApi, resolveImageUrl } from "@/lib/api";
import { LOCALE_NAMES, LOCALES } from "@/lib/i18n/dictionaries";
import { useI18n } from "@/lib/i18n/provider";

/* -------------------------------------------------------------------------- */
/* Change tracking                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The PATCH body the API actually accepts: every section is merged field by
 * field, so a patch may name one key and leave the rest untouched. The shared
 * `Partial<AppConfig>` cannot express that — it types each section as complete —
 * so the request is built against this shape and cast once at the call.
 */
interface ConfigPatch {
  academy?: Partial<AcademyConfig>;
  kiosk?: Partial<KioskConfig>;
  enabledPaymentMethods?: PaymentMethod[];
  pos?: Partial<Omit<PosConfig, "lan" | "serial">> & {
    lan?: Partial<PosLanConfig>;
    serial?: Partial<PosSerialConfig>;
  };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Keys whose value differs from the loaded original. Indexing is done through
 * `Record<string, unknown>` because the config sections are interfaces, which
 * carry no index signature of their own.
 */
function changedFields<T extends object>(base: T, draft: T): Partial<T> | undefined {
  const patch: Record<string, unknown> = {};
  const from = base as Record<string, unknown>;
  const to = draft as Record<string, unknown>;
  let isDirty = false;

  for (const key of Object.keys(to)) {
    if (same(from[key], to[key])) continue;
    patch[key] = to[key];
    isDirty = true;
  }

  return isDirty ? (patch as Partial<T>) : undefined;
}

function buildPatch(base: AppConfig, draft: AppConfig): ConfigPatch {
  const patch: ConfigPatch = {};

  const academy = changedFields(base.academy, draft.academy);
  if (academy) patch.academy = academy;

  const kiosk = changedFields(base.kiosk, draft.kiosk);
  if (kiosk) patch.kiosk = kiosk;

  if (!same(base.enabledPaymentMethods, draft.enabledPaymentMethods)) {
    patch.enabledPaymentMethods = draft.enabledPaymentMethods;
  }

  const pos = changedFields(base.pos, draft.pos);
  if (pos) {
    const { lan, serial, ...flat } = pos;
    patch.pos = {
      ...flat,
      ...(lan === undefined ? {} : { lan: changedFields(base.pos.lan, draft.pos.lan) }),
      ...(serial === undefined
        ? {}
        : { serial: changedFields(base.pos.serial, draft.pos.serial) }),
    };
  }

  return patch;
}

/* -------------------------------------------------------------------------- */
/* Save state                                                                 */
/* -------------------------------------------------------------------------- */

type SaveState =
  | { phase: "clean" }
  | { phase: "dirty" }
  | { phase: "saving" }
  | { phase: "saved" }
  | { phase: "failed"; message: string };

function SaveStatus({ state }: { state: SaveState }) {
  if (state.phase === "clean") return null;

  if (state.phase === "saving") {
    return (
      <span className="type-caption text-ink-muted flex items-center gap-2">
        <Spinner size="sm" />
        Saving…
      </span>
    );
  }

  if (state.phase === "saved") {
    return (
      <span className="type-caption text-ok flex items-center gap-1.5">
        <CheckIcon size={14} />
        Saved
      </span>
    );
  }

  if (state.phase === "failed") {
    return (
      <span className="type-caption text-bad flex items-center gap-1.5">
        <AlertIcon size={14} />
        {state.message}
      </span>
    );
  }

  return <span className="type-caption text-warn">Unsaved changes</span>;
}

/* -------------------------------------------------------------------------- */
/* Logo                                                                       */
/* -------------------------------------------------------------------------- */

function LogoField({
  logoUrl,
  onChange,
}: {
  logoUrl: string | null;
  onChange: (url: string | null) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setIsUploading(true);
    setError(null);
    try {
      const { url } = await adminApi.uploadImage(file);
      onChange(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="sm:col-span-2">
      <p className="type-label text-ink mb-2">Logo</p>

      <div className="flex flex-wrap items-center gap-4">
        <div className="bg-surface-sunken rounded-control grid h-20 w-32 shrink-0 place-items-center overflow-hidden">
          {logoUrl ? (
            /*
             * A plain <img>, not next/image: this field accepts any URL the
             * operator types, and next/image throws at runtime for a host that
             * is not in remotePatterns. An admin preview must not crash the page.
             */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt="Academy logo"
              className="max-h-20 max-w-32 object-contain"
              src={resolveImageUrl(logoUrl)}
            />
          ) : (
            <span className="type-caption text-ink-subtle">No logo</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Reset first, so picking the same file again still fires onChange.
              event.target.value = "";
              if (file) void upload(file);
            }}
            ref={inputRef}
            type="file"
          />
          <Button
            className="min-h-14"
            isDisabled={isUploading}
            onPress={() => inputRef.current?.click()}
            variant="secondary"
          >
            {isUploading ? <Spinner size="sm" /> : <UploadIcon size={18} />}
            {t("admin.action.upload")}
          </Button>
          {logoUrl !== null && (
            <Button
              className="min-h-14"
              isDisabled={isUploading}
              onPress={() => onChange(null)}
              variant="ghost"
            >
              <TrashIcon size={18} />
              Remove
            </Button>
          )}
        </div>
      </div>

      {error !== null && (
        <p className="type-caption text-bad mt-2 flex items-center gap-1.5">
          <AlertIcon size={14} />
          {error}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Payment methods                                                            */
/* -------------------------------------------------------------------------- */

const METHOD_LABEL: Record<PaymentMethod, string> = {
  upi: "UPI",
  card: "Card (online)",
  netbanking: "Net banking",
  card_present: "Card machine (in person)",
};

/* -------------------------------------------------------------------------- */
/* View                                                                       */
/* -------------------------------------------------------------------------- */

export function SettingsView() {
  const { t } = useI18n();
  const query = useAdminQuery<AppConfig>(() => adminApi.config());

  // `original` is what the server last confirmed; `draft` is what is on screen.
  // The patch sent on save is the difference between the two.
  const [original, setOriginal] = useState<AppConfig | null>(null);
  const [draft, setDraft] = useState<AppConfig | null>(null);
  const [save, setSave] = useState<SaveState>({ phase: "clean" });

  useEffect(() => {
    if (!query.data) return;
    setOriginal(query.data);
    setDraft(query.data);
    // A successful save pushes the server's echo back through `query.setData`,
    // which re-runs this effect. It must not wipe the "Saved" confirmation set
    // in that same batch — it is the only signal the operator gets that a
    // settings write landed. The next edit clears it through `edit()`.
    setSave((current) => (current.phase === "saved" ? current : { phase: "clean" }));
  }, [query.data]);

  const edit = useCallback((apply: (current: AppConfig) => AppConfig) => {
    setDraft((current) => (current === null ? current : apply(current)));
    // Any edit invalidates the previous save outcome, success or failure.
    setSave({ phase: "dirty" });
  }, []);

  const patchAcademy = (patch: Partial<AcademyConfig>) =>
    edit((current) => ({ ...current, academy: { ...current.academy, ...patch } }));
  const patchKiosk = (patch: Partial<KioskConfig>) =>
    edit((current) => ({ ...current, kiosk: { ...current.kiosk, ...patch } }));

  const submit = useCallback(async () => {
    if (original === null || draft === null) return;
    const patch = buildPatch(original, draft);
    if (Object.keys(patch).length === 0) {
      setSave({ phase: "clean" });
      return;
    }

    setSave({ phase: "saving" });
    try {
      const saved = await adminApi.updateConfig(patch as Partial<AppConfig>);
      // Trust the server's echo over the draft, so a value it normalised or
      // rejected shows up here rather than silently diverging.
      setOriginal(saved);
      setDraft(saved);
      query.setData(saved);
      setSave({ phase: "saved" });
    } catch (cause) {
      setSave({
        phase: "failed",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, [draft, original, query]);

  if (query.isLoading && draft === null) {
    return (
      <div aria-busy="true" className="flex min-h-64 items-center justify-center" role="status">
        <Spinner />
        <span className="type-body text-ink-muted ms-3">{t("admin.state.loading")}</span>
      </div>
    );
  }

  if (query.error) return <ErrorState error={query.error} onRetry={query.reload} />;
  if (draft === null) return null;

  const isDirty = original !== null && !same(original, draft);

  return (
    <div>
      <PageHeader
        actions={
          <>
            <SaveStatus state={save} />
            <Button
              className="min-h-14"
              isDisabled={!isDirty || save.phase === "saving"}
              onPress={() => void submit()}
              variant="primary"
            >
              {save.phase === "saving" && <Spinner size="sm" />}
              {t("admin.action.save")}
            </Button>
          </>
        }
        description="Academy details, kiosk behaviour and payment hardware."
        title={t("admin.nav.settings")}
      />

      <div className="flex flex-col gap-6">
        <SettingsCard
          description="Shown in the kiosk header, on receipts and on the help screen."
          title="Academy"
        >
          <FieldGrid>
            <TextSetting
              label="Name"
              onChange={(next) => patchAcademy({ name: next })}
              value={draft.academy.name}
            />
            <TextSetting
              label="Tagline"
              onChange={(next) => patchAcademy({ tagline: next })}
              value={draft.academy.tagline}
            />

            <LogoField
              logoUrl={draft.academy.logoUrl}
              onChange={(next) => patchAcademy({ logoUrl: next })}
            />

            <TextSetting
              inputMode="tel"
              label="Contact phone"
              onChange={(next) => patchAcademy({ contactPhone: next })}
              value={draft.academy.contactPhone}
            />
            <TextSetting
              hint="Offered to students when something goes wrong mid-enrollment."
              inputMode="tel"
              label="Support number"
              onChange={(next) => patchAcademy({ supportNumber: next })}
              value={draft.academy.supportNumber}
            />
            <TextSetting
              inputMode="email"
              label="Email"
              onChange={(next) => patchAcademy({ email: next })}
              type="email"
              value={draft.academy.email}
            />
            <TextSetting
              inputMode="url"
              label="Website"
              onChange={(next) => patchAcademy({ website: next })}
              value={draft.academy.website}
            />
            <TextSetting
              label="Address"
              onChange={(next) => patchAcademy({ address: next })}
              value={draft.academy.address}
            />
          </FieldGrid>
        </SettingsCard>

        <SettingsCard
          description="Timers, printing and the languages offered on the kiosk."
          title="Kiosk"
        >
          <div className="flex flex-col gap-5">
            <FieldGrid>
              <NumberSetting
                hint="Countdown on the confirmation screen before returning to the course list."
                label="Auto-return (seconds)"
                maxValue={600}
                minValue={5}
                onChange={(next) => patchKiosk({ autoReturnSeconds: next })}
                value={draft.kiosk.autoReturnSeconds}
              />
              <NumberSetting
                hint="Inactivity anywhere in the flow before it resets. 0 disables it."
                label="Idle reset (seconds)"
                maxValue={3600}
                minValue={0}
                onChange={(next) => patchKiosk({ idleResetSeconds: next })}
                value={draft.kiosk.idleResetSeconds}
              />
            </FieldGrid>

            <SwitchSetting
              hint="Needs Chrome's --kiosk-printing flag to print without a dialog."
              isSelected={draft.kiosk.autoPrintReceipt}
              label="Print the receipt automatically"
              onChange={(next) => patchKiosk({ autoPrintReceipt: next })}
            />

            <FieldGrid>
              <NumberSetting
                hint="Grace period so the confirmation screen is painted before printing."
                isDisabled={!draft.kiosk.autoPrintReceipt}
                label="Auto-print delay (ms)"
                maxValue={10000}
                minValue={0}
                onChange={(next) => patchKiosk({ autoPrintDelayMs: next })}
                step={100}
                value={draft.kiosk.autoPrintDelayMs}
              />
              <SelectSetting
                hint="The language the kiosk starts in after every reset."
                label="Default language"
                onChange={(next) => patchKiosk({ defaultLanguage: next })}
                options={draft.kiosk.availableLanguages.map((code) => ({
                  id: code,
                  label: LOCALE_NAMES[code as keyof typeof LOCALE_NAMES] ?? code,
                }))}
                value={draft.kiosk.defaultLanguage}
              />
            </FieldGrid>

            <div>
              <p className="type-label text-ink mb-2">Available languages</p>
              <ToggleButtonGroup
                aria-label="Available languages"
                disallowEmptySelection
                onSelectionChange={(keys) => {
                  const selected = [...keys].map(String);
                  edit((current) => {
                    // Filter through the canonical list, as the payment methods
                    // below do: React Aria hands the selection back in the order
                    // the operator touched the buttons, and this array is the
                    // order KioskHeader cycles the language toggle through.
                    const availableLanguages: string[] = LOCALES.filter((locale) =>
                      selected.includes(locale),
                    );
                    return {
                      ...current,
                      kiosk: {
                        ...current.kiosk,
                        availableLanguages,
                        // Dropping the default language would leave the kiosk
                        // booting into a locale its own toggle no longer offers,
                        // since providers.tsx feeds this straight to I18nProvider.
                        defaultLanguage: availableLanguages.includes(
                          current.kiosk.defaultLanguage,
                        )
                          ? current.kiosk.defaultLanguage
                          : (availableLanguages[0] ?? current.kiosk.defaultLanguage),
                      },
                    };
                  });
                }}
                selectedKeys={draft.kiosk.availableLanguages}
                selectionMode="multiple"
              >
                {LOCALES.map((locale) => (
                  <ToggleButton className="min-h-14" id={locale} key={locale}>
                    {LOCALE_NAMES[locale]}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
              <p className="type-caption text-ink-subtle mt-2">
                Only these appear in the kiosk's language toggle.
              </p>
            </div>

            <FieldGrid>
              <TextSetting
                hint="ISO code used for formatting, e.g. AED."
                label="Currency"
                onChange={(next) => patchKiosk({ currency: next })}
                value={draft.kiosk.currency}
              />
              <TextSetting
                hint="Shown next to every price."
                label="Currency symbol"
                onChange={(next) => patchKiosk({ currencySymbol: next })}
                value={draft.kiosk.currencySymbol}
              />
            </FieldGrid>
          </div>
        </SettingsCard>

        <SettingsCard
          description="What the student can choose from on the payment screen."
          title="Payments"
        >
          <ToggleButtonGroup
            aria-label="Enabled payment methods"
            onSelectionChange={(keys) =>
              edit((current) => ({
                ...current,
                // Filter through the canonical list so the saved order is stable
                // and an unknown key can never reach the API.
                enabledPaymentMethods: PAYMENT_METHODS.filter((method) =>
                  [...keys].map(String).includes(method),
                ),
              }))
            }
            selectedKeys={draft.enabledPaymentMethods}
            selectionMode="multiple"
          >
            {PAYMENT_METHODS.map((method) => (
              <ToggleButton className="min-h-14" id={method} key={method}>
                {METHOD_LABEL[method]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          {draft.enabledPaymentMethods.length === 0 && (
            <p className="type-caption text-warn mt-3 flex items-center gap-1.5">
              <AlertIcon size={14} />
              With none selected the kiosk cannot take payment at all.
            </p>
          )}
          {draft.enabledPaymentMethods.includes("card_present") && !draft.pos.isEnabled && (
            <p className="type-caption text-warn mt-3 flex items-center gap-1.5">
              <AlertIcon size={14} />
              Card machine payment is offered but the terminal below is switched off.
            </p>
          )}
        </SettingsCard>

        <PosSettingsSection
          onChange={(next) => edit((current) => ({ ...current, pos: next }))}
          value={draft.pos}
        />
      </div>
    </div>
  );
}
