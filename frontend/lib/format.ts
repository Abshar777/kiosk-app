import type { Locale } from "./i18n/dictionaries";

/**
 * Prices and IDs always render with Latin digits, even in Arabic — Arabic-Indic
 * numerals on a printed receipt cause support calls. See design.md §9.
 */
// en-AE, not en-IN: dirhams group in thousands, where en-IN would render
// AED 4,643,500 as the lakh-grouped 46,43,500.
const NUMERIC_LOCALE = "en-AE";

export function formatCurrency(
  amount: number,
  currency = "AED",
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
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-AE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    numberingSystem: "latn",
  }).format(new Date(iso));
}

export function formatDateTime(iso: string, locale: Locale = "en"): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-AE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    numberingSystem: "latn",
  }).format(new Date(iso));
}

/** Renders a stored E.164 number in a readable grouped form. */
/**
 * Dialling codes this kiosk is likely to see, with how each groups its national
 * number. Longest code first, so +971 is matched before +97 can be.
 *
 * Both parts are needed. A dialling code cannot be inferred from the digits
 * alone — +971501234567 splits as 971|501234567 or 97|1501234567 with equal
 * syntactic validity — and length does not imply grouping either: India and the
 * United States both use ten national digits but print them 5-5 and 3-3-4.
 */
const DIALLING_CODES: { code: string; groups: number[] }[] = [
  { code: "971", groups: [2, 3, 4] }, // UAE
  { code: "966", groups: [2, 3, 4] }, // Saudi Arabia
  { code: "974", groups: [4, 4] }, // Qatar
  { code: "973", groups: [4, 4] }, // Bahrain
  { code: "968", groups: [4, 4] }, // Oman
  { code: "965", groups: [4, 4] }, // Kuwait
  { code: "962", groups: [1, 4, 4] }, // Jordan
  { code: "91", groups: [5, 5] }, // India
  { code: "44", groups: [4, 6] }, // United Kingdom
  { code: "1", groups: [3, 3, 4] }, // North America
];

/** Groups a stored E.164 number for display, e.g. +971 50 123 4567. */
export function formatMobile(mobile: string): string {
  if (!mobile.startsWith("+")) return mobile;
  const digits = mobile.slice(1).replace(/\D/g, "");

  const match = DIALLING_CODES.find((entry) => digits.startsWith(entry.code));
  if (match === undefined) return mobile;

  const national = digits.slice(match.code.length);
  const expected = match.groups.reduce((total, size) => total + size, 0);

  // Only group when the length is what that country actually uses; anything
  // else is shown whole rather than chopped into misleading groups.
  if (national.length !== expected) {
    return national.length >= 6 ? `+${match.code} ${national}` : mobile;
  }

  const parts: string[] = [];
  let offset = 0;
  for (const size of match.groups) {
    parts.push(national.slice(offset, offset + size));
    offset += size;
  }
  return `+${match.code} ${parts.join(" ")}`;
}

/** Partially masks a mobile number for on-screen display, e.g. +91 98••• ••210. */
export function maskMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, "");
  if (digits.length < 6) return mobile;
  return `${mobile.slice(0, mobile.length - 7)}•••${mobile.slice(-3)}`;
}
