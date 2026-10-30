"use client";

import type {
  PosConfig,
  PosLanConfig,
  PosSerialConfig,
  PosTestResult,
  PosTransport,
  SerialPortInfo,
} from "@course-lms/shared";
import { POS_TRANSPORTS } from "@course-lms/shared";
import {
  Button,
  Input,
  Label,
  ListBox,
  NumberField,
  Select,
  Spinner,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from "@heroui/react";
import { useCallback, useRef, useState } from "react";
import {
  AlertIcon,
  CheckCircleIcon,
  RefreshIcon,
  XCircleIcon,
} from "@/components/icons";
import { API_URL, ApiRequestError } from "@/lib/api";
import { useI18n } from "@/lib/i18n/provider";

/* -------------------------------------------------------------------------- */
/* Shared field vocabulary                                                    */
/* -------------------------------------------------------------------------- */

/*
 * These live here rather than in admin/primitives.tsx so that the settings page
 * and this section share one set of controls with a one-way import — putting
 * them in SettingsView would make the two modules import each other.
 */

export function SettingsCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface rounded-card p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="type-heading text-ink">{title}</h2>
          {description !== undefined && (
            <p className="type-body text-ink-muted mt-1">{description}</p>
          )}
        </div>
        {action !== undefined && <div className="flex items-center gap-3">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** Two columns from 640px up; one below, so a tablet in portrait still reads. */
export function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

export function TextSetting({
  label,
  value,
  onChange,
  hint,
  placeholder,
  type = "text",
  inputMode,
  isDisabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  placeholder?: string;
  type?: string;
  inputMode?: "text" | "tel" | "numeric" | "email" | "url";
  isDisabled?: boolean;
}) {
  return (
    <TextField
      className="w-full"
      isDisabled={isDisabled}
      onChange={onChange}
      type={type}
      value={value}
    >
      <Label className="type-label text-ink mb-2 block">{label}</Label>
      <Input className="min-h-14 w-full" inputMode={inputMode} placeholder={placeholder} />
      {hint !== undefined && <p className="type-caption text-ink-subtle mt-1.5">{hint}</p>}
    </TextField>
  );
}

export function NumberSetting({
  label,
  value,
  onChange,
  hint,
  minValue = 0,
  maxValue,
  step = 1,
  isDisabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint?: string;
  minValue?: number;
  maxValue?: number;
  step?: number;
  isDisabled?: boolean;
}) {
  return (
    <NumberField
      className="w-full"
      isDisabled={isDisabled}
      maxValue={maxValue}
      minValue={minValue}
      // Clearing the input reports NaN; writing that into config would send
      // `null` to the API and wipe a working value.
      onChange={(next) => {
        if (!Number.isNaN(next)) onChange(next);
      }}
      step={step}
      value={value}
    >
      <Label className="type-label text-ink mb-2 block">{label}</Label>
      <NumberField.Group className="min-h-14 w-full">
        <NumberField.Input className="tabular w-full" />
        <NumberField.DecrementButton />
        <NumberField.IncrementButton />
      </NumberField.Group>
      {hint !== undefined && <p className="type-caption text-ink-subtle mt-1.5">{hint}</p>}
    </NumberField>
  );
}

export function SwitchSetting({
  label,
  hint,
  isSelected,
  onChange,
  isDisabled = false,
}: {
  label: string;
  hint?: string;
  isSelected: boolean;
  onChange: (value: boolean) => void;
  isDisabled?: boolean;
}) {
  return (
    <Switch
      className="bg-surface-sunken rounded-control flex w-full flex-col items-start p-4"
      isDisabled={isDisabled}
      isSelected={isSelected}
      onChange={onChange}
    >
      {/*
        A span, not <Label>: Switch.Content already renders the <label> that
        owns the hidden input, and a nested <label> swallows the click instead
        of forwarding it — the text looks tappable but does nothing. The span's
        text still supplies the accessible name through the wrapping label.
      */}
      <Switch.Content className="flex min-h-10 w-full items-center gap-3">
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
        <span className="type-label text-ink">{label}</span>
      </Switch.Content>
      {hint !== undefined && (
        <p className="type-caption text-ink-subtle mt-1.5">{hint}</p>
      )}
    </Switch>
  );
}

export interface SelectOption {
  id: string;
  label: string;
}

export function SelectSetting({
  label,
  value,
  onChange,
  options,
  hint,
  isDisabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  hint?: string;
  isDisabled?: boolean;
}) {
  return (
    // HeroUI v3 Select is controlled with value/onChange — React Aria's
    // selectedKey/onSelectionChange silently does nothing here.
    <Select
      className="w-full"
      isDisabled={isDisabled}
      onChange={(key) => onChange(String(key ?? ""))}
      value={value}
    >
      <Label className="type-label text-ink mb-2 block">{label}</Label>
      <Select.Trigger className="min-h-14 w-full">
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item id={option.id} key={option.id} textValue={option.label}>
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
      {hint !== undefined && <p className="type-caption text-ink-subtle mt-1.5">{hint}</p>}
    </Select>
  );
}

/* -------------------------------------------------------------------------- */
/* POS endpoints                                                              */
/* -------------------------------------------------------------------------- */

/*
 * The two terminal-setup endpoints are not in lib/api.ts yet, so this file
 * repeats its contract locally rather than editing a shared module: same-origin
 * /api unless an absolute origin was compiled in, the admin token header when
 * one exists, and ApiRequestError on failure so the existing error UI applies.
 */
function adminUrl(path: string): string {
  const origin =
    API_URL || (typeof window === "undefined" ? "http://localhost" : window.location.origin);
  return new URL(path, origin).toString();
}

async function posRequest<T>(path: string, body?: unknown): Promise<T> {
  const token = process.env.NEXT_PUBLIC_ADMIN_TOKEN;
  const hasBody = body !== undefined;

  let response: Response;
  try {
    response = await fetch(adminUrl(path), {
      method: hasBody ? "POST" : "GET",
      headers: {
        ...(token ? { "X-Admin-Token": token } : {}),
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiRequestError(0, "NETWORK_ERROR", "Cannot reach the server.");
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiRequestError(
      response.status,
      payload?.error?.code ?? "REQUEST_FAILED",
      payload?.error?.message ?? `Request failed with status ${response.status}`,
    );
  }

  return (await response.json()) as T;
}

/* -------------------------------------------------------------------------- */
/* Static option lists                                                        */
/* -------------------------------------------------------------------------- */

const TRANSPORT_LABEL: Record<PosTransport, string> = {
  lan: "Network (LAN)",
  serial: "USB cable (serial)",
  mock: "Mock — no hardware",
};

const TRANSPORT_HINT: Record<PosTransport, string> = {
  lan: "The terminal has its own IP address on the kiosk's network.",
  serial: "The terminal is cabled to this machine and appears as a serial port.",
  /*
   * Mock exists so the whole card-present flow — prompt, poll, approve, print —
   * can be demonstrated and tested on a machine with no terminal attached and
   * no acquirer account. It is the only transport that touches no hardware.
   */
  mock: "A simulated terminal, for demos and testing without a card machine.",
};

/** Standard RS-232 rates. The one to use is whatever the acquirer configured
 *  on the terminal — we cannot derive it, so the operator picks it. */
const BAUD_RATES = [9600, 19200, 38400, 57600, 115200];

const PARITY_OPTIONS: SelectOption[] = [
  { id: "none", label: "None" },
  { id: "even", label: "Even" },
  { id: "odd", label: "Odd" },
];

/* -------------------------------------------------------------------------- */
/* Test connection                                                            */
/* -------------------------------------------------------------------------- */

type TestState =
  | { phase: "idle" }
  | { phase: "pending" }
  | { phase: "done"; result: PosTestResult }
  | { phase: "error"; message: string };

function TestResultBanner({ state }: { state: TestState }) {
  if (state.phase === "idle" || state.phase === "pending") return null;

  const isOk = state.phase === "done" && state.result.ok;
  const message = state.phase === "done" ? state.result.message : state.message;
  const latency = state.phase === "done" ? state.result.latencyMs : null;

  return (
    <div
      className={`rounded-control mt-4 flex items-start gap-3 p-4 ${
        isOk ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"
      }`}
      role="status"
    >
      <span className="mt-0.5 shrink-0">
        {isOk ? <CheckCircleIcon size={18} /> : <XCircleIcon size={18} />}
      </span>
      <div className="min-w-0">
        <p className="type-label">{isOk ? "Terminal responded" : "No answer from the terminal"}</p>
        <p className="type-caption mt-1 break-words">{message}</p>
        {latency !== null && (
          <p className="type-caption tabular mt-1 opacity-80">Round trip {latency} ms</p>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Section                                                                    */
/* -------------------------------------------------------------------------- */

export function PosSettingsSection({
  value,
  onChange,
}: {
  value: PosConfig;
  onChange: (next: PosConfig) => void;
}) {
  const { t } = useI18n();

  const [ports, setPorts] = useState<SerialPortInfo[] | null>(null);
  const [portsError, setPortsError] = useState<string | null>(null);
  const [isLoadingPorts, setIsLoadingPorts] = useState(false);
  const [test, setTest] = useState<TestState>({ phase: "idle" });

  /*
   * A probe result only describes the settings it ran against, so any edit to
   * how we reach the terminal retires it — both a finished banner and a probe
   * still in flight. The in-flight half matters: a LAN probe waits up to 8s,
   * which is ample time to retype an address, and its answer must not come
   * back and present itself as a verdict on what is now on screen. A surviving
   * green "Terminal responded" is the dangerous direction — it reads as "this
   * configuration is verified" when it is not.
   */
  const testSeq = useRef(0);
  const retireTest = () => {
    testSeq.current += 1;
    setTest((current) => (current.phase === "idle" ? current : { phase: "idle" }));
  };

  const set = <K extends keyof PosConfig>(key: K, next: PosConfig[K]) =>
    onChange({ ...value, [key]: next });
  const setLan = (patch: Partial<PosLanConfig>) => {
    retireTest();
    onChange({ ...value, lan: { ...value.lan, ...patch } });
  };
  const setSerial = (patch: Partial<PosSerialConfig>) => {
    retireTest();
    onChange({ ...value, serial: { ...value.serial, ...patch } });
  };

  const loadPorts = useCallback(async () => {
    setIsLoadingPorts(true);
    setPortsError(null);
    try {
      const data = await posRequest<{ items: SerialPortInfo[] }>(
        "/api/admin/pos/serial-ports",
      );
      setPorts(data.items);
    } catch (cause) {
      setPorts(null);
      setPortsError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      // In `finally` so a rejected probe can never leave the button spinning.
      setIsLoadingPorts(false);
    }
  }, []);

  const runTest = useCallback(async () => {
    const seq = ++testSeq.current;
    setTest({ phase: "pending" });
    try {
      // Sends what is on screen, saved or not — the operator needs to find the
      // right port before committing it.
      const result = await posRequest<PosTestResult>("/api/admin/pos/test", value);
      // Dropped if the settings were edited while this was in flight: the
      // answer describes an address we are no longer pointed at.
      if (seq === testSeq.current) setTest({ phase: "done", result });
    } catch (cause) {
      if (seq === testSeq.current) {
        setTest({
          phase: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
  }, [value]);

  const selectTransport = (next: PosTransport) => {
    retireTest();
    set("transport", next);
    if (next === "serial" && ports === null && !isLoadingPorts) void loadPorts();
  };

  const portOptions: SelectOption[] = (ports ?? []).map((port) => ({
    id: port.path,
    label: port.manufacturer ? `${port.path} — ${port.manufacturer}` : port.path,
  }));

  // Keep a path that was saved earlier selectable even when enumeration has not
  // run yet, or the device is currently unplugged.
  if (value.serial.path && !portOptions.some((option) => option.id === value.serial.path)) {
    portOptions.unshift({ id: value.serial.path, label: value.serial.path });
  }

  return (
    <SettingsCard
      description="Take payment on a physical card machine instead of an online gateway."
      title="Card machine"
    >
      <div className="flex flex-col gap-5">
        <SwitchSetting
          hint="When off, the kiosk does not offer card-present payment at all."
          isSelected={value.isEnabled}
          label="Accept card-present payments"
          onChange={(next) => set("isEnabled", next)}
        />

        <div>
          <p className="type-label text-ink mb-2">How the kiosk reaches the terminal</p>
          <ToggleButtonGroup
            aria-label="Terminal connection"
            className="w-full"
            disallowEmptySelection
            isDisabled={!value.isEnabled}
            onSelectionChange={(keys) => {
              const [first] = [...keys];
              if (first !== undefined) selectTransport(String(first) as PosTransport);
            }}
            selectedKeys={[value.transport]}
            selectionMode="single"
          >
            {POS_TRANSPORTS.map((transport) => (
              <ToggleButton className="min-h-14 flex-1" id={transport} key={transport}>
                {TRANSPORT_LABEL[transport]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <p className="type-caption text-ink-subtle mt-2">
            {TRANSPORT_HINT[value.transport]}
          </p>
          {/*
            The simulator answers a sale with a fabricated approval — auth code
            and masked card and all — so the kiosk records a paid enrollment and
            prints a receipt for money that never moved. It is also the default
            transport, so this is the state an operator lands in the moment they
            switch card-present on, which is exactly why it needs saying here.
          */}
          {value.isEnabled && value.transport === "mock" && (
            <p className="type-caption text-warn mt-2 flex items-center gap-1.5">
              <AlertIcon size={14} />
              The simulator approves every sale without a card. Do not leave it
              selected on a kiosk taking real payments.
            </p>
          )}
        </div>

        {value.transport === "lan" && (
          <FieldGrid>
            <TextSetting
              hint="The terminal's address on this network."
              isDisabled={!value.isEnabled}
              label="Terminal IP address"
              onChange={(next) => setLan({ host: next })}
              placeholder="192.168.1.50"
              value={value.lan.host}
            />
            <NumberSetting
              hint="The ECR port the terminal listens on, from its own setup menu."
              isDisabled={!value.isEnabled}
              label="Port"
              maxValue={65535}
              minValue={1}
              onChange={(next) => setLan({ port: next })}
              value={value.lan.port}
            />
          </FieldGrid>
        )}

        {value.transport === "serial" && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[260px] grow">
                <SelectSetting
                  hint={
                    ports === null
                      ? "Press Refresh to list the devices attached to this machine."
                      : `${ports.length} device${ports.length === 1 ? "" : "s"} found.`
                  }
                  isDisabled={!value.isEnabled}
                  label="Serial device"
                  onChange={(next) => setSerial({ path: next })}
                  options={portOptions}
                  value={value.serial.path}
                />
              </div>
              <Button
                className="min-h-14"
                isDisabled={!value.isEnabled || isLoadingPorts}
                onPress={() => void loadPorts()}
                variant="secondary"
              >
                {isLoadingPorts ? <Spinner size="sm" /> : <RefreshIcon size={18} />}
                {t("admin.action.refresh")}
              </Button>
            </div>

            {portsError !== null && (
              <p className="type-caption text-bad flex items-center gap-1.5">
                <AlertIcon size={14} />
                {portsError}
              </p>
            )}

            <FieldGrid>
              <SelectSetting
                hint="Must match the terminal's own serial setting."
                isDisabled={!value.isEnabled}
                label="Baud rate"
                onChange={(next) => setSerial({ baudRate: Number(next) })}
                options={BAUD_RATES.map((rate) => ({ id: String(rate), label: String(rate) }))}
                value={String(value.serial.baudRate)}
              />
              <SelectSetting
                isDisabled={!value.isEnabled}
                label="Data bits"
                onChange={(next) => setSerial({ dataBits: Number(next) === 7 ? 7 : 8 })}
                options={[
                  { id: "7", label: "7" },
                  { id: "8", label: "8" },
                ]}
                value={String(value.serial.dataBits)}
              />
              <SelectSetting
                isDisabled={!value.isEnabled}
                label="Stop bits"
                onChange={(next) => setSerial({ stopBits: Number(next) === 2 ? 2 : 1 })}
                options={[
                  { id: "1", label: "1" },
                  { id: "2", label: "2" },
                ]}
                value={String(value.serial.stopBits)}
              />
              <SelectSetting
                isDisabled={!value.isEnabled}
                label="Parity"
                onChange={(next) =>
                  setSerial({
                    parity: next === "even" || next === "odd" ? next : "none",
                  })
                }
                options={PARITY_OPTIONS}
                value={value.serial.parity}
              />
            </FieldGrid>
          </div>
        )}

        <FieldGrid>
          <TextSetting
            hint="Issued by the acquirer, printed on the terminal's own slip."
            isDisabled={!value.isEnabled}
            label="Merchant ID"
            onChange={(next) => set("merchantId", next)}
            value={value.merchantId}
          />
          <TextSetting
            hint="Identifies this specific card machine."
            isDisabled={!value.isEnabled}
            label="Terminal ID"
            onChange={(next) => set("terminalId", next)}
            value={value.terminalId}
          />
          <NumberSetting
            hint="How long to wait for the customer to tap or insert."
            isDisabled={!value.isEnabled}
            label="Sale timeout (seconds)"
            maxValue={600}
            minValue={10}
            onChange={(next) => set("saleTimeoutSeconds", next)}
            value={value.saleTimeoutSeconds}
          />
          <NumberSetting
            hint="How often the backend asks the terminal where the sale is up to."
            isDisabled={!value.isEnabled}
            label="Status poll interval (ms)"
            maxValue={10000}
            minValue={200}
            onChange={(next) => set("pollIntervalMs", next)}
            step={100}
            value={value.pollIntervalMs}
          />
        </FieldGrid>

        <SwitchSetting
          hint="The customer then gets both the terminal slip and the kiosk receipt."
          isSelected={value.terminalPrintsSlip}
          label="Let the terminal print its own charge slip"
          onChange={(next) => set("terminalPrintsSlip", next)}
        />

        <div className="border-hairline border-t pt-5">
          <Button
            className="min-h-14"
            isDisabled={!value.isEnabled || test.phase === "pending"}
            onPress={() => void runTest()}
            variant="secondary"
          >
            {test.phase === "pending" && <Spinner size="sm" />}
            {test.phase === "pending" ? "Testing…" : "Test connection"}
          </Button>
          <TestResultBanner state={test} />
        </div>
      </div>
    </SettingsCard>
  );
}
