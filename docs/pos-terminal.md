# Card machine (POS / ECR) integration

The kiosk can take payment on a physical card terminal standing beside it, as an
alternative to the hosted online gateway.

## Why the backend must run on the kiosk

Both supported transports talk to hardware that is either on the kiosk's own LAN
or cabled to the kiosk itself. The browser cannot open a TCP socket or a serial
port, so the terminal is driven from the Bun backend — which therefore has to run
on the kiosk machine. A backend on a central server has no route to the device
and would need the acquirer's **cloud** API instead, which is a different
integration.

## Architecture

```
kiosk UI  ──poll──>  /api/payments/pos/sale/:id
                            │
                     lib/pos/sale.ts          drives the sale, writes payment
                            │
                     lib/pos/index.ts         picks transport + protocol
                       ├── protocol.ts        PosProtocol  (the vendor seam)
                       └── transport.ts       PosTransport (byte pipe)
                            ├── lan.ts        TCP via Bun.connect
                            ├── serial.ts     USB/RS-232 via serialport
                            └── mock.ts       no hardware required
```

The split matters: **transports move bytes, protocols understand them.** Swapping
in a different acquirer's message format touches one file and leaves both
transports alone.

## Configuring it

Admin → Settings → Card machine.

| Setting | Notes |
| --- | --- |
| Transport | `LAN`, `USB / Serial`, or `Mock` |
| LAN host / port | Terminal's address on the kiosk network |
| Serial device | Picked from detected ports; `COM3` on Windows, `/dev/tty.usbmodem*` on macOS |
| Baud / data bits / stop bits / parity | Must match the terminal's ECR settings exactly |
| Merchant ID / Terminal ID | Issued by the acquirer |
| Sale timeout | Backend safety net; the terminal enforces its own too |
| Terminal prints slip | Leave on if the terminal should print its own charge slip alongside our receipt |

**Test connection** probes the terminal using the values currently on screen,
before you save them — so you can hunt for the right serial port without
committing a wrong one.

### Mock transport

`Mock` runs the entire flow with no hardware. Use it to demo the kiosk, and in
development. Outcomes are driven by the payable amount so each path is
reachable: an amount ending `.00` approves, `.01` declines, `.02` times out,
`.03` lets a cancel win.

## Crash safety — the part that matters

A terminal can approve a card and *then* the kiosk can lose power. Handled as
follows:

1. The sale row is written **before** the customer is prompted, carrying our
   reference.
2. The terminal's own reference is stored as soon as the terminal reports it.
3. The payment row and enrollment confirmation are written together.
4. The row is marked settled only once that succeeded.
5. On every startup, `reportUnsettledSales()` logs any sale left in flight.

If the API logs `⚠ N card sale(s) left unsettled`, those must be reconciled
against the terminal's own batch report before the day is closed. They are
surfaced rather than deleted precisely because the customer may already have
been charged.

Cancellation is refused once the terminal reaches `processing`. Pulling out
mid-authorisation is the most reliable way to create a charged card with no
enrollment behind it.

## Status: the wire protocol is NOT the real one

**Network International does not publish an ECR specification.** Their public
developer material (`docs.ngenius-payments.com`, the `network-international`
GitHub org) covers the **N-Genius online gateway** only — hosted payment pages,
Pay-by-Link, e-commerce plugins and in-app SDKs. Terminal specs are issued per
merchant by the acquirer, which is also how Nexi, Viva and Comgate distribute
theirs.

`genericEcr.ts` therefore implements the framing that published ECR protocols
agree on — `STX | payload | ETX | LRC`, pipe-delimited ASCII fields — and is
**an assumption, clearly marked as one in the source**. It is real, working,
tested code; it is simply not guaranteed to match your terminal.

## Status: USB/serial does not work on Bun yet

`serialport`'s native binding **panics the Bun process** the moment it opens a device:

```
panic(main thread): unsupported uv function: uv_default_loop
```

That is [oven-sh/bun#18546](https://github.com/oven-sh/bun/issues/18546). Enumeration
(`SerialPort.list()`) works fine, which is why it looks healthy until you connect.
Verified on macOS arm64, Bun 1.3.9 — Node 25 opens the same device without complaint.

A panic cannot be caught from JavaScript, so it would take the kiosk backend down
mid-sale. `serial.ts` therefore refuses to open and returns `UNSUPPORTED` with an
explanation, rather than risking the crash. Set `POS_SERIAL_ALLOW_BUN=1` to retest once
Bun fixes it.

**LAN is unaffected.** Until Bun ships a fix, the options are: use a LAN terminal, or
run the serial link in a small Node sidecar that the Bun API talks to over a socket.

## Where each setting comes from

Admin → Settings → Card machine. None of these are guessable — each has one source.

| Field | Where to get it |
| --- | --- |
| **Merchant ID (MID)** | Printed on the terminal's own receipt/charge slip, and on your acquirer statement. Your account manager can confirm it. |
| **Terminal ID (TID)** | Printed on the charge slip, usually beside the MID. Also on the terminal's settings/info screen — see below. |
| **Transport** | Ask the acquirer which your model supports. Many support both; some are LAN-only. |
| **LAN host** | The terminal's own IP. Read it from the terminal's menu (below), then **reserve it on your router** by MAC address — a DHCP lease change silently breaks payments. |
| **LAN port** | From the acquirer's ECR spec. Common values are 9100 or a vendor-specific port; do not guess. |
| **Serial device** | Picked from the dropdown — the kiosk lists what is actually attached. `COM3` on Windows, `/dev/tty.usbserial-*` on macOS, `/dev/ttyUSB0` on Linux. |
| **Baud / data bits / stop bits / parity** | From the ECR spec, and must match the terminal's own serial settings exactly. `9600 8-N-1` is the most common default. |

### Reading the terminal's own settings

The exact path differs by model, but on most Android terminals (Pine Labs, Paytm EDC,
Ezetap) and classic PAX/Verifone/Ingenico units it is roughly:

1. Press the **menu**/**func** key, or open the acquirer's app.
2. Find **Settings → Communication / Network** (sometimes behind a supervisor PIN —
   your acquirer sets this; it is often `9876`, `1234` or merchant-specific).
3. **IP address** is listed under the network/Ethernet or Wi-Fi section.
4. **TID / MID** are under **Terminal info**, **About**, or printed by a
   **Print → Terminal parameters** option.
5. **ECR / integration mode** usually appears under *Settings → ECR* or
   *Peripherals → Cash register*. If there is no such menu, the terminal is almost
   certainly not provisioned for integration — that is a change the acquirer makes
   remotely, not something you can switch on yourself.

The quickest reliable route is to **print a terminal parameters slip** from the
terminal's menu: it lists MID, TID, firmware and comms settings on one piece of paper.

### Testing without the real terminal

Set transport to **Mock** and the whole flow works end to end with no hardware. The
payable amount selects the outcome: ending `.00` approves, `.01` declines, `.02` times
out, `.03` lets a cancel win.

### What to request from Network International

Ask your account manager for, specifically:

1. **ECR / POS integration specification** for your exact terminal model.
2. Confirmation the Terminal ID is enabled for **integrated (ECR) mode** — a
   terminal in standalone mode cannot be driven by software at all, regardless
   of what is built here. This is a configuration change on their side.
3. Supported transport: **LAN (TCP)**, **serial/USB**, or both, and the
   terminal's listening port or required serial parameters.
4. **Test/UAT terminal plus credentials**, so this is never developed against a
   terminal that moves real money.
5. The **certification process** — most acquirers require an integration to pass
   certification before it is allowed on a live terminal.
6. Whether **refunds** can be initiated over ECR, or only from their portal.
   This decides whether the admin Refund button can work for card-present
   payments.

### Adopting the real spec

Implement `PosProtocol` from `lib/pos/protocol.ts` in a new file, register it in
`lib/pos/index.ts`, and delete nothing else. The transports, sale runner,
reconciliation, settings UI and kiosk screens are all protocol-agnostic.
