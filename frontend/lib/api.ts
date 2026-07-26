import type {
  ActivityLog,
  AdminStats,
  AppConfig,
  ApiError,
  Category,
  Course,
  CourseQuery,
  CreateEnrollmentRequest,
  CreatePaymentRequest,
  Enrollment,
  EnrollmentReceipt,
  GatewayOption,
  Paginated,
  Payment,
  PaymentGatewayId,
  PaymentIntent,
  PaymentMethod,
  PaymentResult,
  PopularCourseRow,
  RecordFailureRequest,
  RevenueReportRow,
  VerifyPaymentRequest,
} from "@course-lms/shared";

/**
 * Absolute API origin, or "" to talk to our own origin.
 *
 * `NEXT_PUBLIC_*` values are inlined into the bundle at BUILD time, so setting
 * one pins the API address into the compiled JS — a build could never be
 * re-pointed at another server without recompiling. That's wrong for a kiosk
 * that ships to sites with different hosts.
 *
 * So the default is empty: the browser calls same-origin `/api/...`, and
 * next.config.ts proxies to the real API using a RUNTIME env var. Set
 * NEXT_PUBLIC_API_URL only when the browser must reach the API directly on
 * another origin (which then needs CORS on the API).
 */
const CONFIGURED_API_URL = process.env.NEXT_PUBLIC_API_URL?.trim() ?? "";

/** Base for URL resolution — same-origin unless an absolute origin was given. */
function apiBase(): string {
  if (CONFIGURED_API_URL) return CONFIGURED_API_URL;
  if (typeof window !== "undefined") return window.location.origin;
  // Only reached during prerender, where nothing actually fetches.
  return "http://localhost";
}

export const API_URL = CONFIGURED_API_URL;

/**
 * Error thrown by every failed request. `fields` carries per-field validation
 * messages so a form can highlight inputs without re-parsing the response.
 */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiRequestError";
  }

  /** True when the kiosk is offline or the API is unreachable. */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Query string values; null/undefined/"" entries are dropped. */
  query?: Record<string, string | number | boolean | null | undefined>;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, headers, ...rest } = options;

  const url = new URL(path, apiBase());
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(headers ?? {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiRequestError(
      0,
      "NETWORK_ERROR",
      "Cannot reach the server. Please check the connection and try again.",
    );
  }

  if (response.status === 204) return undefined as T;

  const isJson = response.headers
    .get("content-type")
    ?.includes("application/json");

  if (!response.ok) {
    // A declined payment (402) is a normal outcome, not an exception — the
    // caller inspects the body. Everything else throws.
    if (response.status === 402 && isJson) return (await response.json()) as T;

    let payload: ApiError | null = null;
    if (isJson) payload = (await response.json().catch(() => null)) as ApiError | null;

    throw new ApiRequestError(
      response.status,
      payload?.error?.code ?? "REQUEST_FAILED",
      payload?.error?.message ?? `Request failed with status ${response.status}`,
      payload?.error?.fields ?? {},
    );
  }

  return isJson ? ((await response.json()) as T) : (undefined as T);
}

// ---------------------------------------------------------------------------
// Public kiosk API
// ---------------------------------------------------------------------------

export const api = {
  config: () => request<AppConfig & { banks: { code: string; name: string }[] }>("/api/config"),

  categories: () =>
    request<{ items: Category[] }>("/api/categories").then((r) => r.items),

  courses: (query: CourseQuery = {}) =>
    request<Paginated<Course>>("/api/courses", {
      query: {
        q: query.q,
        category: query.category,
        mode: query.mode,
        level: query.level,
        duration: query.duration,
        sort: query.sort,
        page: query.page,
        pageSize: query.pageSize,
      },
    }),

  course: (id: string) => request<Course>(`/api/courses/${encodeURIComponent(id)}`),

  createEnrollment: (payload: CreateEnrollmentRequest) =>
    request<Enrollment>("/api/enrollments", { method: "POST", body: payload }),

  enrollment: (id: string) =>
    request<{ enrollment: Enrollment; payment: Payment | null }>(
      `/api/enrollments/${encodeURIComponent(id)}`,
    ),

  pay: (payload: CreatePaymentRequest) =>
    request<PaymentResult>("/api/payments", { method: "POST", body: payload }),

  gateways: () =>
    request<{ items: GatewayOption[] }>("/api/payments/gateways").then((r) => r.items),

  /** Creates a gateway-side order and returns what the browser needs to open checkout. */
  paymentIntent: (enrollmentId: string, gateway: PaymentGatewayId) =>
    request<PaymentIntent>("/api/payments/intent", {
      method: "POST",
      body: { enrollmentId, gateway },
    }),

  /** Server re-verifies the gateway signature before confirming anything. */
  verifyPayment: (payload: VerifyPaymentRequest) =>
    request<PaymentResult>("/api/payments/verify", { method: "POST", body: payload }),

  recordPaymentFailure: (payload: RecordFailureRequest) =>
    request<unknown>("/api/payments/failure", { method: "POST", body: payload }).catch(
      // Best-effort audit trail — never block the student's retry on it.
      () => undefined,
    ),

  receipt: (enrollmentId: string) =>
    request<EnrollmentReceipt>(
      `/api/enrollments/${encodeURIComponent(enrollmentId)}/receipt`,
    ),
};

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------

const adminHeaders = (): Record<string, string> => {
  const token = process.env.NEXT_PUBLIC_ADMIN_TOKEN;
  return token ? { "X-Admin-Token": token } : {};
};

const adminRequest = <T>(path: string, options: RequestOptions = {}) =>
  request<T>(path, { ...options, headers: { ...adminHeaders(), ...(options.headers ?? {}) } });

export interface EnrollmentListItem extends Enrollment {
  paymentStatus: string | null;
  paymentReference: string | null;
  paymentMethod: string | null;
}

export interface PaymentListItem extends Payment {
  studentName: string;
  studentMobile: string;
  courseName: string;
  enrollmentCode: string;
}

export const adminApi = {
  stats: () => adminRequest<AdminStats>("/api/admin/stats"),

  courses: (query: Record<string, string | number | undefined> = {}) =>
    adminRequest<Paginated<Course>>("/api/admin/courses", { query }),

  course: (id: string) => adminRequest<Course>(`/api/admin/courses/${id}`),

  createCourse: (body: Record<string, unknown>) =>
    adminRequest<Course>("/api/admin/courses", { method: "POST", body }),

  updateCourse: (id: string, body: Record<string, unknown>) =>
    adminRequest<Course>(`/api/admin/courses/${id}`, { method: "PATCH", body }),

  setCourseActive: (id: string, isActive: boolean) =>
    adminRequest<Course>(`/api/admin/courses/${id}/status`, {
      method: "PATCH",
      body: { isActive },
    }),

  deleteCourse: (id: string) =>
    adminRequest<{ outcome: string; message: string }>(`/api/admin/courses/${id}`, {
      method: "DELETE",
    }),

  categories: () =>
    adminRequest<{ items: Category[] }>("/api/admin/categories").then((r) => r.items),

  createCategory: (name: string) =>
    adminRequest<Category>("/api/admin/categories", { method: "POST", body: { name } }),

  updateCategory: (id: string, body: { name?: string; isActive?: boolean }) =>
    adminRequest<Category>(`/api/admin/categories/${id}`, { method: "PATCH", body }),

  deleteCategory: (id: string) =>
    adminRequest<{ outcome: string }>(`/api/admin/categories/${id}`, { method: "DELETE" }),

  enrollments: (query: Record<string, string | number | undefined> = {}) =>
    adminRequest<Paginated<EnrollmentListItem>>("/api/admin/enrollments", { query }),

  /** Returns the URL for the CSV export so the browser can download directly. */
  enrollmentsExportUrl: (query: Record<string, string | number | undefined> = {}) => {
    const url = new URL("/api/admin/enrollments/export", apiBase());
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === "") continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  },

  payments: (query: Record<string, string | number | undefined> = {}) =>
    adminRequest<Paginated<PaymentListItem>>("/api/admin/payments", { query }),

  refund: (paymentId: string, amount?: number) =>
    adminRequest<Payment>(`/api/admin/payments/${paymentId}/refund`, {
      method: "POST",
      body: amount === undefined ? {} : { amount },
    }),

  revenueReport: (period: "daily" | "weekly" | "monthly", limit?: number) =>
    adminRequest<{ period: string; rows: RevenueReportRow[] }>(
      "/api/admin/reports/revenue",
      { query: { period, limit } },
    ),

  enrollmentReport: (period: "daily" | "weekly" | "monthly") =>
    adminRequest<{
      period: string;
      rows: { period: string; enrollments: number; confirmed: number; failed: number }[];
    }>("/api/admin/reports/enrollments", { query: { period } }),

  popularCourses: (limit = 10) =>
    adminRequest<{ rows: PopularCourseRow[] }>("/api/admin/reports/popular-courses", {
      query: { limit },
    }).then((r) => r.rows),

  paymentMethodBreakdown: () =>
    adminRequest<{ rows: { method: PaymentMethod; count: number; revenue: number }[] }>(
      "/api/admin/reports/payment-methods",
    ).then((r) => r.rows),

  config: () => adminRequest<AppConfig>("/api/admin/config"),

  updateConfig: (body: Partial<AppConfig>) =>
    adminRequest<AppConfig>("/api/admin/config", { method: "PATCH", body }),

  logs: (query: Record<string, string | number | undefined> = {}) =>
    adminRequest<{ items: ActivityLog[] }>("/api/admin/logs", { query }).then((r) => r.items),

  /** Uploads a course image and returns its public URL. */
  uploadImage: async (file: File): Promise<{ url: string }> => {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(new URL("/api/admin/uploads", apiBase()), {
      method: "POST",
      headers: adminHeaders(),
      body: form,
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as ApiError | null;
      throw new ApiRequestError(
        response.status,
        payload?.error?.code ?? "UPLOAD_FAILED",
        payload?.error?.message ?? "Upload failed",
        payload?.error?.fields ?? {},
      );
    }
    return (await response.json()) as { url: string };
  },
};

/** Turns a relative /uploads path from the API into an absolute URL. */
export const resolveImageUrl = (url: string): string =>
  url.startsWith("/uploads/") && API_URL ? new URL(url, API_URL).toString() : url;
