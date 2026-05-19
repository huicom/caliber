import { NextResponse } from 'next/server';
import { z, type ZodSchema } from 'zod';

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function badRequest(message: string, details?: unknown): NextResponse {
  return NextResponse.json({ error: message, details }, { status: 400 });
}

export function notFound(message = 'Not found'): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function serverError(
  message = 'Internal server error',
  err?: unknown,
): NextResponse {
  console.error('[API ERROR]', message, err);
  return NextResponse.json({ error: message }, { status: 500 });
}

export function parseQuery<T extends ZodSchema>(
  url: URL,
  schema: T,
): { ok: true; data: z.infer<T> } | { ok: false; error: string } {
  const obj: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    obj[key] = value;
  });
  const result = schema.safeParse(obj);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true, data: result.data };
}

export const paginationSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});
