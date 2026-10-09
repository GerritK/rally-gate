import type { ApiErrorBody } from '@rally-gate/shared';
import { t } from '@rally-gate/ui';

/**
 * Empty in a built app: rally-server serves these files itself, so the API
 * is same-origin and a relative `/api/...` needs no host. That also removes
 * the old failure where a copied `dist/` pointed every browser at its own
 * localhost.
 *
 * In `npm run dev:web` Vite serves on 57440 while the API stays on 57430, so
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
  /** Set when the server raised the error itself, see `ApiErrorCode`. */
  code?: ApiErrorBody['code'];
  params: Record<string, unknown>;

  constructor(status: number, body: Partial<ApiErrorBody>, fallback: string) {
    // The text is fixed in the locale current when the request failed. A 5xx
    // message is Nest's "Internal server error" or a proxy's, never ours.
    super(
      body.code
        ? t(`errors.${body.code}`, body.params)
        : status >= 500
          ? t('ui.somethingWentWrong')
          : (body.message ?? fallback),
    );
    this.status = status;
    this.code = body.code;
    this.params = body.params ?? {};
  }
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  // A rejected fetch is a network failure, worded by the browser in its own
  // language ("Failed to fetch", "NetworkError when…"), never the viewer's.
  const res = await fetch(`${API_BASE}${path}`, options).catch(() => {
    throw new Error(t('errors.serverUnreachable'));
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      (body ?? {}) as Partial<ApiErrorBody>,
      `${res.status} ${res.statusText}`,
    );
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
