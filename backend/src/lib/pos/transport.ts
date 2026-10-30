import type { PosConfig } from '@course-lms/shared';

/**
 * A byte pipe to the card machine.
 *
 * Deliberately dumb: it moves frames, it does not understand them. That split
 * is what lets the same LAN and serial code serve whatever wire format the
 * acquirer turns out to use — only the protocol adapter changes.
 */
export interface PosTransport {
  readonly kind: 'lan' | 'serial' | 'mock';

  /** Opens the link. Must be safe to call when already open. */
  open(): Promise<void>;

  /** Sends one framed request and resolves with the matching reply. */
  send(frame: Uint8Array, timeoutMs: number): Promise<Uint8Array>;

  /**
   * Waits for an unsolicited frame — terminals push progress ("CARD INSERTED",
   * "PIN ENTERED") between request and final result.
   */
  receive(timeoutMs: number): Promise<Uint8Array>;

  close(): Promise<void>;

  /** Cheap round-trip for the admin "Test connection" button. */
  probe(timeoutMs: number): Promise<void>;
}

export class PosTransportError extends Error {
  constructor(
    readonly code:
      | 'UNREACHABLE'
      | 'TIMEOUT'
      | 'CLOSED'
      | 'DEVICE_BUSY'
      | 'NOT_CONFIGURED'
      | 'UNSUPPORTED',
    message: string,
  ) {
    super(message);
    this.name = 'PosTransportError';
  }
}

export type TransportFactory = (config: PosConfig) => PosTransport;
