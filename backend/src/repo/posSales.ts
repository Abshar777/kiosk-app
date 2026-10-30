import type { PosSaleState, PosSaleStatus, PosTransport } from '@course-lms/shared';
import { db } from '../db.ts';
import { newId } from '../lib/ids.ts';

interface PosSaleRow {
  id: string;
  enrollment_id: string;
  reference: string;
  state: string;
  message: string;
  amount: number;
  currency: string;
  transport: string;
  terminal_ref: string | null;
  instrument: string | null;
  auth_code: string | null;
  failure_reason: string | null;
  settled_at: string | null;
  created_at: string;
  updated_at: string;
}

/** States after which the terminal will send nothing more. */
const FINAL_STATES: PosSaleState[] = ['approved', 'declined', 'cancelled', 'error'];

export const isFinalState = (state: PosSaleState): boolean => FINAL_STATES.includes(state);

function mapSale(row: PosSaleRow): PosSaleStatus {
  const state = row.state as PosSaleState;
  return {
    saleId: row.id,
    enrollmentId: row.enrollment_id,
    state,
    message: row.message,
    amount: row.amount,
    currency: row.currency,
    terminalRef: row.terminal_ref,
    instrument: row.instrument,
    authCode: row.auth_code,
    failureReason: row.failure_reason,
    isTerminal: isFinalState(state),
  };
}

/**
 * Records the sale BEFORE the customer is prompted.
 *
 * The row existing is what makes a mid-sale crash recoverable: on restart,
 * reconciliation can ask the terminal about `reference` rather than leaving a
 * charged card with no enrollment behind it.
 */
export function createSale(input: {
  enrollmentId: string;
  reference: string;
  amount: number;
  currency: string;
  transport: PosTransport;
}): PosSaleStatus {
  const now = new Date().toISOString();
  const id = newId();

  db.query(
    `INSERT INTO pos_sales
       (id, enrollment_id, reference, state, message, amount, currency, transport,
        created_at, updated_at)
     VALUES ($id, $enrollmentId, $reference, 'connecting', '', $amount, $currency,
             $transport, $now, $now)`,
  ).run({
    $id: id,
    $enrollmentId: input.enrollmentId,
    $reference: input.reference,
    $amount: input.amount,
    $currency: input.currency,
    $transport: input.transport,
    $now: now,
  });

  return getSale(id)!;
}

export function getSale(id: string): PosSaleStatus | null {
  const row = db.query('SELECT * FROM pos_sales WHERE id = $id').get({ $id: id }) as
    | PosSaleRow
    | null;
  return row ? mapSale(row) : null;
}

export function getSaleByReference(reference: string): PosSaleStatus | null {
  const row = db
    .query('SELECT * FROM pos_sales WHERE reference = $reference')
    .get({ $reference: reference }) as PosSaleRow | null;
  return row ? mapSale(row) : null;
}

/** Most recent unsettled sale for an enrollment, so a reload rejoins it. */
export function getOpenSaleForEnrollment(enrollmentId: string): PosSaleStatus | null {
  const row = db
    .query(
      `SELECT * FROM pos_sales
        WHERE enrollment_id = $enrollmentId AND settled_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get({ $enrollmentId: enrollmentId }) as PosSaleRow | null;
  return row ? mapSale(row) : null;
}

export function updateSale(
  id: string,
  patch: Partial<{
    state: PosSaleState;
    message: string;
    terminalRef: string | null;
    instrument: string | null;
    authCode: string | null;
    failureReason: string | null;
  }>,
): PosSaleStatus | null {
  const sets: string[] = ['updated_at = $updatedAt'];
  const params: Record<string, string | number | null> = {
    $id: id,
    $updatedAt: new Date().toISOString(),
  };

  const column: Record<string, string> = {
    state: 'state',
    message: 'message',
    terminalRef: 'terminal_ref',
    instrument: 'instrument',
    authCode: 'auth_code',
    failureReason: 'failure_reason',
  };

  for (const [key, value] of Object.entries(patch)) {
    const col = column[key];
    if (!col || value === undefined) continue;
    sets.push(`${col} = $${key}`);
    params[`$${key}`] = value as string | number | null;
  }

  db.query(`UPDATE pos_sales SET ${sets.join(', ')} WHERE id = $id`).run(
    params as Record<string, string | number | null>,
  );
  return getSale(id);
}

/** Marks the sale as fully handled — a payment row now exists for it. */
export function settleSale(id: string): void {
  db.query('UPDATE pos_sales SET settled_at = $now, updated_at = $now WHERE id = $id').run({
    $id: id,
    $now: new Date().toISOString(),
  });
}

/**
 * Sales left unsettled by a crash or power cut. Anything still here on startup
 * needs a human or the terminal's own records to resolve.
 */
export function listUnsettledSales(): PosSaleStatus[] {
  const rows = db
    .query('SELECT * FROM pos_sales WHERE settled_at IS NULL ORDER BY created_at ASC')
    .all() as PosSaleRow[];
  return rows.map(mapSale);
}
