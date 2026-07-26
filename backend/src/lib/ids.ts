/**
 * Crockford-ish base32 alphabet: no I, L, O, U — avoids ambiguity when a
 * student reads an enrollment id off a kiosk screen or a printed receipt.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomCode(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

export const newId = (): string => crypto.randomUUID();

/** Public enrollment id, e.g. ENR-2K7QF3. */
export const newEnrollmentCode = (): string => `ENR-${randomCode(6)}`;

/** Public payment reference, e.g. PAY-8H2LQX. */
export const newPaymentReference = (): string => `PAY-${randomCode(6)}`;

/** Simulated gateway transaction id, e.g. TXN-9F3K2M8Q. */
export const newGatewayRef = (): string => `TXN-${randomCode(10)}`;

export const nowIso = (): string => new Date().toISOString();

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      // Keep unicode letters/numbers so Arabic course names still produce a slug.
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'course'
  );
}
