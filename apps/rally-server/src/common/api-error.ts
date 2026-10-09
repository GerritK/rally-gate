import { ApiErrorBody, ApiErrorCode } from '@rally-gate/shared';

/**
 * The body for a Nest exception: `new ConflictException(apiError(...))`.
 * Nest takes `message` from it, so the exception still reads in English in
 * logs and tests.
 */
export function apiError(
  code: ApiErrorCode,
  message: string,
  params?: Record<string, unknown>,
): ApiErrorBody {
  return params ? { code, message, params } : { code, message };
}
