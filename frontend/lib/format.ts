import type { Locale } from "./i18n/dictionaries";

/**
 * Prices and IDs always render with Latin digits, even in Arabic — Arabic-Indic
 * numerals on a printed receipt cause support calls. See design.md §9.
 */
const NUMERIC_LOCALE = "en-IN";

export function formatCurrency(
  amount: number,
  currency = "INR",
  options: { compact?: boolean } = {},
): string {
  return new Intl.NumberFormat(NUMERIC_LOCALE, {
    style: "currency",
    currency,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    notation: options.compact ? "compact" : "standard",
  }).format(amount);
}

export const formatNumber = (value: number): string =>
  new Intl.NumberFormat(NUMERIC_LOCALE).format(value);

export function formatDate(iso: string, locale: Locale = "en"): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    numberingSystem: "latn",
  }).format(new Date(iso));
}

export function formatDateTime(iso: string, locale: Locale = "en"): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    numberingSystem: "latn",
  }).format(new Date(iso));
}

/** Renders a stored E.164 number in a readable grouped form. */
export function formatMobile(mobile: string): string {
  const match = /^\+(\d{1,3})(\d{10})$/.exec(mobile);
  if (!match) return mobile;
  const [, country, national] = match;
  return `+${country} ${national?.slice(0, 5)} ${national?.slice(5)}`;
}

/** Partially masks a mobile number for on-screen display, e.g. +91 98••• ••210. */
export function maskMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, "");
  if (digits.length < 6) return mobile;
  return `${mobile.slice(0, mobile.length - 7)}•••${mobile.slice(-3)}`;
}
