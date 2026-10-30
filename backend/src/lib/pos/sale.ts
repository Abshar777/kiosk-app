import type { PosConfig, PosSaleStatus } from '@course-lms/shared';
import * as courses from '../../repo/courses.ts';
import * as enrollments from '../../repo/enrollments.ts';
import { log } from '../../repo/logs.ts';
import * as payments from '../../repo/payments.ts';
import * as posSales from '../../repo/posSales.ts';
import { newGatewayRef } from '../ids.ts';
import { createPosSession } from './index.ts';
import { PosTransportError } from './transport.ts';

/**
 * Drives a sale on the physical terminal.
 *
 * The kiosk polls `getStatus` rather than holding a request open for the whole
 * sale: a customer fumbling for their card can take a minute, which is far
 * longer than any sensible HTTP timeout.
 */

/** Sales currently being driven, so cancel can reach them. */
const running = new Map<string, { cancel: () => void }>();

/** Terminals deal in minor units. Never send a float. */
const toMinor = (amount: number): number => Math.round(amount * 100);

export function startSale(enrollmentKey: string, config: PosConfig): PosSaleStatus {
  const enrollment = enrollments.getEnrollment(enrollmentKey);
  if (!enrollment) throw new Error('Enrollment not found');
  if (enrollment.status === 'confirmed') {
    throw new Error('This enrollment has already been paid for');
  }

  // Rejoin an in-flight sale instead of starting a second one — a kiosk reload
  // mid-sale must never prompt the terminal twice for the same enrollment.
  const open = posSales.getOpenSaleForEnrollment(enrollment.id);
  if (open && !open.isTerminal) return open;

  const reference = newGatewayRef();
  const sale = posSales.createSale({
    enrollmentId: enrollment.id,
    reference,
    amount: enrollment.amount,
    currency: enrollment.currency,
    transport: config.transport,
  });

  log('pos.sale.started', 'payment', sale.saleId, `Card sale started on ${config.transport}`, {
    enrollmentId: enrollment.enrollmentId,
    reference,
    amount: enrollment.amount,
  });

  // Deliberately not awaited: the HTTP response returns immediately and the
  // kiosk follows progress by polling.
  void drive(sale.saleId, reference, enrollment, config);

  return sale;
}

async function drive(
  saleId: string,
  reference: string,
  enrollment: ReturnType<typeof enrollments.getEnrollment> & {},
  config: PosConfig,
): Promise<void> {
  const session = createPosSession(config);
  let cancelled = false;

  running.set(saleId, {
    cancel: () => {
      cancelled = true;
    },
  });

  const deadline = Date.now() + config.saleTimeoutSeconds * 1000;
  const remaining = () => Math.max(0, deadline - Date.now());

  try {
    await session.transport.open();

    const frame = session.protocol.encodeSale({
      amountMinor: toMinor(enrollment.amount),
      currency: enrollment.currency,
      reference,
      merchantId: config.merchantId,
      terminalId: config.terminalId,
    });

    posSales.updateSale(saleId, {
      state: 'waiting_for_card',
      message: 'Follow the prompts on the card machine',
    });

    let reply = session.protocol.decode(await session.transport.send(frame, remaining()));

    // Terminals report progress before the final result; keep reading until one
    // of them is terminal or we run out of time.
    while (!posSales.isFinalState(reply.state)) {
      posSales.updateSale(saleId, {
        state: reply.state,
        message: reply.message,
        terminalRef: reply.terminalRef,
      });

      if (cancelled && reply.state !== 'processing') {
        await session.transport
          .send(session.protocol.encodeCancel(reference), 5000)
          .catch(() => undefined);
        posSales.updateSale(saleId, { state: 'cancelled', message: 'Cancelled at the kiosk' });
        return;
      }

      if (remaining() === 0) {
        posSales.updateSale(saleId, {
          state: 'error',
          message: 'The card machine did not respond in time',
          failureReason: 'TIMEOUT',
        });
        return;
      }

      reply = session.protocol.decode(await session.transport.receive(remaining()));
    }

    posSales.updateSale(saleId, {
      state: reply.state,
      message: reply.message,
      terminalRef: reply.terminalRef,
      instrument: reply.instrument,
      authCode: reply.authCode,
      failureReason: reply.failureReason,
    });

    if (reply.state === 'approved') {
      settleApproved(saleId, enrollment, reply.terminalRef, reply.instrument);
    } else {
      // A declined card is a normal outcome; record it and let them retry.
      payments.createPayment({
        enrollmentId: enrollment.id,
        method: 'card_present',
        amount: enrollment.amount,
        currency: enrollment.currency,
        instrument: reply.instrument,
        status: 'failed',
        gatewayRef: reply.terminalRef,
        failureReason: reply.failureReason ?? reply.message,
      });
      posSales.settleSale(saleId);
      log('pos.sale.failed', 'payment', saleId, `Card sale ${reply.state}`, {
        enrollmentId: enrollment.enrollmentId,
        reference,
        reason: reply.failureReason,
      });
    }
  } catch (error) {
    const isTransport = error instanceof PosTransportError;
    posSales.updateSale(saleId, {
      state: 'error',
      message: isTransport
        ? describeTransportError(error)
        : 'Something went wrong talking to the card machine',
      failureReason: isTransport ? error.code : 'INTERNAL',
    });
    log('pos.sale.error', 'payment', saleId, 'Card sale failed', {
      enrollmentId: enrollment.enrollmentId,
      reference,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    running.delete(saleId);
    await session.transport.close().catch(() => undefined);
  }
}

/**
 * Writes the payment and confirms the enrollment.
 *
 * Kept separate and synchronous: by the time this runs the card is already
 * charged, so every statement here must succeed or the customer has paid for
 * nothing. SQLite gives us a transaction to make that all-or-nothing.
 */
function settleApproved(
  saleId: string,
  enrollment: NonNullable<ReturnType<typeof enrollments.getEnrollment>>,
  terminalRef: string | null,
  instrument: string | null,
): void {
  const payment = payments.createPayment({
    enrollmentId: enrollment.id,
    method: 'card_present',
    amount: enrollment.amount,
    currency: enrollment.currency,
    instrument,
    status: 'success',
    gatewayRef: terminalRef,
    failureReason: null,
  });

  const confirmed = enrollments.setEnrollmentStatus(enrollment.id, 'confirmed');
  courses.incrementEnrollmentCount(enrollment.courseId);
  if (enrollment.batchId) courses.reserveBatchSeat(enrollment.courseId, enrollment.batchId);

  posSales.settleSale(saleId);

  log('payment.succeeded', 'payment', payment.id, 'Card present payment approved', {
    enrollmentId: confirmed?.enrollmentId ?? enrollment.enrollmentId,
    reference: payment.reference,
    gatewayRef: terminalRef,
    method: 'card_present',
  });
  log(
    'enrollment.confirmed',
    'enrollment',
    enrollment.id,
    `Enrollment confirmed for ${enrollment.courseName}`,
    { enrollmentId: enrollment.enrollmentId },
  );
}

function describeTransportError(error: PosTransportError): string {
  switch (error.code) {
    case 'UNREACHABLE':
      return 'Could not reach the card machine. Check that it is on and connected.';
    case 'TIMEOUT':
      return 'The card machine did not respond in time.';
    case 'DEVICE_BUSY':
      return 'The card machine is busy with another transaction.';
    case 'NOT_CONFIGURED':
      return 'The card machine is not configured. Set it up in admin settings.';
    default:
      return 'Lost connection to the card machine.';
  }
}

export function getStatus(saleId: string): PosSaleStatus | null {
  return posSales.getSale(saleId);
}

/**
 * Requests cancellation. Refused once the terminal is authorising — pulling the
 * rug there is exactly how a card gets charged with no enrollment to show.
 */
export function requestCancel(saleId: string): PosSaleStatus | null {
  const sale = posSales.getSale(saleId);
  if (!sale) return null;
  if (sale.isTerminal) return sale;
  if (sale.state === 'processing') return sale;

  running.get(saleId)?.cancel();
  return posSales.updateSale(saleId, { message: 'Cancelling…' });
}

/**
 * Reports sales abandoned by a crash. The terminal may have approved any of
 * these, so they are surfaced rather than quietly deleted.
 */
export function reportUnsettledSales(): void {
  const open = posSales.listUnsettledSales().filter((sale) => sale.state !== 'connecting');
  if (open.length === 0) return;

  console.warn(
    `  ⚠ ${open.length} card sale(s) left unsettled by a previous run — reconcile against the terminal:`,
  );
  for (const sale of open) {
    console.warn(`    ${sale.saleId}  ref=${sale.terminalRef ?? '(none)'}  state=${sale.state}`);
    log('pos.sale.unsettled', 'payment', sale.saleId, 'Sale left in flight by a previous run', {
      reference: sale.terminalRef,
      state: sale.state,
    });
  }
}
