import type { AdminStats, PopularCourseRow, RevenueReportRow } from '@course-lms/shared';
import { db } from '../db.ts';
import { getConfig } from './settings.ts';

/**
 * All grouping uses SQLite's 'localtime' modifier so "today" means the kiosk's
 * day, not UTC's. Set TZ on the server process to control which day that is.
 */
export function getStats(): AdminStats {
  const courses = db
    .query('SELECT COUNT(*) AS total, SUM(is_active) AS active FROM courses')
    .get() as { total: number; active: number | null };

  const enrollments = db
    .query(`SELECT COUNT(*) AS total FROM enrollments WHERE status = 'confirmed'`)
    .get() as { total: number };

  const revenue = db
    .query(`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'success'`)
    .get() as { total: number };

  const today = db
    .query(
      `SELECT COUNT(*) AS total FROM enrollments
       WHERE status = 'confirmed' AND date(created_at, 'localtime') = date('now', 'localtime')`,
    )
    .get() as { total: number };

  const todayRevenue = db
    .query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM payments
       WHERE status = 'success' AND date(created_at, 'localtime') = date('now', 'localtime')`,
    )
    .get() as { total: number };

  return {
    totalCourses: courses.total,
    activeCourses: courses.active ?? 0,
    totalEnrollments: enrollments.total,
    totalRevenue: revenue.total,
    todayEnrollments: today.total,
    todayRevenue: todayRevenue.total,
    currency: getConfig().kiosk.currency,
  };
}

export type ReportPeriod = 'daily' | 'weekly' | 'monthly';

const PERIOD_EXPR: Record<ReportPeriod, string> = {
  daily: `date(created_at, 'localtime')`,
  // %Y-W%W gives an ISO-ish year-week key, e.g. 2026-W30.
  weekly: `strftime('%Y-W%W', created_at, 'localtime')`,
  monthly: `strftime('%Y-%m', created_at, 'localtime')`,
};

export function getRevenueReport(
  period: ReportPeriod,
  options: { from?: string; to?: string; limit?: number } = {},
): RevenueReportRow[] {
  const expr = PERIOD_EXPR[period];
  const where: string[] = [];
  const params: Record<string, string | number> = {};

  if (options.from) {
    params.$from = options.from;
    where.push('created_at >= $from');
  }
  if (options.to) {
    params.$to = options.to.length === 10 ? `${options.to}T23:59:59.999Z` : options.to;
    where.push('created_at <= $to');
  }
  params.$limit = Math.min(365, options.limit ?? 30);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db
    .query(
      `SELECT ${expr} AS period,
              SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS enrollments,
              COALESCE(SUM(CASE WHEN status = 'success' THEN amount ELSE 0 END), 0) AS revenue,
              COALESCE(SUM(CASE WHEN status = 'refunded' THEN refunded_amount ELSE 0 END), 0) AS refunds
       FROM payments
       ${whereSql}
       GROUP BY period
       ORDER BY period DESC
       LIMIT $limit`,
    )
    .all(params) as RevenueReportRow[];

  // Chronological order reads better on a chart than the DESC used for LIMIT.
  return rows.reverse();
}

export function getEnrollmentReport(
  period: ReportPeriod,
  options: { limit?: number } = {},
): { period: string; enrollments: number; confirmed: number; failed: number }[] {
  const expr = PERIOD_EXPR[period];
  const rows = db
    .query(
      `SELECT ${expr} AS period,
              COUNT(*) AS enrollments,
              SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM enrollments
       GROUP BY period
       ORDER BY period DESC
       LIMIT $limit`,
    )
    .all({ $limit: Math.min(365, options.limit ?? 30) }) as {
    period: string;
    enrollments: number;
    confirmed: number;
    failed: number;
  }[];
  return rows.reverse();
}

export function getPopularCourses(limit = 10): PopularCourseRow[] {
  return db
    .query(
      `SELECT e.course_id AS courseId,
              e.course_name AS courseName,
              COUNT(*) AS enrollments,
              COALESCE(SUM(CASE WHEN p.status = 'success' THEN p.amount ELSE 0 END), 0) AS revenue
       FROM enrollments e
       LEFT JOIN payments p ON p.enrollment_id = e.id
       WHERE e.status = 'confirmed'
       GROUP BY e.course_id, e.course_name
       ORDER BY enrollments DESC, revenue DESC
       LIMIT $limit`,
    )
    .all({ $limit: Math.min(50, limit) }) as PopularCourseRow[];
}

export function getPaymentMethodBreakdown(): { method: string; count: number; revenue: number }[] {
  return db
    .query(
      `SELECT method,
              COUNT(*) AS count,
              COALESCE(SUM(CASE WHEN status = 'success' THEN amount ELSE 0 END), 0) AS revenue
       FROM payments
       GROUP BY method
       ORDER BY count DESC`,
    )
    .all() as { method: string; count: number; revenue: number }[];
}
