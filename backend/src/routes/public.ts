import type {
  CourseMode,
  CourseSort,
  DurationBucketId,
  PaymentResult,
} from '@course-lms/shared';
import { COURSE_LEVELS, COURSE_MODES, COURSE_SORTS, PAYMENT_METHODS } from '@course-lms/shared';
import { gateway, SUPPORTED_BANKS, validateInstrument } from '../lib/gateway.ts';
import { badRequest, conflict, json, notFound, readJson } from '../lib/http.ts';
import { nowIso } from '../lib/ids.ts';
import { FieldErrors, requireEnum, validateFullName, validateMobile } from '../lib/validation.ts';
import * as courses from '../repo/courses.ts';
import * as enrollments from '../repo/enrollments.ts';
import { log } from '../repo/logs.ts';
import * as payments from '../repo/payments.ts';
import { getConfig } from '../repo/settings.ts';
import { route } from '../router.ts';
import { listGateways } from './gateway.ts';
import { buildReceipt } from './receipt.ts';

route.get('/api/health', () => json({ ok: true, service: 'course-lms-api', time: nowIso() }));

route.get('/api/config', () =>
  json({
    ...getConfig(),
    banks: SUPPORTED_BANKS,
    gateways: listGateways().filter((gateway) => gateway.isAvailable),
  }),
);

route.get('/api/categories', () => json({ items: courses.listCategories() }));

route.get('/api/courses', ({ query }) => {
  const parseEnum = <T extends string>(value: string | null, allowed: readonly T[]): T | undefined =>
    value && allowed.includes(value as T) ? (value as T) : undefined;

  const result = courses.listCourses({
    q: query.get('q') ?? undefined,
    category: query.get('category') ?? undefined,
    mode: parseEnum<CourseMode>(query.get('mode'), COURSE_MODES),
    level: parseEnum(query.get('level'), COURSE_LEVELS),
    duration: (query.get('duration') as DurationBucketId | null) ?? undefined,
    sort: parseEnum<CourseSort>(query.get('sort'), COURSE_SORTS),
    page: Number(query.get('page')) || 1,
    pageSize: Number(query.get('pageSize')) || 24,
  });
  return json(result);
});

route.get('/api/courses/:id', ({ params }) => {
  const course = courses.getCourse(params.id as string);
  if (!course) throw notFound('Course not found');
  return json(course);
});

/**
 * Step 1 of the flow: capture name + mobile and hold a draft enrollment.
 * Nothing is confirmed and no seat is consumed until payment succeeds.
 */
route.post('/api/enrollments', async ({ req }) => {
  const body = await readJson(req);
  const errors = new FieldErrors();

  const courseId = typeof body.courseId === 'string' ? body.courseId : '';
  if (!courseId) errors.add('courseId', 'Please select a course');

  const fullName = validateFullName(body.fullName, errors);
  const mobile = validateMobile(body.mobile, errors);
  errors.throwIfAny();

  const course = courses.getCourse(courseId);
  if (!course) throw notFound('Course not found or no longer available');

  // A requested batch must belong to this course and still have a seat.
  let batchId: string | null = null;
  let batchLabel: string | null = null;
  if (typeof body.batchId === 'string' && body.batchId) {
    const batch = course.batches.find((b) => b.id === body.batchId);
    if (!batch) throw badRequest('Selected batch is not available for this course', { batchId: 'Invalid batch' });
    if (batch.seatsAvailable <= 0) throw conflict('That batch is now full. Please choose another.');
    batchId = batch.id;
    batchLabel = batch.label;
  }

  const enrollment = enrollments.createEnrollment({
    courseId: course.id,
    courseName: course.name,
    batchId,
    batchLabel,
    fullName,
    mobile: mobile.normalized,
    amount: course.price,
    currency: course.currency,
  });

  log('enrollment.created', 'enrollment', enrollment.id, `Draft enrollment for ${course.name}`, {
    enrollmentId: enrollment.enrollmentId,
    courseId: course.id,
    amount: course.price,
  });

  return json(enrollment, { status: 201 });
});

route.get('/api/enrollments/:id', ({ params }) => {
  const enrollment = enrollments.getEnrollment(params.id as string);
  if (!enrollment) throw notFound('Enrollment not found');
  const payment = payments.getPaymentForEnrollment(enrollment.id);
  return json({ enrollment, payment });
});

/**
 * Step 2: charge the instrument. On success the enrollment is confirmed, the
 * seat is consumed and the popularity counter ticks up — all only here, so a
 * failed payment leaves no trace beyond the draft and the audit log.
 */
route.post('/api/payments', async ({ req }) => {
  const body = await readJson(req);
  const errors = new FieldErrors();

  const enrollmentKey = typeof body.enrollmentId === 'string' ? body.enrollmentId : '';
  if (!enrollmentKey) errors.add('enrollmentId', 'Missing enrollment reference');
  const method = requireEnum(body.method, PAYMENT_METHODS, 'method', errors);
  errors.throwIfAny();

  const enrollment = enrollments.getEnrollment(enrollmentKey);
  if (!enrollment) throw notFound('Enrollment not found');
  if (enrollment.status === 'confirmed') {
    throw conflict('This enrollment has already been paid for');
  }

  const enabled = getConfig().enabledPaymentMethods;
  if (!enabled.includes(method)) {
    throw badRequest('That payment method is not currently accepted', {
      method: 'Unavailable payment method',
    });
  }

  const details = body as unknown as Parameters<typeof validateInstrument>[1];
  const { errors: instrumentErrors } = validateInstrument(method, details);
  instrumentErrors.throwIfAny('Please check your payment details');

  log('payment.initiated', 'payment', enrollment.id, `Payment initiated via ${method}`, {
    enrollmentId: enrollment.enrollmentId,
    method,
    amount: enrollment.amount,
  });

  const result = await gateway.charge({
    method,
    amount: enrollment.amount,
    currency: enrollment.currency,
    details,
  });

  const payment = payments.createPayment({
    enrollmentId: enrollment.id,
    method,
    amount: enrollment.amount,
    currency: enrollment.currency,
    instrument: result.instrument,
    status: result.status,
    gatewayRef: result.gatewayRef,
    failureReason: result.failureReason,
  });

  if (result.status === 'failed') {
    // The enrollment stays a draft so the student can simply retry.
    log('payment.failed', 'payment', payment.id, result.failureReason ?? 'Payment failed', {
      enrollmentId: enrollment.enrollmentId,
      reference: payment.reference,
      method,
    });
    const response: PaymentResult = {
      payment,
      enrollment,
      receipt: null,
    };
    return json(response, { status: 402 });
  }

  const confirmed = enrollments.setEnrollmentStatus(enrollment.id, 'confirmed')!;
  courses.incrementEnrollmentCount(enrollment.courseId);
  if (enrollment.batchId) courses.reserveBatchSeat(enrollment.courseId, enrollment.batchId);

  log('payment.succeeded', 'payment', payment.id, `Payment of ${enrollment.amount} succeeded`, {
    enrollmentId: confirmed.enrollmentId,
    reference: payment.reference,
    gatewayRef: payment.gatewayRef,
    method,
  });
  log('enrollment.confirmed', 'enrollment', confirmed.id, `Enrollment confirmed for ${confirmed.courseName}`, {
    enrollmentId: confirmed.enrollmentId,
  });

  const response: PaymentResult = {
    payment,
    enrollment: confirmed,
    receipt: buildReceipt(confirmed.id),
  };
  return json(response, { status: 201 });
});

route.get('/api/enrollments/:id/receipt', ({ params }) => {
  const enrollment = enrollments.getEnrollment(params.id as string);
  if (!enrollment) throw notFound('Enrollment not found');
  const receipt = buildReceipt(enrollment.id);
  if (!receipt) throw notFound('No receipt is available for this enrollment yet');
  return json(receipt);
});
