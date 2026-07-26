"use client";

import type { AppConfig } from "@course-lms/shared";
import { createContext, useContext, useEffect, useState } from "react";
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
    currency: "INR",
    currencySymbol: "₹",
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

function ThemeSync() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const stored = window.localStorage.getItem("kiosk.theme");
      const isDark = stored ? stored === "dark" : media.matches;
      document.documentElement.classList.toggle("dark", isDark);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
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
        <ThemeSync />
        <Ripple />
        {children}
      </I18nProvider>
    </ConfigContext.Provider>
  );
}
