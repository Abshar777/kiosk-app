import type { Payment, PaymentMethod, PaymentStatus } from '@course-lms/shared';
import { db } from '../db.ts';
import { newId, newPaymentReference, nowIso } from '../lib/ids.ts';

interface PaymentRow {
  id: string;
  reference: string;
  enrollment_id: string;
  method: string;
  status: string;
  amount: number;
  currency: string;
  gateway_ref: string | null;
  instrument: string | null;
  failure_reason: string | null;
  refunded_amount: number | null;
  created_at: string;
  completed_at: string | null;
  refunded_at: string | null;
}

export function mapPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    reference: row.reference,
    enrollmentId: row.enrollment_id,
    method: row.method as PaymentMethod,
    status: row.status as PaymentStatus,
    amount: row.amount,
    currency: row.currency,
    gatewayRef: row.gateway_ref,
    instrument: row.instrument,
    failureReason: row.failure_reason,
    refundedAmount: row.refunded_amount,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    refundedAt: row.refunded_at,
  };
}

export interface CreatePaymentInput {
  enrollmentId: string;
  method: PaymentMethod;
  amount: number;
  currency: string;
  instrument: string | null;
  status: PaymentStatus;
  gatewayRef: string | null;
  failureReason: string | null;
}

export function createPayment(input: CreatePaymentInput): Payment {
  const id = newId();
  const now = nowIso();
  db.query(
    `INSERT INTO payments (
       id, reference, enrollment_id, method, status, amount, currency,
       gateway_ref, instrument, failure_reason, refunded_amount,
       created_at, completed_at, refunded_at
     ) VALUES (
       $id, $reference, $enrollmentId, $method, $status, $amount, $currency,
       $gatewayRef, $instrument, $failureReason, NULL,
       $createdAt, $completedAt, NULL
     )`,
  ).run({
    $id: id,
    $reference: newPaymentReference(),
    $enrollmentId: input.enrollmentId,
    $method: input.method,
    $status: input.status,
    $amount: input.amount,
    $currency: input.currency,
    $gatewayRef: input.gatewayRef,
    $instrument: input.instrument,
    $failureReason: input.failureReason,
    $createdAt: now,
    $completedAt: input.status === 'success' ? now : null,
  });
  return getPayment(id)!;
}

export function getPayment(idOrReference: string): Payment | null {
  const row = db
    .query('SELECT * FROM payments WHERE id = $key OR reference = $key LIMIT 1')
    .get({ $key: idOrReference }) as PaymentRow | null;
  return row ? mapPayment(row) : null;
}

export function getPaymentForEnrollment(enrollmentId: string): Payment | null {
  const row = db
    .query(
      `SELECT * FROM payments WHERE enrollment_id = $id
       ORDER BY CASE status WHEN 'success' THEN 0 ELSE 1 END, created_at DESC LIMIT 1`,
    )
    .get({ $id: enrollmentId }) as PaymentRow | null;
  return row ? mapPayment(row) : null;
}

export function refundPayment(id: string, amount?: number): Payment | null {
  const payment = getPayment(id);
  if (!payment || payment.status !== 'success') return null;
  const refundAmount = amount ?? payment.amount;
  db.query(
    `UPDATE payments SET status = 'refunded', refunded_amount = $amount, refunded_at = $now WHERE id = $id`,
  ).run({ $id: payment.id, $amount: refundAmount, $now: nowIso() });
  return getPayment(payment.id);
}

export interface PaymentFilter {
  q?: string;
  status?: PaymentStatus;
  method?: PaymentMethod;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface PaymentListItem extends Payment {
  studentName: string;
  studentMobile: string;
  courseName: string;
  enrollmentCode: string;
}

export function listPayments(filter: PaymentFilter): {
  items: PaymentListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
} {
  const where: string[] = [];
  const params: Record<string, string | number> = {};

  if (filter.q?.trim()) {
    params.$q = `%${filter.q.trim().toLowerCase()}%`;
    where.push(`(
      LOWER(p.reference) LIKE $q
      OR LOWER(e.full_name) LIKE $q
      OR e.mobile LIKE $q
      OR LOWER(e.enrollment_id) LIKE $q
    )`);
  }
  if (filter.status) {
    params.$status = filter.status;
    where.push('p.status = $status');
  }
  if (filter.method) {
    params.$method = filter.method;
    where.push('p.method = $method');
  }
  if (filter.from) {
    params.$from = filter.from;
    where.push('p.created_at >= $from');
  }
  if (filter.to) {
    params.$to = filter.to.length === 10 ? `${filter.to}T23:59:59.999Z` : filter.to;
    where.push('p.created_at <= $to');
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = 'FROM payments p JOIN enrollments e ON e.id = p.enrollment_id';

  const total = (db.query(`SELECT COUNT(*) AS count ${from} ${whereSql}`).get(params) as {
    count: number;
  }).count;

  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 25));

  const rows = db
    .query(
      `SELECT p.*, e.full_name AS student_name, e.mobile AS student_mobile,
              e.course_name AS course_name, e.enrollment_id AS enrollment_code
       ${from} ${whereSql} ORDER BY p.created_at DESC LIMIT $limit OFFSET $offset`,
    )
    .all({ ...params, $limit: pageSize, $offset: (page - 1) * pageSize }) as (PaymentRow & {
    student_name: string;
    student_mobile: string;
    course_name: string;
    enrollment_code: string;
  })[];

  return {
    items: rows.map((row) => ({
      ...mapPayment(row),
      studentName: row.student_name,
      studentMobile: row.student_mobile,
      courseName: row.course_name,
      enrollmentCode: row.enrollment_code,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
