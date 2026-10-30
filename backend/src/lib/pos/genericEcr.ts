import type { PosSaleState } from '@course-lms/shared';
import type { PosProtocol, PosReply, SaleInput } from './protocol.ts';

/**
 * A generic ECR codec — NOT Network International's protocol.
 *
 * ============================ READ THIS FIRST ============================
 * Network International publishes no ECR specification. It is issued per
 * merchant, under NDA, by the acquirer. Nothing in this file was taken from
 * an NI document, because no such document was available to write it.
 *
 * What this file *is*: the framing that every ECR protocol we could actually
 * read agrees on — Nexi's LAN integration, Comgate's POS-2-ECR, QFPay's ECR
 * spec. They differ in field names and codes; they agree on the envelope:
 *
 *     STX (0x02) | ASCII payload | ETX (0x03) | LRC
 *     LRC = XOR of every payload byte together with the ETX byte
 *
 * So the envelope is a reasonable bet. Everything inside it is OUR INVENTION
 * and is flagged `ASSUMPTION` below. When the real spec arrives, write a new
 * PosProtocol beside this one — the transports, sale runner, polling and
 * reconciliation all sit behind that seam and do not change.
 *
 * Treat a successful mock sale as proof that OUR plumbing works. It is not
 * evidence that a real terminal will understand a single byte of this.
 * =========================================================================
 */

export const STX = 0x02;
export const ETX = 0x03;
export const FIELD_SEPARATOR = '|';

/** Longest field we will emit — a runaway value must not become a huge frame. */
const MAX_FIELD_LENGTH = 64;

/**
 * ASSUMPTION — request payload layout (6 pipe-delimited fields):
 *
 *     MSGTYPE | REF | AMOUNT_MINOR | CURRENCY | MID | TID
 *
 * Unused fields are sent empty rather than omitted, so the field count is
 * constant in both directions. CANCEL and ECHO carry no amount or identifiers
 * because the PosProtocol interface does not hand them any: a real spec that
 * requires MID/TID on a cancel will need those plumbed through.
 */
export type EcrRequestType = 'SALE' | 'CANCEL' | 'ECHO';

/**
 * ASSUMPTION — reply payload layout (6 pipe-delimited fields):
 *
 *     MSGTYPE | REF | CODE | MESSAGE | INSTRUMENT | AUTH_CODE
 *
 * STATUS = unsolicited progress, pushed by the terminal while the customer is
 * at the keypad. RESULT = the one final, authoritative outcome.
 */
export type EcrReplyType = 'STATUS' | 'RESULT';

// ---------------------------------------------------------------------------
// Framing — exported so it can be unit-tested without a terminal
// ---------------------------------------------------------------------------

/** XOR of every byte given. Callers pass payload + ETX. */
export function computeLrc(bytes: Uint8Array): number {
  let lrc = 0;
  for (const byte of bytes) lrc ^= byte;
  return lrc & 0xff;
}

/** Wraps an ASCII payload in STX / ETX / LRC. */
export function buildFrame(payload: string): Uint8Array {
  const body = new TextEncoder().encode(payload);
  const frame = new Uint8Array(body.length + 3);
  frame[0] = STX;
  frame.set(body, 1);
  frame[body.length + 1] = ETX;
  frame[body.length + 2] = computeLrc(frame.subarray(1, body.length + 2));
  return frame;
}

export type ParsedFrame =
  | { ok: true; payload: string }
  | { ok: false; reason: string };

/**
 * Unwraps a frame. Never throws and never trusts its input: everything here
 * arrived off a socket or a serial line, where half-frames and line noise are
 * normal, not exceptional.
 */
export function parseFrame(frame: Uint8Array): ParsedFrame {
  // STX + at least one payload byte + ETX + LRC.
  if (frame.length < 4) {
    return { ok: false, reason: `frame too short (${frame.length} bytes)` };
  }
  if (frame[0] !== STX) {
    return { ok: false, reason: `missing STX (got 0x${hex(frame[0])})` };
  }

  const etxIndex = frame.length - 2;
  if (frame[etxIndex] !== ETX) {
    return { ok: false, reason: `missing ETX (got 0x${hex(frame[etxIndex])})` };
  }

  const expected = computeLrc(frame.subarray(1, etxIndex + 1));
  const actual = frame[frame.length - 1] ?? -1;
  if (expected !== actual) {
    return {
      ok: false,
      reason: `LRC mismatch (expected 0x${hex(expected)}, got 0x${hex(actual)})`,
    };
  }

  let payload = '';
  for (const byte of frame.subarray(1, etxIndex)) {
    // Printable ASCII only. A control byte here means we mis-framed.
    if (byte < 0x20 || byte > 0x7e) {
      return { ok: false, reason: `non-printable byte 0x${hex(byte)} in payload` };
    }
    payload += String.fromCharCode(byte);
  }

  return { ok: true, payload };
}

function hex(byte: number | undefined): string {
  return (byte ?? 0).toString(16).padStart(2, '0');
}

/**
 * Strips anything that would corrupt the frame, then truncates.
 *
 * Exported because anything that builds a frame — the mock terminal included —
 * must put every value through this. A byte above 0x7e makes the frame
 * unparseable; a stray '|' silently shifts every field after it.
 */
export function field(value: string | number): string {
  return String(value)
    .replace(/[^\x20-\x7e]/g, '')
    .split(FIELD_SEPARATOR)
    .join(' ')
    .trim()
    .slice(0, MAX_FIELD_LENGTH);
}

// ---------------------------------------------------------------------------
// Code tables
//
// ASSUMPTION — every code string below is our own choice. The numeric result
// codes follow the ISO 8583 response codes that acquirer specs conventionally
// reuse ('00' approved, '51' insufficient funds, ...); the alphabetic ones
// ('CN', 'TO') are ours outright. Expect all of them to change.
// ---------------------------------------------------------------------------

/**
 * Progress codes. Cosmetic by design: these only move the kiosk's waiting
 * screen along. No code here can finish a sale, so an unrecognised one is
 * reported as 'processing' rather than failing a payment that may well be
 * about to succeed.
 */
const PROGRESS: Record<string, { state: PosSaleState; message: string }> = {
  CONNECTING: { state: 'connecting', message: 'Reaching the card machine' },
  LINK_UP: { state: 'connecting', message: 'Card machine connected' },
  WAIT_CARD: { state: 'waiting_for_card', message: 'Present your card' },
  INSERT_CARD: { state: 'waiting_for_card', message: 'Insert or tap your card' },
  PIN_ENTRY: { state: 'processing', message: 'Enter your PIN on the card machine' },
  CARD_READ: { state: 'processing', message: 'Card read' },
  PROCESSING: { state: 'processing', message: 'Processing' },
  ONLINE: { state: 'processing', message: 'Contacting your bank' },
};

/** Final codes. Only an explicit approval code may ever yield 'approved'. */
const RESULTS: Record<
  string,
  { state: PosSaleState; message: string; failureReason?: string }
> = {
  '00': { state: 'approved', message: 'Approved' },
  '08': { state: 'approved', message: 'Approved — signature required' },
  '01': { state: 'declined', message: 'Declined — call your bank', failureReason: 'REFER_TO_ISSUER' },
  '05': { state: 'declined', message: 'Card declined', failureReason: 'DO_NOT_HONOUR' },
  '14': { state: 'declined', message: 'Card not recognised', failureReason: 'INVALID_CARD' },
  '51': { state: 'declined', message: 'Insufficient funds', failureReason: 'INSUFFICIENT_FUNDS' },
  '54': { state: 'declined', message: 'Card expired', failureReason: 'EXPIRED_CARD' },
  '55': { state: 'declined', message: 'Wrong PIN', failureReason: 'WRONG_PIN' },
  '57': { state: 'declined', message: 'Card does not allow this', failureReason: 'NOT_PERMITTED' },
  '61': { state: 'declined', message: 'Over card limit', failureReason: 'LIMIT_EXCEEDED' },
  '65': { state: 'declined', message: 'Tap limit reached — insert the card', failureReason: 'CONTACTLESS_LIMIT' },
  '91': { state: 'declined', message: 'Bank unavailable — try again', failureReason: 'ISSUER_UNAVAILABLE' },
  Z1: { state: 'declined', message: 'Declined offline', failureReason: 'OFFLINE_DECLINED' },
  CN: { state: 'cancelled', message: 'Cancelled at the card machine', failureReason: 'CANCELLED_AT_TERMINAL' },
  CU: { state: 'cancelled', message: 'Cancelled', failureReason: 'CANCELLED_BY_CUSTOMER' },
  TO: { state: 'error', message: 'The card machine timed out', failureReason: 'TIMEOUT' },
  E1: { state: 'error', message: 'Card machine error', failureReason: 'TERMINAL_ERROR' },
  E2: { state: 'error', message: 'Card machine is busy', failureReason: 'DEVICE_BUSY' },
};

function unreadable(reason: string): PosReply {
  return {
    state: 'error',
    message: 'Unreadable reply from the card machine',
    terminalRef: null,
    instrument: null,
    authCode: null,
    failureReason: reason,
  };
}

/**
 * Last line of defence against a full PAN reaching our database or screens.
 * A conforming terminal sends "VISA ****4242"; a misconfigured one might not,
 * and that is not something to find out from a support ticket.
 */
function maskInstrument(value: string): string | null {
  if (!value) return null;
  // The run may be grouped the way a card is printed — "4242 4242 4242 4242"
  // or "5555-5555-5555-4444" — which a plain \d{7,} walks straight past,
  // leaving a full PAN in the sale row, the status response and the kiosk
  // screen. Count digits across single spaces and dashes, not just adjacent
  // ones. An already-masked "VISA ****4242" has no such run and is untouched.
  return value.replace(/\d(?:[ -]?\d){6,}/g, (run) => {
    const digits = run.replace(/\D/g, '');
    return `****${digits.slice(-4)}`;
  });
}

// ---------------------------------------------------------------------------
// The protocol
// ---------------------------------------------------------------------------

export const genericEcr: PosProtocol = {
  name: 'generic-ecr (assumed framing — not an NI specification)',

  encodeSale(input: SaleInput): Uint8Array {
    const amount = Math.trunc(input.amountMinor);
    // Throwing is deliberate: a sale for 0, NaN or a negative amount is a bug
    // on our side, and must never reach a terminal. decode() stays non-throwing.
    if (!Number.isFinite(input.amountMinor) || amount <= 0) {
      throw new Error(`Refusing to encode a sale for ${input.amountMinor} minor units`);
    }
    return buildFrame(
      [
        'SALE',
        field(input.reference),
        field(amount),
        field(input.currency.toUpperCase()),
        field(input.merchantId),
        field(input.terminalId),
      ].join(FIELD_SEPARATOR),
    );
  },

  encodeCancel(saleRef: string): Uint8Array {
    return buildFrame(['CANCEL', field(saleRef), '', '', '', ''].join(FIELD_SEPARATOR));
  },

  encodeProbe(): Uint8Array {
    return buildFrame(['ECHO', '', '', '', '', ''].join(FIELD_SEPARATOR));
  },

  decode(frame: Uint8Array): PosReply {
    const parsed = parseFrame(frame);
    if (!parsed.ok) return unreadable(parsed.reason);

    const fields = parsed.payload.split(FIELD_SEPARATOR);
    if (fields.length < 3) {
      return unreadable(`payload has ${fields.length} field(s), expected 6`);
    }

    const type = (fields[0] ?? '').trim().toUpperCase();
    const terminalRef = (fields[1] ?? '').trim() || null;
    const code = (fields[2] ?? '').trim().toUpperCase();
    const text = (fields[3] ?? '').trim();
    const instrument = maskInstrument((fields[4] ?? '').trim());
    const authCode = (fields[5] ?? '').trim() || null;

    if (type === 'STATUS') {
      const known = PROGRESS[code];
      return {
        state: known?.state ?? 'processing',
        message: text || known?.message || 'Working',
        terminalRef,
        instrument,
        authCode,
        failureReason: null,
      };
    }

    if (type === 'RESULT') {
      const known = RESULTS[code];
      if (!known) {
        // Unknown final code is an error, never an approval.
        return {
          state: 'error',
          message: text || 'The card machine gave an unexpected answer',
          terminalRef,
          instrument,
          authCode,
          failureReason: code ? `UNKNOWN_RESULT_CODE:${code}` : 'MISSING_RESULT_CODE',
        };
      }
      return {
        state: known.state,
        message: text || known.message,
        terminalRef,
        instrument,
        authCode: known.state === 'approved' ? authCode : null,
        failureReason: known.failureReason ?? null,
      };
    }

    return unreadable(`unknown message type "${type}"`);
  },
};
