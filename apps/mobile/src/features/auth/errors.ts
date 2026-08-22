import type { TFunction } from 'i18next';
import { ApiError } from '../../api/client';

/**
 * Turns any auth failure into a message a user can act on. CLAUDE.md §40, §27.
 *
 * The server's message is a developer fallback and is not localized, so it is
 * never rendered. Everything shown comes from the translation files, keyed by a
 * stable code.
 */

/** Better Auth error codes, plus our transport-level ones. */
type AuthFailureKey =
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_VERIFIED'
  | 'USER_ALREADY_EXISTS'
  | 'PASSWORD_COMPROMISED'
  | 'PASSWORD_TOO_SHORT'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'UNKNOWN';

/**
 * Maps a Better Auth response to a key.
 *
 * Deliberately collapses "no such user" and "wrong password" into one message:
 * distinguishing them tells an attacker which email addresses are registered.
 */
function classify(status: number, code: string | undefined, message: string): AuthFailureKey {
  const text = `${code ?? ''} ${message}`.toUpperCase();

  if (text.includes('COMPROMISED') || text.includes('BREACH')) return 'PASSWORD_COMPROMISED';
  if (text.includes('PASSWORD_TOO_SHORT') || text.includes('AT LEAST')) return 'PASSWORD_TOO_SHORT';
  if (text.includes('EMAIL_NOT_VERIFIED') || text.includes('NOT VERIFIED')) {
    return 'EMAIL_NOT_VERIFIED';
  }
  if (text.includes('ALREADY_EXISTS') || text.includes('EXISTING')) return 'USER_ALREADY_EXISTS';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 401 || status === 403) return 'INVALID_CREDENTIALS';
  return 'UNKNOWN';
}

export interface AuthFailure {
  key: AuthFailureKey;
  /** Ready to display. Already translated. */
  message: string;
  /** True when the account exists but has not confirmed its email. */
  needsVerification: boolean;
}

export function toAuthFailure(error: unknown, t: TFunction, fallbackStatus = 0): AuthFailure {
  if (error instanceof ApiError && (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT')) {
    return { key: 'NETWORK', message: t('auth:errors.network'), needsVerification: false };
  }

  const status =
    (error as { status?: number })?.status ??
    (error as { statusCode?: number })?.statusCode ??
    fallbackStatus;
  const code = (error as { code?: string })?.code;
  const message = (error as { message?: string })?.message ?? '';

  const key = classify(status, code, message);
  return {
    key,
    message: t(`auth:errors.${keyToTranslationSuffix(key)}`),
    needsVerification: key === 'EMAIL_NOT_VERIFIED',
  };
}

function keyToTranslationSuffix(key: AuthFailureKey): string {
  switch (key) {
    case 'INVALID_CREDENTIALS':
      return 'invalidCredentials';
    case 'EMAIL_NOT_VERIFIED':
      return 'emailNotVerified';
    case 'USER_ALREADY_EXISTS':
      return 'alreadyExists';
    case 'PASSWORD_COMPROMISED':
      return 'passwordCompromised';
    case 'PASSWORD_TOO_SHORT':
      return 'passwordTooShort';
    case 'RATE_LIMITED':
      return 'rateLimited';
    case 'NETWORK':
      return 'network';
    case 'UNKNOWN':
      return 'unknown';
  }
}
