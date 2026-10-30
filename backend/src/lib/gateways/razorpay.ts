import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env.ts';
import { HttpError } from '../http.ts';

const API = 'https://api.razorpay.com/v1';

function authHeader(): string {
  if (!env.isRazorpayConfigured) {
    throw new HttpError(
      503,
      'GATEWAY_UNCONFIGURED',
      'Razorpay is not configured on this server',
    );
  }
  const credentials = `${env.razorpayKeyId}:${env.razorpayKeySecret}`;
  return `Basic ${Buffer.from(credentials).toString('base64')}`;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      502,
      'GATEWAY_UNREACHABLE',
      'Could not reach the payment gateway. Please try again.',
    );
  }

  const body = (await response.json().catch(() => null)) as
    | (T & { error?: { description?: string; code?: string } })
    | null;

  if (!response.ok) {
    // Razorpay's own description is user-appropriate ("amount must be at least…").
    throw new HttpError(
      response.status === 401 ? 500 : 502,
      body?.error?.code ?? 'GATEWAY_ERROR',
      body?.error?.description ?? 'The payment gateway rejected this request',
    );
  }
  return body as T;
}

export interface RazorpayOrder {
  id: string;
  /** Amount in the smallest currency unit (fils for AED). */
  amount: number;
  currency: string;
  receipt: string;
  status: string;
}

export interface RazorpayPayment {
  id: string;
  order_id: string;
  status: string;
  method: string;
  amount: number;
  currency: string;
  email?: string;
  contact?: string;
  card?: { last4?: string; network?: string };
  vpa?: string;
  bank?: string;
  wallet?: string;
  error_description?: string;
}

/**
 * Razorpay works in the smallest currency unit. Our prices are whole rupees,
 * so round to paise defensively rather than trusting float arithmetic.
 */
export const toMinorUnits = (amount: number): number => Math.round(amount * 100);

export const createOrder = (params: {
  amount: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> =>
  call<RazorpayOrder>('/orders', {
    method: 'POST',
    body: JSON.stringify({
      amount: toMinorUnits(params.amount),
      currency: params.currency,
      receipt: params.receipt.slice(0, 40),
      notes: params.notes ?? {},
    }),
  });

export const fetchPayment = (paymentId: string): Promise<RazorpayPayment> =>
  call<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}`);

/**
 * Verifies the checkout callback really came from Razorpay.
 *
 * This is the security boundary of the whole integration: without it a student
 * could POST a made-up payment id and get a confirmed enrollment. Compared in
 * constant time so the signature can't be recovered by timing.
 */
export function verifySignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  if (!env.razorpayKeySecret) return false;

  const expected = createHmac('sha256', env.razorpayKeySecret)
    .update(`${params.orderId}|${params.paymentId}`)
    .digest('hex');

  const provided = params.signature.trim().toLowerCase();
  if (provided.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'));
}

/** Human-readable, non-sensitive descriptor of the instrument actually used. */
export function describeInstrument(payment: RazorpayPayment): string {
  switch (payment.method) {
    case 'card':
      return payment.card?.last4
        ? `${payment.card.network ?? 'Card'} •••• ${payment.card.last4}`
        : 'Card';
    case 'upi':
      return payment.vpa ?? 'UPI';
    case 'netbanking':
      return payment.bank ? `Net banking — ${payment.bank}` : 'Net banking';
    case 'wallet':
      return payment.wallet ? `Wallet — ${payment.wallet}` : 'Wallet';
    default:
      return payment.method ?? 'Razorpay';
  }
}

/** Maps a Razorpay method onto our narrower PaymentMethod union. */
export function toPaymentMethod(method: string): 'upi' | 'card' | 'netbanking' {
  if (method === 'upi') return 'upi';
  if (method === 'netbanking') return 'netbanking';
  return 'card';
}
