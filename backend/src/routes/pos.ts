import type { PosTestResult } from '@course-lms/shared';
import { createPosSession } from '../lib/pos/index.ts';
import { listSerialPorts } from '../lib/pos/ports.ts';
import * as sale from '../lib/pos/sale.ts';
import { PosTransportError } from '../lib/pos/transport.ts';
import { hasValidSession } from '../lib/auth.ts';
import { badRequest, conflict, json, notFound, readJson, unauthorized } from '../lib/http.ts';
import { getConfig } from '../repo/settings.ts';
import { route } from '../router.ts';

// ---------------------------------------------------------------------------
// Kiosk — card-present sale lifecycle
//
// Split into start / poll / cancel rather than one long request: a customer
// hunting for their card routinely takes longer than any reasonable HTTP
// timeout, and a dropped connection must not abandon a sale that is already
// running on the terminal.
// ---------------------------------------------------------------------------

route.post('/api/payments/pos/sale', async ({ req }) => {
  const body = await readJson(req);
  const enrollmentId = typeof body.enrollmentId === 'string' ? body.enrollmentId : '';
  if (!enrollmentId) throw badRequest('enrollmentId is required');

  const { pos } = getConfig();
  if (!pos.isEnabled) throw conflict('The card machine is not enabled');

  try {
    return json(sale.startSale(enrollmentId, pos), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not start the sale';
    if (message.includes('already been paid')) throw conflict(message);
    if (message.includes('not found')) throw notFound(message);
    throw badRequest(message);
  }
});

route.get('/api/payments/pos/sale/:saleId', ({ params }) => {
  const status = sale.getStatus(params.saleId as string);
  if (!status) throw notFound('Sale not found');
  return json(status);
});

route.post('/api/payments/pos/sale/:saleId/cancel', ({ params }) => {
  const status = sale.requestCancel(params.saleId as string);
  if (!status) throw notFound('Sale not found');
  return json(status);
});

// ---------------------------------------------------------------------------
// Admin — terminal setup
// ---------------------------------------------------------------------------

/**
 * Admin-only. `/test` in particular dials an arbitrary host and port from the
 * kiosk, so leaving it open would hand anyone a port scanner running inside the
 * network the terminal lives on.
 */
route.get('/api/admin/pos/serial-ports', async ({ req }) => {
  if (!hasValidSession(req)) throw unauthorized('Sign in to continue');
  return json({ items: await listSerialPorts() });
});

/**
 * Probes the terminal with the settings currently on screen, which may not be
 * saved yet — an operator should be able to find the right port before
 * committing it.
 */
route.post('/api/admin/pos/test', async ({ req }) => {
  if (!hasValidSession(req)) throw unauthorized('Sign in to continue');

  const body = await readJson(req);
  const current = getConfig().pos;

  const candidate = {
    ...current,
    ...(body as Record<string, unknown>),
    lan: { ...current.lan, ...((body.lan as object) ?? {}) },
    serial: { ...current.serial, ...((body.serial as object) ?? {}) },
  } as typeof current;

  const startedAt = Date.now();
  let session;

  try {
    session = createPosSession(candidate);
    await session.transport.probe(8000);

    const result: PosTestResult = {
      ok: true,
      transport: candidate.transport,
      message:
        candidate.transport === 'mock'
          ? 'Mock terminal responding — no hardware involved'
          : 'Card machine responded',
      latencyMs: Date.now() - startedAt,
    };
    return json(result);
  } catch (error) {
    const result: PosTestResult = {
      ok: false,
      transport: candidate.transport,
      message:
        error instanceof PosTransportError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Could not reach the card machine',
      latencyMs: null,
    };
    // A failed probe is a valid answer to "is it plugged in?", not a server
    // error — 200 keeps the UI handling on one path.
    return json(result);
  } finally {
    await session?.transport.close().catch(() => undefined);
  }
});
