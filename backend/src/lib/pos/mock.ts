import type { PosConfig } from '@course-lms/shared';
import { FIELD_SEPARATOR, buildFrame, field, parseFrame } from './genericEcr.ts';
import { PosTransportError, type PosTransport } from './transport.ts';

/**
 * A card machine that isn't there.
 *
 * Speaks `genericEcr` over no wire at all, so the whole card-present path —
 * sale runner, polling, state machine, reconciliation, kiosk screens — can be
 * exercised on a laptop with no terminal, no acquirer and no NDA. It walks the
 * same lifecycle a real terminal does, with pauses, rather than returning an
 * approval instantly: a flow that only ever sees an immediate success hides
 * every bug that lives in the waiting.
 *
 * ========================= OUTCOME CONVENTION =========================
 * The outcome is chosen by the LAST TWO DIGITS OF THE AMOUNT IN MINOR UNITS,
 * so a test (or a human clicking through the kiosk) can force any path just by
 * picking a price:
 *
 *   ...00  approved    AED 150.00 → approved, "VISA ****4242" + auth code
 *   ...01  declined    AED 150.01 → declined, insufficient funds ('51')
 *   ...02  timeout     AED 150.02 → stalls on "present your card" forever;
 *                                   receive() raises TIMEOUT, as a customer
 *                                   who walked away would
 *   ...03  cancelled   AED 150.03 → terminal reports the customer cancelled
 *   anything else      behaves like ...00
 *
 * Independently of the amount, a CANCEL frame sent while a sale is live always
 * wins and ends it as cancelled — that is the path the kiosk's Cancel button
 * takes, and it must work for every amount, not just ...03.
 * ======================================================================
 */

/** Gap between lifecycle steps. Long enough to be a real wait, short enough for tests. */
const STEP_MS = 60;

type Outcome = 'approve' | 'decline' | 'timeout' | 'cancel';

interface Queued {
  /** Earliest time this frame may be handed to receive(). */
  readyAt: number;
  payload: string;
}

const CARD = 'VISA ****4242';

function outcomeFor(amountMinor: number): Outcome {
  switch (Math.abs(Math.trunc(amountMinor)) % 100) {
    case 1:
      return 'decline';
    case 2:
      return 'timeout';
    case 3:
      return 'cancel';
    default:
      return 'approve';
  }
}

/** Stable per reference, so a replayed test gets the same auth code. */
function authCodeFor(reference: string): string {
  let hash = 7;
  for (const char of reference) hash = (hash * 31 + char.charCodeAt(0)) % 1_000_000;
  return String(hash).padStart(6, '0');
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createMockTransport(config: PosConfig): PosTransport {
  let isOpen = false;
  let queue: Queued[] = [];
  let live: { reference: string; settled: boolean } | null = null;

  /** Queues the frames the terminal will push after the request is accepted. */
  function script(reference: string, outcome: Outcome): void {
    const steps: string[][] = [['STATUS', reference, 'WAIT_CARD', '', '', '']];

    if (outcome === 'cancel') {
      steps.push(['RESULT', reference, 'CN', '', '', '']);
    } else if (outcome === 'decline') {
      steps.push(
        ['STATUS', reference, 'CARD_READ', '', CARD, ''],
        ['STATUS', reference, 'ONLINE', '', CARD, ''],
        ['RESULT', reference, '51', '', CARD, ''],
      );
    } else if (outcome === 'approve') {
      steps.push(
        ['STATUS', reference, 'CARD_READ', '', CARD, ''],
        ['STATUS', reference, 'PIN_ENTRY', '', CARD, ''],
        ['STATUS', reference, 'ONLINE', '', CARD, ''],
        ['RESULT', reference, '00', '', CARD, authCodeFor(reference)],
      );
    }
    // 'timeout' queues only WAIT_CARD and then goes quiet on purpose.

    const base = Date.now();
    queue = steps.map((fields, index) => ({
      readyAt: base + STEP_MS * (index + 1),
      payload: fields.join(FIELD_SEPARATOR),
    }));
  }

  const open = async (): Promise<void> => {
    if (isOpen) return; // Must be safe to call twice — the interface says so.
    await sleep(STEP_MS / 4);
    isOpen = true;
  };

  const close = async (): Promise<void> => {
    isOpen = false;
    queue = [];
    live = null;
  };

  const send = async (frame: Uint8Array, _timeoutMs: number): Promise<Uint8Array> => {
    if (!isOpen) {
      throw new PosTransportError('CLOSED', 'Mock terminal is not open');
    }

    const parsed = parseFrame(frame);
    if (!parsed.ok) {
      // A real terminal would NAK this. Surfacing it loudly is more useful:
      // a frame we cannot parse ourselves is a bug in our own encoder.
      throw new PosTransportError(
        'UNSUPPORTED',
        `Mock terminal could not read the frame: ${parsed.reason}`,
      );
    }

    const fields = parsed.payload.split(FIELD_SEPARATOR);
    const type = (fields[0] ?? '').toUpperCase();
    const reference = fields[1] ?? '';
    await sleep(STEP_MS / 2);

    if (type === 'ECHO') {
      // field() is not optional here: the terminal id is typed by an operator
      // (and the admin "Test connection" route passes it straight through
      // unsaved). An Arabic or accented id encodes above 0x7e and a '|' shifts
      // every field, either of which made our own probe reply unparseable and
      // reported a working mock as unreachable.
      const label = field(config.terminalId) || 'MOCK';
      return buildFrame(
        ['STATUS', '', 'LINK_UP', field(`Mock terminal ${label} ready`), '', ''].join(
          FIELD_SEPARATOR,
        ),
      );
    }

    if (type === 'SALE') {
      const amountMinor = Number(fields[2] ?? '');
      // Loud, not lenient. `Number('')` is 0 and `Number('x')` is NaN, and both
      // fall through outcomeFor() to 'approve' — a mock that answers an
      // unreadable amount with an approval hands a false green to the one flow
      // whose whole job is to be trusted about money.
      if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
        throw new PosTransportError(
          'UNSUPPORTED',
          `Mock terminal refuses a sale for "${fields[2] ?? ''}" minor units`,
        );
      }
      live = { reference, settled: false };
      script(reference, outcomeFor(amountMinor));
      return buildFrame(['STATUS', reference, 'CONNECTING', '', '', ''].join(FIELD_SEPARATOR));
    }

    if (type === 'CANCEL') {
      if (!live || live.settled) {
        return buildFrame(
          ['RESULT', reference, 'E1', 'No sale in progress', '', ''].join(FIELD_SEPARATOR),
        );
      }
      // Cancel wins: drop whatever was scheduled and settle as cancelled.
      queue = [
        {
          readyAt: Date.now() + STEP_MS / 2,
          payload: ['RESULT', live.reference, 'CU', '', '', ''].join(FIELD_SEPARATOR),
        },
      ];
      return buildFrame(['STATUS', reference, 'PROCESSING', 'Cancelling', '', ''].join(FIELD_SEPARATOR));
    }

    throw new PosTransportError('UNSUPPORTED', `Mock terminal does not handle "${type}"`);
  };

  const receive = async (timeoutMs: number): Promise<Uint8Array> => {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      if (!isOpen) throw new PosTransportError('CLOSED', 'Mock terminal was closed mid-sale');

      const head = queue[0];
      if (head && Date.now() >= head.readyAt) {
        queue.shift();
        if (head.payload.startsWith('RESULT') && live) live.settled = true;
        return buildFrame(head.payload);
      }

      if (Date.now() >= deadline) {
        throw new PosTransportError(
          'TIMEOUT',
          `Mock terminal sent nothing within ${timeoutMs}ms`,
        );
      }

      await sleep(10);
    }
  };

  const probe = async (timeoutMs: number): Promise<void> => {
    await open();
    const reply = await send(buildFrame(['ECHO', '', '', '', '', ''].join(FIELD_SEPARATOR)), timeoutMs);
    const parsed = parseFrame(reply);
    if (!parsed.ok) {
      throw new PosTransportError('UNREACHABLE', `Mock terminal replied with noise: ${parsed.reason}`);
    }
  };

  return { kind: 'mock', open, send, receive, close, probe };
}
