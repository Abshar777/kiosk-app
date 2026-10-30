import type { PosConfig } from '@course-lms/shared';
import { genericEcr } from './genericEcr.ts';
import { createLanTransport } from './lan.ts';
import { createMockTransport } from './mock.ts';
import type { PosSession } from './protocol.ts';
import { createSerialTransport } from './serial.ts';
import { PosTransportError, type PosTransport } from './transport.ts';

/**
 * Where a card-present sale is assembled: one transport (how we reach the
 * machine) plus one protocol (what we say to it).
 *
 * Every transport here needs the backend to be running on the kiosk itself.
 * A LAN terminal is reachable only from the kiosk's own network, and a cabled
 * one only from the machine it is plugged into. A backend on a server
 * elsewhere cannot use any of this and would need a cloud payment API instead.
 */
export function createPosSession(config: PosConfig): PosSession {
  return { transport: createTransport(config), protocol: genericEcr };
}

function createTransport(config: PosConfig): PosTransport {
  switch (config.transport) {
    case 'mock':
      // Needs nothing: that is the entire point of it.
      return createMockTransport(config);

    case 'lan': {
      const { host, port } = config.lan;
      requireText(host, 'the card machine’s IP address');
      requirePort(port);
      return createLanTransport(config);
    }

    case 'serial': {
      const { path, baudRate } = config.serial;
      requireText(path, 'a serial port');
      if (!Number.isInteger(baudRate) || baudRate <= 0) {
        throw new PosTransportError(
          'NOT_CONFIGURED',
          `Serial baud rate ${baudRate} is not usable — set it to the rate the card machine expects (commonly 9600, 19200 or 115200).`,
        );
      }
      return createSerialTransport(config);
    }

    default: {
      // Exhaustiveness: adding a transport to POS_TRANSPORTS fails the build
      // here rather than falling through to a confusing runtime error.
      const unreached: never = config.transport;
      throw new PosTransportError(
        'UNSUPPORTED',
        `No transport implemented for "${String(unreached)}"`,
      );
    }
  }
}

function requireText(value: string, what: string): void {
  if (value.trim().length === 0) {
    throw new PosTransportError(
      'NOT_CONFIGURED',
      `Card machine not set up: ${what} is missing. Fill it in under Settings → Card machine.`,
    );
  }
}

function requirePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new PosTransportError(
      'NOT_CONFIGURED',
      `Card machine port ${port} is not a valid TCP port (1–65535).`,
    );
  }
}

/**
 * Deliberately NOT validated here:
 *
 * - `merchantId` / `terminalId` — needed to run a sale, not to open a link.
 *   An operator should be able to prove the cable or the IP works before the
 *   acquirer has issued the identifiers. The sale runner enforces them.
 * - `isEnabled` — the admin "Test connection" button exists precisely so the
 *   terminal can be set up and tested before card payment is switched on.
 */

export { genericEcr } from './genericEcr.ts';
export { createMockTransport } from './mock.ts';
