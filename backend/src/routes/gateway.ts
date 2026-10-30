import type { GatewayOption, PaymentIntent, PaymentResult } from '@course-lms/shared';
import { env } from '../lib/env.ts';
import { badRequest, conflict, json, notFound, readJson } from '../lib/http.ts';
import * as razorpay from '../lib/gateways/razorpay.ts';
import * as courses from '../repo/courses.ts';
import * as enrollments from '../repo/enrollments.ts';
import { log } from '../repo/logs.ts';
import * as payments from '../repo/payments.ts';
import { getConfig } from '../repo/settings.ts';
import { route } from '../router.ts';
import { buildReceipt } from './receipt.ts';

/** Gateways the kiosk can offer, in the order they should be presented. */
export function listGateways(): GatewayOption[] {
  return [
    {
      id: 'razorpay',
      name: 'Razorpay',
      description: 'Cards, UPI, net banking and wallets',
      methods: ['upi', 'card', 'netbanking'],
      isAvailable: env.isRazorpayConfigured,
      isTestMode: env.isRazorpayTestMode,
    },
    {
      id: 'pos_terminal',
      name: 'Card machine',
      description: 'Pay by card at the terminal beside the kiosk',
      methods: ['card_present'],
      // Listed only once an operator has configured it — offering a card
      // machine that is not plugged in strands the customer mid-flow.
      isAvailable: getConfig().pos.isEnabled,
      isTestMode: getConfig().pos.transport === 'mock',
    },
    {
      id: 'simulated',
      name: 'Offline demo',
      description: 'Simulated gateway — no real payment is taken',
      methods: ['upi', 'card', 'netbanking'],
      isAvailable: process.env.ENABLE_SIMULATED_GATEWAY !== 'false',
      isTestMode: true,
    },
  ];
}

route.get('/api/payments/gateways', () =>
  json({ items: listGateways().filter((gateway) => gateway.isAvailable) }),
);

/**
 * Step 1 of a hosted-gateway payment: create the gateway-side order and hand
 * the browser everything it needs to open the checkout. No payment record is
 * written yet — that happens only after the signature is verified.
 */
route.post('/api/payments/intent', async ({ req }) => {
  const body = await readJson(req);

  const enrollmentKey = typeof body.enrollmentId === 'string' ? body.enrollmentId : '';
  const gatewayId = typeof body.gateway === 'string' ? body.gateway : 'razorpay';

  if (!enrollmentKey) throw badRequest('Missing enrollment reference');

  const gateway = listGateways().find((option) => option.id === gatewayId);
  if (!gateway || !gateway.isAvailable) {
    throw badRequest('That payment gateway is not available', { gateway: 'Unavailable' });
  }

  const enrollment = enrollments.getEnrollment(enrollmentKey);
  if (!enrollment) throw notFound('Enrollment not found');
  if (enrollment.status === 'confirmed') {
    throw conflict('This enrollment has already been paid for');
  }

  const config = getConfig();
  const base = {
    gateway: gateway.id,
    enrollmentId: enrollment.id,
    amount: enrollment.amount,
    currency: enrollment.currency,
    academyName: config.academy.name,
    courseName: enrollment.courseName,
    prefill: { name: enrollment.fullName, contact: enrollment.mobile },
    isTestMode: gateway.isTestMode,
  };

  if (gateway.id === 'simulated') {
    const intent: PaymentIntent = { ...base, orderId: null, publicKey: null };
    return json(intent, { status: 201 });
  }

  const order = await razorpay.createOrder({
    amount: enrollment.amount,
    currency: enrollment.currency,
    receipt: enrollment.enrollmentId,
    notes: {
      enrollmentId: enrollment.enrollmentId,
      course: enrollment.courseName.slice(0, 100),
    },
  });

  log('payment.initiated', 'payment', enrollment.id, `Razorpay order ${order.id} created`, {
    enrollmentId: enrollment.enrollmentId,
    orderId: order.id,
    amount: enrollment.amount,
  });

  const intent: PaymentIntent = {
    ...base,
    orderId: order.id,
    // The key id is publishable by design; the secret never leaves the server.
    publicKey: env.razorpayKeyId ?? null,
  };
  return json(intent, { status: 201 });
});

/**
 * Step 2: verify the checkout callback and, only if the signature holds,
 * record the payment and confirm the enrollment.
 */
route.post('/api/payments/verify', async ({ req }) => {
  const body = await readJson(req);

  const enrollmentKey = typeof body.enrollmentId === 'string' ? body.enrollmentId : '';
  const orderId = typeof body.razorpayOrderId === 'string' ? body.razorpayOrderId : '';
  const paymentId = typeof body.razorpayPaymentId === 'string' ? body.razorpayPaymentId : '';
  const signature = typeof body.razorpaySignature === 'string' ? body.razorpaySignature : '';

  if (!enrollmentKey || !orderId || !paymentId || !signature) {
    throw badRequest('Incomplete payment confirmation from the gateway');
  }

  const enrollment = enrollments.getEnrollment(enrollmentKey);
  if (!enrollment) throw notFound('Enrollment not found');
  if (enrollment.status === 'confirmed') {
    throw conflict('This enrollment has already been paid for');
  }

  if (!razorpay.verifySignature({ orderId, paymentId, signature })) {
    log('payment.failed', 'payment', enrollment.id, 'Signature verification failed', {
      enrollmentId: enrollment.enrollmentId,
      orderId,
      paymentId,
    });
    throw badRequest('We could not verify this payment. Please contact support.');
  }

  // Re-fetch server-side rather than trusting the browser's report of what happened.
  const remote = await razorpay.fetchPayment(paymentId);

  if (remote.order_id !== orderId) {
    throw badRequest('Payment does not belong to this order');
  }
  if (!['captured', 'authorized'].includes(remote.status)) {
    throw badRequest(`Payment is not complete (status: ${remote.status})`);
  }
  if (remote.amount !== razorpay.toMinorUnits(enrollment.amount)) {
    throw badRequest('Paid amount does not match the course price');
  }

  const payment = payments.createPayment({
    enrollmentId: enrollment.id,
    method: razorpay.toPaymentMethod(remote.method),
    amount: enrollment.amount,
    currency: enrollment.currency,
    instrument: razorpay.describeInstrument(remote),
    status: 'success',
    gatewayRef: remote.id,
    failureReason: null,
  });

  const confirmed = enrollments.setEnrollmentStatus(enrollment.id, 'confirmed')!;
  courses.incrementEnrollmentCount(enrollment.courseId);
  if (enrollment.batchId) courses.reserveBatchSeat(enrollment.courseId, enrollment.batchId);

  log('payment.succeeded', 'payment', payment.id, `Razorpay payment ${remote.id} captured`, {
    enrollmentId: confirmed.enrollmentId,
    reference: payment.reference,
    gatewayRef: remote.id,
    method: remote.method,
  });
  log(
    'enrollment.confirmed',
    'enrollment',
    confirmed.id,
    `Enrollment confirmed for ${confirmed.courseName}`,
    { enrollmentId: confirmed.enrollmentId },
  );

  const result: PaymentResult = {
    payment,
    enrollment: confirmed,
    receipt: buildReceipt(confirmed.id),
  };
  return json(result, { status: 201 });
});

/**
 * Records an abandoned or failed checkout so the audit log and admin reports
 * reflect what actually happened at the kiosk.
 */
route.post('/api/payments/failure', async ({ req }) => {
  const body = await readJson(req);
  const enrollmentKey = typeof body.enrollmentId === 'string' ? body.enrollmentId : '';
  if (!enrollmentKey) throw badRequest('Missing enrollment reference');

  const enrollment = enrollments.getEnrollment(enrollmentKey);
  if (!enrollment) throw notFound('Enrollment not found');
  if (enrollment.status === 'confirmed') {
    throw conflict('This enrollment has already been paid for');
  }

  const reason =
    typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim().slice(0, 300)
      : 'Payment was not completed';

  const payment = payments.createPayment({
    enrollmentId: enrollment.id,
    method: body.method === 'upi' || body.method === 'netbanking' ? body.method : 'card',
    amount: enrollment.amount,
    currency: enrollment.currency,
    instrument: null,
    status: 'failed',
    gatewayRef: null,
    failureReason: reason,
  });

  log('payment.failed', 'payment', payment.id, reason, {
    enrollmentId: enrollment.enrollmentId,
    gateway: body.gateway,
  });

  return json({ payment, enrollment }, { status: 201 });
});
