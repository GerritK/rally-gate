/**
 * Empty in a built app: rally-server serves these files itself, so the API
 * is same-origin and a relative `/api/...` needs no host. That also removes
 * the old failure where a copied `dist/` pointed every browser at its own
 * localhost.
 *
 * In `npm run dev:web` Vite serves on 57432 while the API stays on 57430, so
 * the origin has to be spelled out. `VITE_API_URL` still overrides both.
 */
export const API_BASE: string =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.DEV ? 'http://localhost:57430/api' : '/api');

export class ApiError extends Error {
  // Declared and assigned explicitly rather than as constructor parameter
  // properties: those emit runtime code from a type-position annotation,
  // which `erasableSyntaxOnly` (on in tsconfig.app.json) rejects.
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (body as { message?: string } | null)?.message ??
      `${res.status} ${res.statusText}`;
    throw new ApiError(message, res.status, body);
  }
  return body as T;
}

function jsonRequest<T>(
  method: 'POST' | 'PUT' | 'PATCH',
  path: string,
  body: unknown,
): Promise<T> {
  return apiFetch<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function postJson<T>(path: string, body: unknown): Promise<T> {
  return jsonRequest('POST', path, body);
}

export function putJson<T>(path: string, body: unknown): Promise<T> {
  return jsonRequest('PUT', path, body);
}

export function patchJson<T>(path: string, body: unknown): Promise<T> {
  return jsonRequest('PATCH', path, body);
}

export function postRequest<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'POST' });
}

export function deleteRequest(path: string): Promise<void> {
  return apiFetch(path, { method: 'DELETE' });
}
