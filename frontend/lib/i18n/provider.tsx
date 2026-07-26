"use client";

import { I18nProvider as AriaI18nProvider } from "@heroui/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  dictionaries,
  isRtlLocale,
  LOCALES,
  type Locale,
  type TranslationKey,
} from "./dictionaries";

const STORAGE_KEY = "kiosk.locale";

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  dir: "ltr" | "rtl";
  /** Translate a key, substituting {placeholders} from `vars`. */
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

const isLocale = (value: string): value is Locale =>
  (LOCALES as readonly string[]).includes(value);

export function I18nProvider({
  children,
  defaultLocale = "en",
}: {
  children: React.ReactNode;
  defaultLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);

  // Restore the last choice after mount. Reading storage during render would
  // desync the server-rendered HTML from the client's first paint.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && isLocale(stored)) setLocaleState(stored);
  }, []);

  // React Aria reads direction from the document, so <html> is the source of truth.
  useEffect(() => {
    const dir = isRtlLocale(locale) ? "rtl" : "ltr";
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => {
      // Fall back to English rather than rendering a raw key at a kiosk.
      const template = dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in vars ? String(vars[name]) : match,
      );
    },
    [locale],
  );

  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, dir: isRtlLocale(locale) ? "rtl" : "ltr", t }),
    [locale, setLocale, t],
  );

  return (
    <I18nContext.Provider value={value}>
      {/* Drives React Aria's own locale-aware formatting and RTL behaviour. */}
      <AriaI18nProvider locale={locale === "ar" ? "ar-AE" : "en-IN"}>
        {children}
      </AriaI18nProvider>
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside <I18nProvider>");
  return context;
}

/** Convenience hook when a component only needs the translate function. */
export const useT = () => useI18n().t;
