import type { Enrollment, EnrollmentStatus } from '@course-lms/shared';
import { db } from '../db.ts';
import { newEnrollmentCode, newId, nowIso } from '../lib/ids.ts';

interface EnrollmentRow {
  id: string;
  enrollment_id: string;
  course_id: string;
  course_name: string;
  batch_id: string | null;
  batch_label: string | null;
  full_name: string;
  mobile: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  confirmed_at: string | null;
}

export function mapEnrollment(row: EnrollmentRow): Enrollment {
  return {
    id: row.id,
    enrollmentId: row.enrollment_id,
    courseId: row.course_id,
    courseName: row.course_name,
    batchId: row.batch_id,
    batchLabel: row.batch_label,
    fullName: row.full_name,
    mobile: row.mobile,
    amount: row.amount,
    currency: row.currency,
    status: row.status as EnrollmentStatus,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
  };
}

export interface CreateEnrollmentInput {
  courseId: string;
  courseName: string;
  batchId: string | null;
  batchLabel: string | null;
  fullName: string;
  mobile: string;
  amount: number;
  currency: string;
}

export function createEnrollment(input: CreateEnrollmentInput): Enrollment {
  const id = newId();
  db.query(
    `INSERT INTO enrollments (
       id, enrollment_id, course_id, course_name, batch_id, batch_label,
       full_name, mobile, amount, currency, status, created_at, confirmed_at
     ) VALUES (
       $id, $enrollmentId, $courseId, $courseName, $batchId, $batchLabel,
       $fullName, $mobile, $amount, $currency, 'draft', $createdAt, NULL
     )`,
  ).run({
    $id: id,
    $enrollmentId: newEnrollmentCode(),
    $courseId: input.courseId,
    $courseName: input.courseName,
    $batchId: input.batchId,
    $batchLabel: input.batchLabel,
    $fullName: input.fullName,
    $mobile: input.mobile,
    $amount: input.amount,
    $currency: input.currency,
    $createdAt: nowIso(),
  });
  return getEnrollment(id)!;
}

export function getEnrollment(idOrCode: string): Enrollment | null {
  const row = db
    .query('SELECT * FROM enrollments WHERE id = $key OR enrollment_id = $key LIMIT 1')
    .get({ $key: idOrCode }) as EnrollmentRow | null;
  return row ? mapEnrollment(row) : null;
}

export function setEnrollmentStatus(id: string, status: EnrollmentStatus): Enrollment | null {
  db.query(
    `UPDATE enrollments
     SET status = $status,
         confirmed_at = CASE WHEN $status = 'confirmed' THEN $now ELSE confirmed_at END
     WHERE id = $id`,
  ).run({ $id: id, $status: status, $now: nowIso() });
  return getEnrollment(id);
}

export interface EnrollmentFilter {
  q?: string;
  courseId?: string;
  status?: EnrollmentStatus;
  paymentStatus?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

interface EnrollmentWithPaymentRow extends EnrollmentRow {
  payment_status: string | null;
  payment_reference: string | null;
  payment_method: string | null;
}

export interface EnrollmentListItem extends Enrollment {
  paymentStatus: string | null;
  paymentReference: string | null;
  paymentMethod: string | null;
}

function buildEnrollmentQuery(filter: EnrollmentFilter): {
  whereSql: string;
  params: Record<string, string | number>;
} {
  const where: string[] = [];
  const params: Record<string, string | number> = {};

  if (filter.q?.trim()) {
    params.$q = `%${filter.q.trim().toLowerCase()}%`;
    where.push(`(
      LOWER(e.full_name) LIKE $q
      OR e.mobile LIKE $q
      OR LOWER(e.enrollment_id) LIKE $q
      OR LOWER(e.course_name) LIKE $q
    )`);
  }
  if (filter.courseId) {
    params.$courseId = filter.courseId;
    where.push('e.course_id = $courseId');
  }
  if (filter.status) {
    params.$status = filter.status;
    where.push('e.status = $status');
  }
  if (filter.paymentStatus) {
    params.$paymentStatus = filter.paymentStatus;
    where.push('p.status = $paymentStatus');
  }
  if (filter.from) {
    params.$from = filter.from;
    where.push('e.created_at >= $from');
  }
  if (filter.to) {
    // Callers pass a plain date; extend to end-of-day so the range is inclusive.
    params.$to = filter.to.length === 10 ? `${filter.to}T23:59:59.999Z` : filter.to;
    where.push('e.created_at <= $to');
  }

  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/**
 * Joins each enrollment to its most recent payment. The correlated subquery
 * picks one row per enrollment so a retried payment does not duplicate rows.
 */
const ENROLLMENT_WITH_PAYMENT = `
  FROM enrollments e
  LEFT JOIN payments p ON p.id = (
    SELECT id FROM payments WHERE enrollment_id = e.id ORDER BY created_at DESC LIMIT 1
  )
`;

export function listEnrollments(filter: EnrollmentFilter): {
  items: EnrollmentListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
} {
  const { whereSql, params } = buildEnrollmentQuery(filter);

  const total = (
    db
      .query(`SELECT COUNT(*) AS count ${ENROLLMENT_WITH_PAYMENT} ${whereSql}`)
      .get(params) as { count: number }
  ).count;

  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 25));

  const rows = db
    .query(
      `SELECT e.*, p.status AS payment_status, p.reference AS payment_reference, p.method AS payment_method
       ${ENROLLMENT_WITH_PAYMENT} ${whereSql}
       ORDER BY e.created_at DESC LIMIT $limit OFFSET $offset`,
    )
    .all({ ...params, $limit: pageSize, $offset: (page - 1) * pageSize }) as EnrollmentWithPaymentRow[];

  return {
    items: rows.map((row) => ({
      ...mapEnrollment(row),
      paymentStatus: row.payment_status,
      paymentReference: row.payment_reference,
      paymentMethod: row.payment_method,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Unpaginated variant used by CSV export. */
export function listEnrollmentsForExport(filter: EnrollmentFilter): EnrollmentListItem[] {
  const { whereSql, params } = buildEnrollmentQuery(filter);
  const rows = db
    .query(
      `SELECT e.*, p.status AS payment_status, p.reference AS payment_reference, p.method AS payment_method
       ${ENROLLMENT_WITH_PAYMENT} ${whereSql}
       ORDER BY e.created_at DESC LIMIT 10000`,
    )
    .all(params) as EnrollmentWithPaymentRow[];
  return rows.map((row) => ({
    ...mapEnrollment(row),
    paymentStatus: row.payment_status,
    paymentReference: row.payment_reference,
    paymentMethod: row.payment_method,
  }));
}
