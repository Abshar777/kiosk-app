import type { EnrollmentReceipt } from '@course-lms/shared';
import { nowIso } from '../lib/ids.ts';
import * as courses from '../repo/courses.ts';
import * as enrollments from '../repo/enrollments.ts';
import * as payments from '../repo/payments.ts';
import { getConfig } from '../repo/settings.ts';

/**
 * Assembles the confirmation payload. Course fields are copied rather than
 * referenced so a receipt reprinted months later still shows what was bought.
 */
export function buildReceipt(enrollmentId: string): EnrollmentReceipt | null {
  const enrollment = enrollments.getEnrollment(enrollmentId);
  if (!enrollment) return null;

  const payment = payments.getPaymentForEnrollment(enrollment.id);
  if (!payment) return null;

  const course = courses.getCourse(enrollment.courseId, true);
  if (!course) return null;

  return {
    enrollment,
    payment,
    course: {
      id: course.id,
      name: course.name,
      mode: course.mode,
      durationLabel: course.durationLabel,
      imageUrl: course.imageUrl,
      hasCertificate: course.hasCertificate,
    },
    academy: getConfig().academy,
    issuedAt: nowIso(),
  };
}
