"use client";

import type { AppConfig } from "@course-lms/shared";
import { createContext, useContext, useEffect, useState } from "react";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { OfflineBanner } from "@/components/pwa/OfflineBanner";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { Ripple } from "@/components/ui/Ripple";
import { api } from "@/lib/api";
import { I18nProvider } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/dictionaries";

/**
 * Fallback used until /api/config responds — and permanently if the API is
 * unreachable, so the kiosk still renders something coherent offline.
 */
const FALLBACK_CONFIG: AppConfig = {
  academy: {
    name: "Delta Academy",
    tagline: "Learn the skills that move you forward",
    logoUrl: null,
    contactPhone: "",
    supportNumber: "",
    email: "",
    address: "",
    website: "",
  },
  kiosk: {
    autoReturnSeconds: 45,
    idleResetSeconds: 180,
    autoPrintReceipt: true,
    autoPrintDelayMs: 900,
    defaultLanguage: "en",
    availableLanguages: ["en", "ar"],
    currency: "AED",
    currencySymbol: "AED",
  },
  pos: {
    isEnabled: false,
    transport: "mock",
    lan: { host: "", port: 9100 },
    serial: { path: "", baudRate: 9600, dataBits: 8, stopBits: 1, parity: "none" },
    merchantId: "",
    terminalId: "",
    saleTimeoutSeconds: 120,
    pollIntervalMs: 1000,
    terminalPrintsSlip: true,
  },
  enabledPaymentMethods: ["upi", "card", "netbanking"],
};

interface ConfigValue {
  config: AppConfig;
  banks: { code: string; name: string }[];
  isLoading: boolean;
}

const ConfigContext = createContext<ConfigValue>({
  config: FALLBACK_CONFIG,
  banks: [],
  isLoading: true,
});

export const useConfig = () => useContext(ConfigContext);

/**
 * The kiosk is light-only, so nothing syncs a theme. This clears the `dark`
 * class and the stored preference left behind by earlier builds — without it a
 * tablet that had already run one would keep the class on <html> forever, since
 * nothing else removes it.
 */
function ThemeReset() {
  useEffect(() => {
    document.documentElement.classList.remove("dark");
    window.localStorage.removeItem("kiosk.theme");
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [value, setValue] = useState<ConfigValue>({
    config: FALLBACK_CONFIG,
    banks: [],
    isLoading: true,
  });

  useEffect(() => {
    let cancelled = false;
    api
      .config()
      .then((response) => {
        if (cancelled) return;
        const { banks, ...config } = response;
        setValue({ config, banks: banks ?? [], isLoading: false });
      })
      .catch(() => {
        if (!cancelled) setValue((prev) => ({ ...prev, isLoading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ConfigContext.Provider value={value}>
      <I18nProvider defaultLocale={value.config.kiosk.defaultLanguage as Locale}>
        <ThemeReset />
        <Ripple />
        <ServiceWorkerRegistrar />
        <OfflineBanner />
        <InstallPrompt />
        {children}
      </I18nProvider>
    </ConfigContext.Provider>
  );
}
