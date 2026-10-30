import type { PosSaleState } from '@course-lms/shared';
import type { PosTransport } from './transport.ts';

/**
 * Translates a sale into terminal frames and terminal frames back into state.
 *
 * Network International does not publish its ECR specification — it is issued
 * per-merchant by the acquirer — so this interface is the seam where that spec
 * plugs in. `genericEcr` below is a working implementation of the framing every
 * published ECR protocol shares (Nexi, Viva, Comgate), and the mock speaks it,
 * so the whole flow is exercisable before the real document arrives.
 *
 * To adopt the real spec, implement this interface and register it. Nothing
 * outside this folder changes.
 */
export interface PosProtocol {
  readonly name: string;

  /** Frame requesting a sale for `amount` minor units. */
  encodeSale(input: SaleInput): Uint8Array;

  /** Frame asking the terminal to abort the sale in progress. */
  encodeCancel(saleRef: string): Uint8Array;

  /** Frame for the connection probe (usually ECHO/STATUS). */
  encodeProbe(): Uint8Array;

  /** Interprets any frame the terminal sends back. */
  decode(frame: Uint8Array): PosReply;
}

export interface SaleInput {
  /** Minor units (fils for AED) — never a float. */
  amountMinor: number;
  currency: string;
  /** Our reference, echoed by the terminal so we can reconcile. */
  reference: string;
  merchantId: string;
  terminalId: string;
}

export interface PosReply {
  state: PosSaleState;
  message: string;
  terminalRef: string | null;
  /** Masked only — a protocol must never surface a full PAN. */
  instrument: string | null;
  authCode: string | null;
  failureReason: string | null;
}

export interface PosSession {
  transport: PosTransport;
  protocol: PosProtocol;
}
