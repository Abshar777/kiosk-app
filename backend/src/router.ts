import { HttpError, json, preflight } from './lib/http.ts';

export interface RouteContext {
  req: Request;
  url: URL;
  params: Record<string, string>;
  query: URLSearchParams;
}

export type RouteHandler = (ctx: RouteContext) => Response | Promise<Response>;

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface Route {
  method: Method;
  /** Path split on "/", where segments starting with ":" are parameters. */
  segments: string[];
  handler: RouteHandler;
}

const routes: Route[] = [];

const split = (path: string): string[] => path.split('/').filter(Boolean);

function add(method: Method, path: string, handler: RouteHandler): void {
  routes.push({ method, segments: split(path), handler });
}

export const route = {
  get: (path: string, handler: RouteHandler) => add('GET', path, handler),
  post: (path: string, handler: RouteHandler) => add('POST', path, handler),
  patch: (path: string, handler: RouteHandler) => add('PATCH', path, handler),
  put: (path: string, handler: RouteHandler) => add('PUT', path, handler),
  delete: (path: string, handler: RouteHandler) => add('DELETE', path, handler),
};

function match(route: Route, parts: string[]): Record<string, string> | null {
  if (route.segments.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < route.segments.length; i++) {
    const segment = route.segments[i] as string;
    const part = parts[i] as string;
    if (segment.startsWith(':')) {
      params[segment.slice(1)] = decodeURIComponent(part);
    } else if (segment !== part) {
      return null;
    }
  }
  return params;
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();

  const url = new URL(req.url);
  const parts = split(url.pathname);

  let pathMatched = false;

  for (const candidate of routes) {
    const params = match(candidate, parts);
    if (!params) continue;
    pathMatched = true;
    if (candidate.method !== req.method) continue;

    try {
      return await candidate.handler({ req, url, params, query: url.searchParams });
    } catch (error) {
      if (error instanceof HttpError) return error.toResponse();
      console.error(`[api] ${req.method} ${url.pathname} failed`, error);
      return json(
        { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our end' } },
        { status: 500 },
      );
    }
  }

  // Distinguish "wrong verb" from "no such endpoint" — it makes client bugs obvious.
  return json(
    pathMatched
      ? { error: { code: 'METHOD_NOT_ALLOWED', message: `${req.method} is not allowed here` } }
      : { error: { code: 'NOT_FOUND', message: `No route for ${url.pathname}` } },
    { status: pathMatched ? 405 : 404 },
  );
}
