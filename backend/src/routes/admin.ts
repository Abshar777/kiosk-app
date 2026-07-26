import type {
  Batch,
  CourseLevel,
  CourseMode,
  EnrollmentStatus,
  Instructor,
  PaymentMethod,
  PaymentStatus,
} from '@course-lms/shared';
import { COURSE_LEVELS, COURSE_MODES } from '@course-lms/shared';
import { badRequest, csv, json, notFound, readJson, unauthorized } from '../lib/http.ts';
import { newId } from '../lib/ids.ts';
import { FieldErrors, optionalNumber, requireEnum, requireString } from '../lib/validation.ts';
import * as courses from '../repo/courses.ts';
import * as enrollments from '../repo/enrollments.ts';
import { listLogs, log } from '../repo/logs.ts';
import * as payments from '../repo/payments.ts';
import * as reports from '../repo/reports.ts';
import { getConfig, updateConfig } from '../repo/settings.ts';
import { route, type RouteContext } from '../router.ts';

/**
 * Optional shared-secret guard. When ADMIN_TOKEN is unset the admin API is
 * open, which is what you want on a workshop LAN; set it in production.
 */
function requireAdmin({ req }: RouteContext): void {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return;
  const provided = req.headers.get('X-Admin-Token');
  if (provided !== expected) throw unauthorized();
}

const admin =
  (handler: (ctx: RouteContext) => Response | Promise<Response>) => (ctx: RouteContext) => {
    requireAdmin(ctx);
    return handler(ctx);
  };

// ---------------------------------------------------------------------------
// Dashboard & reports
// ---------------------------------------------------------------------------

route.get('/api/admin/stats', admin(() => json(reports.getStats())));

route.get(
  '/api/admin/reports/revenue',
  admin(({ query }) => {
    const period = (query.get('period') ?? 'daily') as reports.ReportPeriod;
    if (!['daily', 'weekly', 'monthly'].includes(period)) {
      throw badRequest('period must be daily, weekly or monthly');
    }
    return json({
      period,
      rows: reports.getRevenueReport(period, {
        from: query.get('from') ?? undefined,
        to: query.get('to') ?? undefined,
        limit: Number(query.get('limit')) || undefined,
      }),
    });
  }),
);

route.get(
  '/api/admin/reports/enrollments',
  admin(({ query }) => {
    const period = (query.get('period') ?? 'daily') as reports.ReportPeriod;
    if (!['daily', 'weekly', 'monthly'].includes(period)) {
      throw badRequest('period must be daily, weekly or monthly');
    }
    return json({ period, rows: reports.getEnrollmentReport(period) });
  }),
);

route.get(
  '/api/admin/reports/popular-courses',
  admin(({ query }) => json({ rows: reports.getPopularCourses(Number(query.get('limit')) || 10) })),
);

route.get(
  '/api/admin/reports/payment-methods',
  admin(() => json({ rows: reports.getPaymentMethodBreakdown() })),
);

// ---------------------------------------------------------------------------
// Course management
// ---------------------------------------------------------------------------

route.get(
  '/api/admin/courses',
  admin(({ query }) =>
    json(
      courses.listCourses({
        q: query.get('q') ?? undefined,
        category: query.get('category') ?? undefined,
        includeInactive: true,
        page: Number(query.get('page')) || 1,
        pageSize: Number(query.get('pageSize')) || 50,
        sort: 'newest',
      }),
    ),
  ),
);

route.get(
  '/api/admin/courses/:id',
  admin(({ params }) => {
    const course = courses.getCourse(params.id as string, true);
    if (!course) throw notFound('Course not found');
    return json(course);
  }),
);

function parseInstructor(value: unknown): Instructor {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    name: typeof raw.name === 'string' ? raw.name : '',
    title: typeof raw.title === 'string' ? raw.title : '',
    bio: typeof raw.bio === 'string' ? raw.bio : '',
    avatarUrl: typeof raw.avatarUrl === 'string' ? raw.avatarUrl : null,
  };
}

/** Batches arrive without ids when newly added in the admin form. */
function parseBatches(value: unknown): Batch[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const raw = (entry ?? {}) as Record<string, unknown>;
    const seatsTotal = Number(raw.seatsTotal) || 0;
    const seatsAvailable =
      raw.seatsAvailable === undefined ? seatsTotal : Number(raw.seatsAvailable) || 0;
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
      label: typeof raw.label === 'string' ? raw.label : 'Batch',
      startDate: typeof raw.startDate === 'string' ? raw.startDate : '',
      endDate: typeof raw.endDate === 'string' ? raw.endDate : '',
      days: typeof raw.days === 'string' ? raw.days : '',
      time: typeof raw.time === 'string' ? raw.time : '',
      seatsTotal,
      seatsAvailable: Math.min(seatsAvailable, seatsTotal),
    };
  });
}

const parseOutcomes = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];

route.post(
  '/api/admin/courses',
  admin(async ({ req }) => {
    const body = await readJson(req);
    const errors = new FieldErrors();

    const name = requireString(body.name, 'name', errors, { min: 3, max: 120 });
    const shortDescription = requireString(body.shortDescription, 'shortDescription', errors, {
      min: 10,
      max: 300,
    });
    const fullDescription = requireString(body.fullDescription, 'fullDescription', errors, {
      min: 20,
      max: 5000,
    });
    const categoryId = requireString(body.categoryId, 'categoryId', errors);
    const mode = requireEnum<CourseMode>(body.mode, COURSE_MODES, 'mode', errors);
    const level = requireEnum<CourseLevel>(body.level, COURSE_LEVELS, 'level', errors);
    const durationWeeks = optionalNumber(body.durationWeeks, 'durationWeeks', errors, {
      min: 1,
      max: 260,
    });
    if (durationWeeks === undefined) errors.add('durationWeeks', 'Duration is required');
    const price = optionalNumber(body.price, 'price', errors, { min: 0, max: 10_000_000 });
    if (price === undefined) errors.add('price', 'Price is required');
    errors.throwIfAny();

    if (!courses.getCategory(categoryId)) {
      throw badRequest('Unknown category', { categoryId: 'Select a valid category' });
    }

    const course = courses.createCourse({
      name,
      shortDescription,
      fullDescription,
      learningOutcomes: parseOutcomes(body.learningOutcomes),
      categoryId,
      mode,
      level,
      durationWeeks: durationWeeks as number,
      durationLabel: typeof body.durationLabel === 'string' ? body.durationLabel : undefined,
      instructor: parseInstructor(body.instructor),
      batches: parseBatches(body.batches),
      hasCertificate: body.hasCertificate !== false,
      price: price as number,
      originalPrice: optionalNumber(body.originalPrice, 'originalPrice', errors) ?? null,
      currency: typeof body.currency === 'string' ? body.currency : getConfig().kiosk.currency,
      imageUrl: typeof body.imageUrl === 'string' ? body.imageUrl : '',
      isActive: body.isActive !== false,
      rating: optionalNumber(body.rating, 'rating', errors, { min: 0, max: 5 }) ?? null,
    });

    log('course.created', 'course', course.id, `Course created: ${course.name}`);
    return json(course, { status: 201 });
  }),
);

route.patch(
  '/api/admin/courses/:id',
  admin(async ({ req, params }) => {
    const body = await readJson(req);
    const errors = new FieldErrors();
    const patch: Parameters<typeof courses.updateCourse>[1] = {};

    if (body.name !== undefined) patch.name = requireString(body.name, 'name', errors, { min: 3, max: 120 });
    if (body.shortDescription !== undefined)
      patch.shortDescription = requireString(body.shortDescription, 'shortDescription', errors, {
        min: 10,
        max: 300,
      });
    if (body.fullDescription !== undefined)
      patch.fullDescription = requireString(body.fullDescription, 'fullDescription', errors, {
        min: 20,
        max: 5000,
      });
    if (body.categoryId !== undefined) patch.categoryId = requireString(body.categoryId, 'categoryId', errors);
    if (body.mode !== undefined) patch.mode = requireEnum<CourseMode>(body.mode, COURSE_MODES, 'mode', errors);
    if (body.level !== undefined) patch.level = requireEnum<CourseLevel>(body.level, COURSE_LEVELS, 'level', errors);
    if (body.durationWeeks !== undefined)
      patch.durationWeeks = optionalNumber(body.durationWeeks, 'durationWeeks', errors, { min: 1, max: 260 });
    if (body.durationLabel !== undefined && typeof body.durationLabel === 'string')
      patch.durationLabel = body.durationLabel;
    if (body.price !== undefined)
      patch.price = optionalNumber(body.price, 'price', errors, { min: 0, max: 10_000_000 });
    if (body.originalPrice !== undefined)
      patch.originalPrice = optionalNumber(body.originalPrice, 'originalPrice', errors) ?? null;
    if (body.currency !== undefined && typeof body.currency === 'string') patch.currency = body.currency;
    if (body.imageUrl !== undefined && typeof body.imageUrl === 'string') patch.imageUrl = body.imageUrl;
    if (body.hasCertificate !== undefined) patch.hasCertificate = body.hasCertificate !== false;
    if (body.isActive !== undefined) patch.isActive = body.isActive !== false;
    if (body.rating !== undefined)
      patch.rating = optionalNumber(body.rating, 'rating', errors, { min: 0, max: 5 }) ?? null;
    if (body.learningOutcomes !== undefined) patch.learningOutcomes = parseOutcomes(body.learningOutcomes);
    if (body.instructor !== undefined) patch.instructor = parseInstructor(body.instructor);
    if (body.batches !== undefined) patch.batches = parseBatches(body.batches);

    errors.throwIfAny();

    if (patch.categoryId && !courses.getCategory(patch.categoryId)) {
      throw badRequest('Unknown category', { categoryId: 'Select a valid category' });
    }

    const updated = courses.updateCourse(params.id as string, patch);
    if (!updated) throw notFound('Course not found');

    log('course.updated', 'course', updated.id, `Course updated: ${updated.name}`, {
      fields: Object.keys(patch),
    });
    return json(updated);
  }),
);

route.patch(
  '/api/admin/courses/:id/status',
  admin(async ({ req, params }) => {
    const body = await readJson(req);
    if (typeof body.isActive !== 'boolean') {
      throw badRequest('isActive must be a boolean', { isActive: 'Required' });
    }
    const updated = courses.setCourseActive(params.id as string, body.isActive);
    if (!updated) throw notFound('Course not found');

    log('course.status_changed', 'course', updated.id, `Course ${body.isActive ? 'enabled' : 'disabled'}`, {
      isActive: body.isActive,
    });
    return json(updated);
  }),
);

route.delete(
  '/api/admin/courses/:id',
  admin(({ params }) => {
    const course = courses.getCourse(params.id as string, true);
    const outcome = courses.deleteCourse(params.id as string);
    if (outcome === 'missing') throw notFound('Course not found');

    log('course.deleted', 'course', params.id as string, `Course ${outcome}: ${course?.name ?? ''}`, {
      outcome,
    });
    return json({
      outcome,
      message:
        outcome === 'disabled'
          ? 'This course has enrollment history, so it was disabled instead of deleted.'
          : 'Course deleted.',
    });
  }),
);

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

route.get('/api/admin/categories', admin(() => json({ items: courses.listCategories(true) })));

route.post(
  '/api/admin/categories',
  admin(async ({ req }) => {
    const body = await readJson(req);
    const errors = new FieldErrors();
    const name = requireString(body.name, 'name', errors, { min: 2, max: 60 });
    errors.throwIfAny();
    return json(courses.createCategory(name), { status: 201 });
  }),
);

route.patch(
  '/api/admin/categories/:id',
  admin(async ({ req, params }) => {
    const body = await readJson(req);
    const updated = courses.updateCategory(params.id as string, {
      name: typeof body.name === 'string' ? body.name : undefined,
      isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
    });
    if (!updated) throw notFound('Category not found');
    return json(updated);
  }),
);

route.delete(
  '/api/admin/categories/:id',
  admin(({ params }) => {
    const outcome = courses.deleteCategory(params.id as string);
    if (outcome === 'missing') throw notFound('Category not found');
    if (outcome === 'in_use') {
      throw badRequest('This category still has courses. Move or delete them first.');
    }
    return json({ outcome });
  }),
);

// ---------------------------------------------------------------------------
// Enrollments
// ---------------------------------------------------------------------------

function enrollmentFilterFrom(query: URLSearchParams): enrollments.EnrollmentFilter {
  return {
    q: query.get('q') ?? undefined,
    courseId: query.get('courseId') ?? undefined,
    status: (query.get('status') as EnrollmentStatus | null) ?? undefined,
    paymentStatus: query.get('paymentStatus') ?? undefined,
    from: query.get('from') ?? undefined,
    to: query.get('to') ?? undefined,
    page: Number(query.get('page')) || 1,
    pageSize: Number(query.get('pageSize')) || 25,
  };
}

route.get(
  '/api/admin/enrollments',
  admin(({ query }) => json(enrollments.listEnrollments(enrollmentFilterFrom(query)))),
);

route.get(
  '/api/admin/enrollments/export',
  admin(({ query }) => {
    const rows = enrollments.listEnrollmentsForExport(enrollmentFilterFrom(query));
    const header = [
      'Enrollment ID',
      'Date',
      'Student Name',
      'Mobile',
      'Course',
      'Batch',
      'Amount',
      'Currency',
      'Enrollment Status',
      'Payment Status',
      'Payment Method',
      'Payment Reference',
    ];
    const body = rows.map((row) => [
      row.enrollmentId,
      row.createdAt,
      row.fullName,
      row.mobile,
      row.courseName,
      row.batchLabel ?? '',
      String(row.amount),
      row.currency,
      row.status,
      row.paymentStatus ?? '',
      row.paymentMethod ?? '',
      row.paymentReference ?? '',
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    return csv([header, ...body], `enrollments-${stamp}.csv`);
  }),
);

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

route.get(
  '/api/admin/payments',
  admin(({ query }) =>
    json(
      payments.listPayments({
        q: query.get('q') ?? undefined,
        status: (query.get('status') as PaymentStatus | null) ?? undefined,
        method: (query.get('method') as PaymentMethod | null) ?? undefined,
        from: query.get('from') ?? undefined,
        to: query.get('to') ?? undefined,
        page: Number(query.get('page')) || 1,
        pageSize: Number(query.get('pageSize')) || 25,
      }),
    ),
  ),
);

route.post(
  '/api/admin/payments/:id/refund',
  admin(async ({ req, params }) => {
    const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
    const existing = payments.getPayment(params.id as string);
    if (!existing) throw notFound('Payment not found');
    if (existing.status !== 'success') {
      throw badRequest('Only successful payments can be refunded');
    }

    const amount =
      body.amount === undefined ? undefined : Number(body.amount) || undefined;
    if (amount !== undefined && (amount <= 0 || amount > existing.amount)) {
      throw badRequest('Refund amount must be between 0 and the original amount', {
        amount: 'Invalid refund amount',
      });
    }

    const refunded = payments.refundPayment(existing.id, amount);
    if (!refunded) throw badRequest('Refund could not be processed');

    enrollments.setEnrollmentStatus(existing.enrollmentId, 'refunded');
    log('payment.refunded', 'payment', refunded.id, `Refunded ${refunded.refundedAmount}`, {
      reference: refunded.reference,
    });
    return json(refunded);
  }),
);

// ---------------------------------------------------------------------------
// Config & logs
// ---------------------------------------------------------------------------

route.get('/api/admin/config', admin(() => json(getConfig())));

route.patch(
  '/api/admin/config',
  admin(async ({ req }) => {
    const body = await readJson(req);
    return json(
      updateConfig({
        academy: body.academy as never,
        kiosk: body.kiosk as never,
        enabledPaymentMethods: body.enabledPaymentMethods as never,
      }),
    );
  }),
);

route.get(
  '/api/admin/logs',
  admin(({ query }) =>
    json({
      items: listLogs({
        entityType: query.get('entityType') ?? undefined,
        entityId: query.get('entityId') ?? undefined,
        limit: Number(query.get('limit')) || 100,
      }),
    }),
  ),
);
