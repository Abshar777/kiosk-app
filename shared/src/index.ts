/**
 * Shared API contract between the Bun backend and the Next.js kiosk frontend.
 * Pure types + const tables — no runtime dependencies.
 */

export const COURSE_MODES = ['online', 'offline', 'hybrid'] as const;
export type CourseMode = (typeof COURSE_MODES)[number];

export const COURSE_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type CourseLevel = (typeof COURSE_LEVELS)[number];

export const PAYMENT_METHODS = ['upi', 'card', 'netbanking'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Payment gateways the kiosk can hand off to. `simulated` never touches a
 * network and exists so the flow stays demonstrable offline.
 */
export const PAYMENT_GATEWAYS = ['razorpay', 'simulated'] as const;
export type PaymentGatewayId = (typeof PAYMENT_GATEWAYS)[number];

export interface GatewayOption {
  id: PaymentGatewayId;
  name: string;
  description: string;
  /** Payment methods this gateway offers, for display only. */
  methods: PaymentMethod[];
  isAvailable: boolean;
  /** True when running against sandbox credentials — surfaced in the UI. */
  isTestMode: boolean;
}

export const PAYMENT_STATUSES = ['pending', 'success', 'failed', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ENROLLMENT_STATUSES = ['draft', 'confirmed', 'failed', 'refunded'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

/**
 * Duration buckets used by the listing filter. `maxWeeks: null` means open-ended.
 */
export const DURATION_BUCKETS = [
  { id: 'short', labelKey: 'duration.short', minWeeks: 0, maxWeeks: 4 },
  { id: 'medium', labelKey: 'duration.medium', minWeeks: 4, maxWeeks: 12 },
  { id: 'long', labelKey: 'duration.long', minWeeks: 12, maxWeeks: 24 },
  { id: 'extended', labelKey: 'duration.extended', minWeeks: 24, maxWeeks: null },
] as const;
export type DurationBucketId = (typeof DURATION_BUCKETS)[number]['id'];

export const COURSE_SORTS = [
  'popular',
  'price_asc',
  'price_desc',
  'name_asc',
  'name_desc',
  'newest',
] as const;
export type CourseSort = (typeof COURSE_SORTS)[number];

export interface Category {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  courseCount?: number;
}

export interface Instructor {
  name: string;
  title: string;
  bio: string;
  avatarUrl: string | null;
}

export interface Batch {
  id: string;
  label: string;
  /** ISO date (yyyy-mm-dd) */
  startDate: string;
  endDate: string;
  /** e.g. "Mon, Wed, Fri" */
  days: string;
  /** e.g. "18:00 - 20:00" */
  time: string;
  seatsTotal: number;
  seatsAvailable: number;
}

export interface Course {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  fullDescription: string;
  learningOutcomes: string[];
  categoryId: string;
  categoryName: string;
  mode: CourseMode;
  level: CourseLevel;
  durationWeeks: number;
  /** Human-readable duration, e.g. "8 weeks" */
  durationLabel: string;
  instructor: Instructor;
  batches: Batch[];
  hasCertificate: boolean;
  /** Minor units are avoided — price is a plain number in `currency`. */
  price: number;
  /** Original price when discounted; null when there is no discount. */
  originalPrice: number | null;
  currency: string;
  imageUrl: string;
  isActive: boolean;
  enrollmentCount: number;
  rating: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Enrollment {
  id: string;
  /** Public, human-readable id shown on the confirmation screen, e.g. ENR-2K7QF3. */
  enrollmentId: string;
  courseId: string;
  /** Snapshot so historical records survive course edits. */
  courseName: string;
  batchId: string | null;
  batchLabel: string | null;
  fullName: string;
  mobile: string;
  amount: number;
  currency: string;
  status: EnrollmentStatus;
  createdAt: string;
  confirmedAt: string | null;
}

export interface Payment {
  id: string;
  /** Public payment reference shown on the receipt, e.g. PAY-8H2LQX. */
  reference: string;
  enrollmentId: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  currency: string;
  /** Simulated gateway transaction id. */
  gatewayRef: string | null;
  /** Masked instrument detail, e.g. "•••• 4242" or "user@upi". */
  instrument: string | null;
  failureReason: string | null;
  refundedAmount: number | null;
  createdAt: string;
  completedAt: string | null;
  refundedAt: string | null;
}

/** Confirmation payload returned after a successful payment. */
export interface EnrollmentReceipt {
  enrollment: Enrollment;
  payment: Payment;
  course: Pick<Course, 'id' | 'name' | 'mode' | 'durationLabel' | 'imageUrl' | 'hasCertificate'>;
  academy: AcademyConfig;
  issuedAt: string;
}

export interface AcademyConfig {
  name: string;
  tagline: string;
  logoUrl: string | null;
  contactPhone: string;
  supportNumber: string;
  email: string;
  address: string;
  website: string;
}

export interface KioskConfig {
  /** Seconds on the confirmation screen before auto-returning to the listing. */
  autoReturnSeconds: number;
  /** Seconds of inactivity anywhere in the flow before resetting. 0 disables. */
  idleResetSeconds: number;
  /**
   * Send the receipt to the printer automatically on the confirmation screen.
   * Pair with Chrome's `--kiosk-printing` flag for silent printing; without it
   * the browser shows its print dialog.
   */
  autoPrintReceipt: boolean;
  /** Grace period before auto-printing, so the screen is painted first. */
  autoPrintDelayMs: number;
  defaultLanguage: string;
  availableLanguages: string[];
  currency: string;
  currencySymbol: string;
}

export interface AppConfig {
  academy: AcademyConfig;
  kiosk: KioskConfig;
  enabledPaymentMethods: PaymentMethod[];
}

// ---------------------------------------------------------------------------
// Request / response shapes
// ---------------------------------------------------------------------------

export interface CourseQuery {
  q?: string;
  category?: string;
  mode?: CourseMode;
  level?: CourseLevel;
  duration?: DurationBucketId;
  sort?: CourseSort;
  page?: number;
  pageSize?: number;
  /** Admin only — include disabled courses. */
  includeInactive?: boolean;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CreateEnrollmentRequest {
  courseId: string;
  fullName: string;
  mobile: string;
  batchId?: string | null;
}

export interface CreatePaymentRequest {
  enrollmentId: string;
  method: PaymentMethod;
  /** Simulated instrument details; never persisted in raw form. */
  upiId?: string;
  cardNumber?: string;
  cardHolder?: string;
  cardExpiry?: string;
  cardCvv?: string;
  bankCode?: string;
}

export interface PaymentResult {
  payment: Payment;
  enrollment: Enrollment;
  receipt: EnrollmentReceipt | null;
}

/** Everything the browser needs to open a hosted gateway checkout. */
export interface PaymentIntent {
  gateway: PaymentGatewayId;
  enrollmentId: string;
  amount: number;
  currency: string;
  /** Razorpay: the order id and the *publishable* key id. */
  orderId: string | null;
  publicKey: string | null;
  academyName: string;
  courseName: string;
  prefill: { name: string; contact: string };
  isTestMode: boolean;
}

export interface VerifyPaymentRequest {
  enrollmentId: string;
  gateway: PaymentGatewayId;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
}

export interface RecordFailureRequest {
  enrollmentId: string;
  gateway: PaymentGatewayId;
  reason?: string;
  method?: PaymentMethod;
}

export interface AdminStats {
  totalCourses: number;
  activeCourses: number;
  totalEnrollments: number;
  totalRevenue: number;
  todayEnrollments: number;
  todayRevenue: number;
  currency: string;
}

export interface RevenueReportRow {
  /** Bucket key: yyyy-mm-dd (daily), yyyy-Www (weekly), yyyy-mm (monthly). */
  period: string;
  enrollments: number;
  revenue: number;
  refunds: number;
}

export interface PopularCourseRow {
  courseId: string;
  courseName: string;
  enrollments: number;
  revenue: number;
}

export const LOG_EVENTS = [
  'enrollment.created',
  'enrollment.confirmed',
  'enrollment.failed',
  'payment.initiated',
  'payment.succeeded',
  'payment.failed',
  'payment.refunded',
  'course.created',
  'course.updated',
  'course.deleted',
  'course.status_changed',
] as const;
export type LogEvent = (typeof LOG_EVENTS)[number];

export interface ActivityLog {
  id: string;
  event: LogEvent;
  entityType: 'enrollment' | 'payment' | 'course';
  entityId: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/** Uniform error envelope returned by every failing endpoint. */
export interface ApiError {
  error: {
    code: string;
    message: string;
    /** Field-level validation messages, keyed by field name. */
    fields?: Record<string, string>;
  };
}
