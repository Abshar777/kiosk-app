import { badRequest } from './http.ts';

/**
 * Collects field-level errors so a form can highlight every bad input at once
 * instead of surfacing them one round-trip at a time.
 */
export class FieldErrors {
  private readonly errors: Record<string, string> = {};

  add(field: string, message: string): void {
    if (!this.errors[field]) this.errors[field] = message;
  }

  get isEmpty(): boolean {
    return Object.keys(this.errors).length === 0;
  }

  throwIfAny(message = 'Please correct the highlighted fields'): void {
    if (!this.isEmpty) throw badRequest(message, this.errors);
  }
}

export function requireString(
  value: unknown,
  field: string,
  errors: FieldErrors,
  { min = 1, max = 500 }: { min?: number; max?: number } = {},
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.add(field, `${field} is required`);
    return '';
  }
  const trimmed = value.trim();
  if (trimmed.length < min) errors.add(field, `${field} must be at least ${min} characters`);
  if (trimmed.length > max) errors.add(field, `${field} must be at most ${max} characters`);
  return trimmed;
}

/** Full name: letters (any script), spaces, apostrophes, hyphens, periods. */
export function validateFullName(value: unknown, errors: FieldErrors): string {
  const name = requireString(value, 'fullName', errors, { min: 2, max: 80 });
  if (!name) return '';
  if (!/^[\p{L}\p{M}][\p{L}\p{M}\s'.-]*$/u.test(name)) {
    errors.add('fullName', 'Name may only contain letters, spaces, apostrophes and hyphens');
  }
  return name;
}

export interface NormalizedMobile {
  /** E.164-ish storage form, e.g. +919876543210 */
  normalized: string;
  /** Digits only, e.g. 919876543210 */
  digits: string;
}

/**
 * Accepts common kiosk-entered formats — "98765 43210", "+91 98765-43210",
 * "0098765..." — and normalizes to E.164. Length is checked against the ITU
 * range (7–15 significant digits) rather than a single country's rule.
 */
export function validateMobile(value: unknown, errors: FieldErrors): NormalizedMobile {
  const raw = requireString(value, 'mobile', errors, { min: 6, max: 24 });
  if (!raw) return { normalized: '', digits: '' };

  if (!/^[+()\-\s\d]+$/.test(raw)) {
    errors.add('mobile', 'Mobile number may only contain digits, spaces, +, - and ()');
    return { normalized: '', digits: '' };
  }

  const hadPlus = raw.trimStart().startsWith('+');
  let digits = raw.replace(/\D/g, '');
  // "00" is the international access prefix — treat it like a leading "+".
  if (!hadPlus && digits.startsWith('00')) digits = digits.slice(2);

  if (digits.length < 7 || digits.length > 15) {
    errors.add('mobile', 'Enter a valid mobile number');
    return { normalized: '', digits: '' };
  }
  if (/^(\d)\1+$/.test(digits)) {
    errors.add('mobile', 'Enter a valid mobile number');
    return { normalized: '', digits: '' };
  }

  const defaultCode = process.env.DEFAULT_COUNTRY_CODE ?? '91';
  // A bare national number (no +, no access prefix) gets the configured country code.
  const normalized =
    hadPlus || digits.startsWith('00')
      ? `+${digits}`
      : digits.length === 10
        ? `+${defaultCode}${digits}`
        : `+${digits}`;

  return { normalized, digits };
}

export function optionalNumber(
  value: unknown,
  field: string,
  errors: FieldErrors,
  { min = 0, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {},
): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) {
    errors.add(field, `${field} must be a number`);
    return undefined;
  }
  if (num < min) errors.add(field, `${field} must be at least ${min}`);
  if (num > max) errors.add(field, `${field} must be at most ${max}`);
  return num;
}

export function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  errors: FieldErrors,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    errors.add(field, `${field} must be one of: ${allowed.join(', ')}`);
    return allowed[0] as T;
  }
  return value as T;
}

/** Masks a card number down to its last four digits for display/storage. */
export function maskCard(cardNumber: string): string {
  const digits = cardNumber.replace(/\D/g, '');
  return `•••• ${digits.slice(-4)}`;
}

/** Luhn check — catches typos before the simulated gateway sees the number. */
export function isValidCardNumber(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, '');
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits.charCodeAt(i) - 48;
    if (digit < 0 || digit > 9) return false;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export function isValidExpiry(expiry: string): boolean {
  const match = /^(\d{2})\s*\/\s*(\d{2}|\d{4})$/.exec(expiry.trim());
  if (!match) return false;
  const month = Number(match[1]);
  if (month < 1 || month > 12) return false;
  const yearPart = match[2] as string;
  const year = yearPart.length === 2 ? 2000 + Number(yearPart) : Number(yearPart);
  const now = new Date();
  // Card is valid through the last day of its expiry month.
  const expiryEnd = new Date(year, month, 1);
  return expiryEnd > now;
}

export const isValidUpiId = (upi: string): boolean =>
  /^[\w.\-]{2,64}@[a-zA-Z]{2,32}$/.test(upi.trim());
