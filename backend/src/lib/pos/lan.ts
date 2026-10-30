import type { PosConfig } from '@course-lms/shared';
import { PosTransportError, type PosTransport } from './transport.ts';

/**
 * TCP/IP transport to a card terminal sitting on the kiosk LAN.
 *
 * Bun's socket API is callback-based, so everything below exists to bridge it
 * to the promise-based `PosTransport` interface: bytes land in a frame
 * assembler, completed frames are handed to whoever is waiting (or parked in a
 * short backlog if nobody is yet), and every wait carries its own deadline.
 *
 * ---------------------------------------------------------------------------
 * FRAMING — ASSUMED, NOT SPECIFIED
 * ---------------------------------------------------------------------------
 * Network International does not publish an ECR specification; it is issued
 * per-merchant under NDA. (Verified again while writing this: network.ae
 * serves 403 to non-browser clients and no NI ECR document is publicly
 * indexed.) So the delimiting below is an ASSUMPTION, taken from the framing
 * that every *published* ECR protocol shares — Nexi, Viva, Comgate, QFPay,
 * Payex:
 *
 *     STX (0x02) | payload … | ETX (0x03) | LRC (1 byte)
 *
 * Specifically assumed, and each of these may be wrong for the real spec:
 *
 *   1. A frame starts at STX and ends one byte after ETX (the LRC).
 *   2. The payload never contains a bare 0x03. Published ECR protocols hold to
 *      this by restricting payloads to printable ASCII with 0x1C/0x1D field
 *      separators. If the real spec allows binary payloads, this needs a
 *      length prefix or byte stuffing instead.
 *   3. Bytes arriving outside a frame (a link-level ACK 0x06 or NAK 0x15 are
 *      the usual ones) are discarded as noise. If the real spec expects us to
 *      act on ACK/NAK at the link layer, that belongs here, not in the
 *      protocol adapter.
 *
 * Only the delimiting lives here. The transport never looks inside a frame and
 * never computes or checks the LRC — frames are passed through verbatim,
 * STX/ETX/LRC included, for `PosProtocol.decode` to interpret. Changing to a
 * length-prefixed format means changing `FrameAssembler` alone.
 */

/** Start of text — first byte of a frame. */
export const STX = 0x02;
/** End of text — last payload byte; one LRC byte follows it. */
export const ETX = 0x03;

const EMPTY = new Uint8Array(0);

/**
 * Hard ceiling on unframed bytes held in memory. A terminal that desyncs (or
 * anything else answering on that port) must not grow the buffer forever.
 */
const MAX_BUFFERED_BYTES = 8 * 1024;

/**
 * Unsolicited frames kept while nobody is waiting. Terminals push progress
 * ("CARD INSERTED", "PIN ENTERED") faster than a poll loop consumes them.
 */
const MAX_BACKLOG_FRAMES = 32;

/** Connect deadline when the caller has no timeout of its own to apply. */
export const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

/**
 * Reassembles frames from a byte stream.
 *
 * Both directions fragment: TCP splits one frame across packets and coalesces
 * several into one, and serial is worse. Callers push whatever arrived and get
 * back only the frames that are now complete.
 */
export class FrameAssembler {
  #buf: Uint8Array = EMPTY;

  /** Feeds raw bytes in; returns every frame completed by them, in order. */
  push(chunk: Uint8Array): Uint8Array[] {
    if (chunk.length === 0) return [];
    const merged = new Uint8Array(this.#buf.length + chunk.length);
    merged.set(this.#buf, 0);
    merged.set(chunk, this.#buf.length);
    this.#buf = merged;
    return this.#harvest();
  }

  #harvest(): Uint8Array[] {
    const frames: Uint8Array[] = [];

    for (;;) {
      const start = this.#buf.indexOf(STX);
      if (start === -1) {
        // No frame has begun, so everything held is pre-STX noise.
        this.#buf = EMPTY;
        break;
      }
      // Drop anything before STX (ACK/NAK/garbage) and resync on the frame.
      if (start > 0) this.#buf = this.#buf.subarray(start);

      // Search from 1 so the frame's own STX is never read as a terminator.
      const etx = this.#buf.indexOf(ETX, 1);
      // Either ETX has not arrived, or it has but its LRC byte has not.
      if (etx === -1 || this.#buf.length < etx + 2) break;

      frames.push(this.#buf.slice(0, etx + 2));
      this.#buf = this.#buf.slice(etx + 2);
    }

    if (this.#buf.length > MAX_BUFFERED_BYTES) {
      console.warn(
        `[pos] dropping ${this.#buf.length} unframed bytes — no complete frame within ${MAX_BUFFERED_BYTES} bytes`,
      );
      this.#buf = EMPTY;
    }
    return frames;
  }

  /** Forgets a half-received frame. Called whenever the link is torn down. */
  reset(): void {
    this.#buf = EMPTY;
  }

  /** Bytes held for an incomplete frame — diagnostics only. */
  get buffered(): number {
    return this.#buf.length;
  }
}

interface Waiter {
  resolve: (frame: Uint8Array) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * The pending-resolver queue that makes a callback stream awaitable.
 *
 * A frame delivered while someone waits resolves that wait; a frame delivered
 * with nobody waiting is parked, so a progress frame that beats its `receive()`
 * call is not lost. Waits are served first-in-first-out and each carries its
 * own deadline.
 */
export class FrameInbox {
  #waiters: Waiter[] = [];
  #backlog: Uint8Array[] = [];

  /** Hands a completed frame to the longest-waiting caller, or parks it. */
  deliver(frame: Uint8Array): void {
    const waiter = this.#waiters.shift();
    if (waiter) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(frame);
      return;
    }
    this.#backlog.push(frame);
    while (this.#backlog.length > MAX_BACKLOG_FRAMES) {
      this.#backlog.shift();
      console.warn('[pos] frame backlog full — dropped the oldest unread frame');
    }
  }

  /** Resolves with the next frame, or rejects with TIMEOUT after `timeoutMs`. */
  take(timeoutMs: number, what: string): Promise<Uint8Array> {
    const parked = this.#backlog.shift();
    if (parked) return Promise.resolve(parked);

    return new Promise<Uint8Array>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.#forget(waiter);
        reject(
          new PosTransportError(
            'TIMEOUT',
            `Timed out after ${timeoutMs}ms waiting for ${what} from the terminal`,
          ),
        );
      }, timeoutMs);
      this.#waiters.push(waiter);
    });
  }

  /** Discards parked frames; returns how many. Used before a new request. */
  drainBacklog(): number {
    const dropped = this.#backlog.length;
    this.#backlog = [];
    return dropped;
  }

  /** Rejects every in-flight wait — the link went away under them. */
  failAll(error: Error): void {
    const waiters = this.#waiters;
    this.#waiters = [];
    for (const waiter of waiters) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  #forget(waiter: Waiter): void {
    const at = this.#waiters.indexOf(waiter);
    if (at !== -1) this.#waiters.splice(at, 1);
  }

  get pending(): number {
    return this.#waiters.length;
  }

  /** Frames received but not yet read by anyone. */
  get parked(): number {
    return this.#backlog.length;
  }
}

type TcpSocket = import('bun').Socket<undefined>;

class LanTransport implements PosTransport {
  readonly kind = 'lan' as const;

  readonly #host: string;
  readonly #port: number;
  readonly #connectTimeoutMs: number;

  #socket: TcpSocket | null = null;
  /** Shared by concurrent `open()` calls so one connect serves them all. */
  #opening: Promise<void> | null = null;
  /** Tail of a frame the socket could not take in one write (backpressure). */
  #pendingWrite: Uint8Array | null = null;
  /**
   * Bumped on every connect, loss and close. Socket callbacks carry the
   * generation they were registered with and do nothing once it is stale, so a
   * socket we have already given up on cannot tear down the link that replaced
   * it.
   */
  #generation = 0;

  readonly #assembler = new FrameAssembler();
  readonly #inbox = new FrameInbox();

  constructor(host: string, port: number, connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS) {
    this.#host = host;
    this.#port = port;
    this.#connectTimeoutMs = connectTimeoutMs;
  }

  get #address(): string {
    return `${this.#host}:${this.#port}`;
  }

  /** Idempotent: a no-op when open, and shared when a connect is in flight. */
  async open(): Promise<void> {
    if (this.#socket) return;
    if (this.#opening) return this.#opening;

    if (!this.#host.trim() || !Number.isInteger(this.#port) || this.#port <= 0) {
      throw new PosTransportError(
        'NOT_CONFIGURED',
        'Terminal host and port are not set — fill them in under Settings › Card terminal',
      );
    }

    const attempt = this.#connect();
    this.#opening = attempt;
    try {
      await attempt;
    } finally {
      this.#opening = null;
    }
  }

  async #connect(): Promise<void> {
    const generation = ++this.#generation;
    // Cleared before the socket exists rather than after: `data` is live from
    // the moment the connection is up, so resetting afterwards would throw
    // away the start of a frame that arrived immediately.
    this.#assembler.reset();
    this.#pendingWrite = null;

    const socket = await this.#dial(generation);

    if (generation !== this.#generation) {
      // close() ran, or another connect superseded us, while we were dialling.
      // Release the handle instead of installing a socket nobody owns.
      try {
        socket.terminate();
      } catch {
        // Already gone — nothing to release.
      }
      throw new PosTransportError(
        'CLOSED',
        'Link to the terminal was closed while it was still connecting',
      );
    }

    this.#socket = socket;
  }

  /**
   * Opens the socket, mapping every failure to UNREACHABLE and guaranteeing no
   * handle survives a failed attempt — including the awkward case where the
   * connect lands *after* our deadline, which would otherwise leave an open
   * socket with no owner.
   */
  async #dial(generation: number): Promise<TcpSocket> {
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connecting = Bun.connect<undefined>({
      hostname: this.#host,
      port: this.#port,
      socket: {
        data: (_socket, chunk) => this.#onBytes(generation, chunk),
        drain: (socket) => this.#onDrain(generation, socket),
        end: () =>
          this.#onLost(generation, 'the terminal closed its side of the connection'),
        close: () => this.#onLost(generation, 'the connection to the terminal closed'),
        error: (_socket, error) => this.#onLost(generation, error.message),
        // Declared so Bun does not report the rejection below as unhandled;
        // the awaited promise is what actually surfaces the failure.
        connectError: () => {},
      },
    });

    // If the connect wins the race after we have given up, destroy the handle.
    void connecting.then(
      (late) => {
        if (timedOut) late.terminate();
      },
      () => {},
    );

    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(
          new PosTransportError(
            'UNREACHABLE',
            `No answer from the terminal at ${this.#address} within ${this.#connectTimeoutMs}ms`,
          ),
        );
      }, this.#connectTimeoutMs);
    });

    try {
      return await Promise.race([connecting, deadline]);
    } catch (error) {
      if (error instanceof PosTransportError) throw error;
      // Refused, no route, DNS failure — all the same thing to the operator.
      const reason = error instanceof Error ? error.message : String(error);
      throw new PosTransportError(
        'UNREACHABLE',
        `Could not reach the terminal at ${this.#address}: ${reason}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async send(frame: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
    await this.open();
    const socket = this.#socket;
    if (!socket) {
      throw new PosTransportError('CLOSED', 'Link to the terminal closed before the request was sent');
    }

    // Anything already parked pre-dates this request, so it cannot be the
    // reply to it. Drop it rather than resolving with a stale progress frame.
    const stale = this.#inbox.drainBacklog();
    if (stale > 0) {
      console.warn(`[pos/lan] discarded ${stale} stale frame(s) before sending a new request`);
    }

    this.#write(socket, frame);
    return this.#inbox.take(timeoutMs, 'a reply');
  }

  /**
   * Waits for a frame the terminal sent on its own. Deliberately does not
   * reopen a dropped link: if the connection died mid-sale, the caller needs
   * to hear CLOSED and reconcile, not silently wait on a fresh socket.
   */
  receive(timeoutMs: number): Promise<Uint8Array> {
    // Serve what already arrived before reporting the link gone. Terminals
    // routinely hang up immediately after their final response, so the
    // approval can be sitting in the backlog while the socket is already
    // dead — rejecting here would throw away the record of a charged card.
    if (this.#inbox.parked === 0 && !this.#socket) {
      return Promise.reject(
        new PosTransportError('CLOSED', 'No open link to the terminal to receive on'),
      );
    }
    return this.#inbox.take(timeoutMs, 'an update');
  }

  /** Safe to call twice; the second call is a no-op. */
  async close(): Promise<void> {
    // Invalidates this link's callbacks, and any connect still in flight, so
    // neither can resurrect the transport after it has been closed.
    this.#generation++;
    const socket = this.#socket;
    this.#socket = null;
    this.#pendingWrite = null;
    this.#assembler.reset();
    this.#inbox.drainBacklog();
    this.#inbox.failAll(
      new PosTransportError('CLOSED', 'Link to the terminal was closed'),
    );
    if (!socket) return;
    try {
      socket.end();
    } catch {
      // Already gone — nothing to release.
    }
  }

  /**
   * Connect, confirm the socket came up, hang up. Sends nothing, so it works
   * before the acquirer's protocol is known. Uses a throwaway link so a probe
   * can never disturb a sale in progress on this one.
   */
  async probe(timeoutMs: number): Promise<void> {
    if (this.#socket) return; // Already connected: the link is proven.
    const probe = new LanTransport(this.#host, this.#port, timeoutMs);
    try {
      await probe.open();
    } finally {
      await probe.close();
    }
  }

  #onBytes(generation: number, chunk: Uint8Array): void {
    if (generation !== this.#generation) return; // bytes from a dead socket
    for (const frame of this.#assembler.push(chunk)) {
      this.#inbox.deliver(frame);
    }
  }

  #write(socket: TcpSocket, bytes: Uint8Array): void {
    // A tail still waiting for `drain` means the kernel buffer is full. Queue
    // behind it rather than replacing it: two half-frames interleaved on the
    // wire is a corrupt request, and a corrupt request to a terminal is a
    // sale nobody can account for.
    if (this.#pendingWrite) {
      const queued = new Uint8Array(this.#pendingWrite.length + bytes.length);
      queued.set(this.#pendingWrite, 0);
      queued.set(bytes, this.#pendingWrite.length);
      this.#pendingWrite = queued;
      return;
    }

    const written = socket.write(bytes);
    if (written < 0) {
      // Bun returns -1 when the socket is closed or shutting down. Fed to
      // `subarray` that counts from the END of the frame, which would send a
      // single stray byte and silently drop the request.
      throw new PosTransportError(
        'CLOSED',
        `Could not write to the terminal at ${this.#address} — the link is closing`,
      );
    }
    if (written < bytes.length) {
      // Kernel buffer full. Keep the tail; `drain` finishes it.
      this.#pendingWrite = bytes.subarray(written);
    }
  }

  #onDrain(generation: number, socket: TcpSocket): void {
    if (generation !== this.#generation) return; // not the live socket's tail
    const tail = this.#pendingWrite;
    if (!tail) return;
    this.#pendingWrite = null;
    try {
      this.#write(socket, tail);
    } catch {
      // Must not throw out of a socket callback. The link is going away; the
      // socket's own close callback fails the in-flight wait with CLOSED.
    }
  }

  #onLost(generation: number, reason: string): void {
    // A socket we have already given up on still reports `end`, `close` and
    // `error`. Acting on a stale one would null out the socket that replaced
    // it and reject a live sale's wait with CLOSED.
    if (generation !== this.#generation) return;
    this.#generation++;
    this.#socket = null;
    this.#pendingWrite = null;
    this.#assembler.reset();
    this.#inbox.failAll(new PosTransportError('CLOSED', `Terminal link lost: ${reason}`));
  }
}

/**
 * Builds a LAN transport from saved settings. Nothing connects until `open()`,
 * so an unconfigured or powered-off terminal costs nothing at startup.
 */
export function createLanTransport(config: PosConfig): PosTransport {
  return new LanTransport(config.lan.host, config.lan.port);
}
