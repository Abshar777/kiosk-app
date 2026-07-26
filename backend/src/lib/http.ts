import type { ApiError } from '@course-lms/shared';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': process.env.CORS_ORIGIN ?? '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
  'Access-Control-Max-Age': '86400',
};

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
      ...(init.headers ?? {}),
    },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function text(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    ...init,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS_HEADERS, ...(init.headers ?? {}) },
  });
}

/**
 * An error that carries an HTTP status and the uniform {@link ApiError} envelope.
 * Thrown anywhere in a handler; converted to a response by the top-level catch.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  toResponse(): Response {
    const body: ApiError = {
      error: { code: this.code, message: this.message, ...(this.fields ? { fields: this.fields } : {}) },
    };
    return json(body, { status: this.status });
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new HttpError(400, 'BAD_REQUEST', message, fields);

export const notFound = (message = 'Resource not found') => new HttpError(404, 'NOT_FOUND', message);

export const conflict = (message: string) => new HttpError(409, 'CONFLICT', message);

export const unauthorized = (message = 'Admin token required') =>
  new HttpError(401, 'UNAUTHORIZED', message);

/** Parse a JSON body, rejecting anything that is not a plain object. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    throw badRequest('Request body must be valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw badRequest('Request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export function csv(rows: string[][], filename: string): Response {
  const escape = (cell: string) => {
    const needsQuotes = /[",\n\r]/.test(cell);
    const escaped = cell.replace(/"/g, '""');
    return needsQuotes ? `"${escaped}"` : escaped;
  };
  // Prepend a BOM so Excel opens UTF-8 (Arabic course names) correctly.
  const body = '﻿' + rows.map((row) => row.map(escape).join(',')).join('\r\n');
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      ...CORS_HEADERS,
    },
  });
}
