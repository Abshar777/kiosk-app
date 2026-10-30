import type { PosConfig, PosSerialConfig } from '@course-lms/shared';
import { SerialPort } from 'serialport';
import { PosTransportError, type PosTransport } from './transport.ts';
import { FrameAssembler, FrameInbox } from './lan.ts';

/**
 * RS-232 / USB-serial transport to a cabled card terminal.
 *
 * Identical in shape to the LAN transport — same frame assembler, same
 * pending-resolver queue, same STX/ETX/LRC framing assumption, which is
 * documented at length at the top of `lan.ts`. Serial fragments far more than
 * TCP (the driver hands up whatever the UART had when it was polled, so a
 * single frame routinely arrives a few bytes at a time), which is exactly why
 * the buffering is shared rather than reimplemented.
 *
 * `FrameAssembler` / `FrameInbox` are imported from `lan.ts` because the
 * framing is one behaviour and must not drift between the two links. They
 * belong in a `framing.ts` of their own; this folder's shared files are owned
 * elsewhere, so they live in `lan.ts` for now.
 */

/** Serial writes are local; a port that will not open fails fast. */
const OPEN_TIMEOUT_MS = 2_000;

/**
 * VERIFIED BLOCKER — serialport cannot open a port under Bun.
 *
 * Measured on Bun 1.3.9 / macOS arm64 with serialport 13.0.0:
 *
 *   - `SerialPort.list()` works (so `ports.ts` is fine, and the admin
 *     dropdown populates).
 *   - Opening a device that does NOT exist works too: the binding returns
 *     ENOENT before it gets as far as libuv, so the error mapping below is
 *     exercised and correct.
 *   - Opening a device that DOES exist aborts the whole process:
 *       panic(main thread): unsupported uv function: uv_default_loop
 *     `@serialport/bindings-cpp` calls `uv_default_loop` to install its read
 *     poller once the fd is open, and Bun's NAPI shim does not implement it.
 *     See https://github.com/oven-sh/bun/issues/18546
 *
 * The same script under Node 25.6.0 opens the identical device cleanly, so
 * this is Bun's NAPI surface, not the package or our usage.
 *
 * A panic is not catchable from JavaScript — it takes the backend down with
 * it, which on a kiosk means mid-sale. So we refuse the open ourselves and
 * report UNSUPPORTED, which an operator can read and act on.
 *
 * TO LIFT THIS: the real fix is a decision for the orchestrator, not for this
 * file — most likely running the serial link in a small Node sidecar and
 * talking to it over a socket, or waiting for Bun to implement the function.
 * Set POS_SERIAL_ALLOW_BUN=1 to bypass the guard and retest on a newer Bun.
 */
function assertSerialIsUsable(): void {
  const isBun = typeof globalThis.Bun !== 'undefined';
  if (!isBun) return;
  if (process.env.POS_SERIAL_ALLOW_BUN === '1') return;

  throw new PosTransportError(
    'UNSUPPORTED',
    'Serial terminals are not usable on this runtime: the serialport native binding ' +
      'crashes Bun when it opens a port (unsupported uv function: uv_default_loop). ' +
      'Use the LAN transport, or run the serial link under Node. ' +
      'Set POS_SERIAL_ALLOW_BUN=1 to retest once Bun supports it.',
  );
}

/**
 * Maps a `serialport` open failure onto our transport codes.
 *
 * The bindings surface the OS errno in the message and sometimes in `code`, so
 * both are checked. Missing device -> UNREACHABLE; another process (or another
 * instance of us) holding the port -> DEVICE_BUSY, which the operator can
 * actually act on.
 */
function classifyOpenFailure(error: unknown, path: string): PosTransportError {
  const raw = error instanceof Error ? error.message : String(error);
  const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : '';
  const haystack = `${code} ${raw}`.toLowerCase();

  const busy = [
    'ebusy',
    'eacces',
    'eagain',
    'resource busy',
    'resource temporarily unavailable',
    'access denied',
    'permission denied',
    'already open',
    'cannot lock port',
    'port is locked',
  ];
  if (busy.some((needle) => haystack.includes(needle))) {
    return new PosTransportError(
      'DEVICE_BUSY',
      `${path} is in use by another program (or already open) — close it and try again: ${raw}`,
    );
  }

  return new PosTransportError(
    'UNREACHABLE',
    `Could not open ${path} — check the cable and that the device path is right: ${raw}`,
  );
}

class SerialTransport implements PosTransport {
  readonly kind = 'serial' as const;

  readonly #config: PosSerialConfig;
  readonly #openTimeoutMs: number;

  #port: SerialPort | null = null;
  /** Shared by concurrent `open()` calls so one attempt serves them all. */
  #opening: Promise<void> | null = null;
  /**
   * Bumped on every open, loss and close. Port listeners carry the generation
   * they were registered with and do nothing once it is stale, so a port we
   * have already given up on cannot tear down the one that replaced it.
   */
  #generation = 0;

  readonly #assembler = new FrameAssembler();
  readonly #inbox = new FrameInbox();

  constructor(config: PosSerialConfig, openTimeoutMs = OPEN_TIMEOUT_MS) {
    this.#config = config;
    this.#openTimeoutMs = openTimeoutMs;
  }

  /** Idempotent: a no-op when open, and shared when an open is in flight. */
  async open(): Promise<void> {
    if (this.#port?.isOpen) return;
    if (this.#opening) return this.#opening;

    if (!this.#config.path.trim()) {
      throw new PosTransportError(
        'NOT_CONFIGURED',
        'No serial device selected — pick one under Settings › Card terminal',
      );
    }

    // Refuse before touching the binding: see assertSerialIsUsable above.
    assertSerialIsUsable();

    const attempt = this.#openPort();
    this.#opening = attempt;
    try {
      await attempt;
    } finally {
      this.#opening = null;
    }
  }

  async #openPort(): Promise<void> {
    const { path, baudRate, dataBits, stopBits, parity } = this.#config;
    const generation = ++this.#generation;

    // Cleared before the port exists rather than after: `data` is live from
    // the moment it opens, so resetting afterwards would throw away the start
    // of a frame that arrived immediately.
    this.#assembler.reset();

    // autoOpen: false so listeners are attached before any byte can arrive,
    // and so a construction failure is an awaitable rejection rather than a
    // throw out of the next tick.
    const port = new SerialPort({
      path,
      baudRate,
      dataBits,
      stopBits,
      parity,
      autoOpen: false,
    });

    port.on('data', (chunk: Buffer) => this.#onBytes(generation, chunk));
    port.on('close', () => this.#onLost(generation, `${path} closed`));
    port.on('error', (error: Error) => this.#onLost(generation, error.message));

    try {
      await this.#awaitOpen(port, path);
    } catch (error) {
      // Never leave a handle behind on a failed open.
      await discard(port);
      throw error;
    }

    if (generation !== this.#generation) {
      // close() ran, the link was lost, or another open superseded us while
      // the port was opening. Release the handle rather than installing a port
      // nobody owns.
      await discard(port);
      throw new PosTransportError(
        'CLOSED',
        `${path} was closed while it was still opening`,
      );
    }

    this.#port = port;
  }

  #awaitOpen(port: SerialPort, path: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(
          new PosTransportError(
            'UNREACHABLE',
            `${path} did not open within ${this.#openTimeoutMs}ms`,
          ),
        );
      }, this.#openTimeoutMs);

      port.open((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(classifyOpenFailure(error, path));
        else resolve();
      });
    });
  }

  async send(frame: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
    await this.open();
    const port = this.#port;
    if (!port?.isOpen) {
      throw new PosTransportError(
        'CLOSED',
        'Serial link closed before the request could be sent',
      );
    }

    // Anything already parked pre-dates this request, so it cannot be its
    // reply. Drop it rather than resolving with a stale progress frame.
    const stale = this.#inbox.drainBacklog();
    if (stale > 0) {
      console.warn(`[pos/serial] discarded ${stale} stale frame(s) before sending a new request`);
    }

    await this.#write(port, frame);
    return this.#inbox.take(timeoutMs, 'a reply');
  }

  /**
   * Waits for a frame the terminal sent on its own. Does not reopen a dropped
   * link on purpose: a cable pulled mid-sale must surface as CLOSED so the
   * caller reconciles, rather than waiting on a freshly opened port.
   */
  receive(timeoutMs: number): Promise<Uint8Array> {
    // Serve what already arrived before reporting the link gone. A terminal
    // can send its final response and drop the line (or the cable can be
    // pulled) before the caller asks for it, so the approval can be sitting in
    // the backlog while the port is already dead — rejecting here would throw
    // away the record of a charged card.
    if (this.#inbox.parked === 0 && !this.#port?.isOpen) {
      return Promise.reject(
        new PosTransportError('CLOSED', 'No open serial link to receive on'),
      );
    }
    return this.#inbox.take(timeoutMs, 'an update');
  }

  /** Safe to call twice; the second call is a no-op. */
  async close(): Promise<void> {
    // Invalidates this port's listeners, and any open still in flight, so
    // neither can resurrect the transport after it has been closed.
    this.#generation++;
    const port = this.#port;
    this.#port = null;
    this.#assembler.reset();
    this.#inbox.drainBacklog();
    this.#inbox.failAll(new PosTransportError('CLOSED', 'Serial link was closed'));
    if (!port) return;
    await discard(port);
  }

  /**
   * Opens and closes the port without writing. Proves the cable, the driver
   * and that nothing else holds the device — all of which is checkable before
   * the acquirer's protocol is known. Uses a throwaway handle so a probe can
   * never disturb a sale in progress on this one.
   */
  async probe(timeoutMs: number): Promise<void> {
    if (this.#port?.isOpen) return; // Already open: the link is proven.
    const probe = new SerialTransport(this.#config, timeoutMs);
    try {
      await probe.open();
    } finally {
      await probe.close();
    }
  }

  #onBytes(generation: number, chunk: Uint8Array): void {
    if (generation !== this.#generation) return; // bytes from a dead port
    for (const frame of this.#assembler.push(chunk)) {
      this.#inbox.deliver(frame);
    }
  }

  /** Resolves once the bytes have left our buffers for the UART. */
  #write(port: SerialPort, bytes: Uint8Array): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      port.write(Buffer.from(bytes), (error) => {
        if (error) {
          reject(new PosTransportError('CLOSED', `Write to ${this.#config.path} failed: ${error.message}`));
          return;
        }
        port.drain((drainError) => {
          if (drainError) {
            reject(
              new PosTransportError(
                'CLOSED',
                `Flush to ${this.#config.path} failed: ${drainError.message}`,
              ),
            );
          } else {
            resolve();
          }
        });
      });
    });
  }

  #onLost(generation: number, reason: string): void {
    // A port we have already given up on still emits `close` and `error`
    // (an unplug usually raises both). Acting on a stale one would null out
    // the port that replaced it and reject a live sale's wait with CLOSED.
    if (generation !== this.#generation) return;
    this.#generation++;
    const port = this.#port;
    this.#port = null;
    this.#assembler.reset();
    this.#inbox.failAll(new PosTransportError('CLOSED', `Serial link lost: ${reason}`));
    // An `error` does not necessarily close the port, so dropping the only
    // reference to it would leak the descriptor and its listeners.
    if (port) void discard(port);
  }
}

/** Closes and detaches a port, swallowing the "already closed" case. */
async function discard(port: SerialPort): Promise<void> {
  try {
    if (port.isOpen) {
      await new Promise<void>((resolve) => {
        port.close(() => resolve());
      });
    }
  } catch {
    // Already gone — nothing to release.
  } finally {
    port.removeAllListeners();
  }
}

/**
 * Builds a serial transport from saved settings. Nothing is opened until
 * `open()`, so an unplugged terminal costs nothing at startup.
 */
export function createSerialTransport(config: PosConfig): PosTransport {
  return new SerialTransport(config.serial);
}
