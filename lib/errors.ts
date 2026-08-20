/** Every error code in the application. Import from here — never inline a string. */
export const ErrorCode = {
  // auth
  OAUTH_STATE_MISMATCH: 'OAUTH_STATE_MISMATCH',
  OAUTH_STATE_MISSING: 'OAUTH_STATE_MISSING',
  OAUTH_DENIED: 'OAUTH_DENIED',
  OAUTH_EXCHANGE_FAILED: 'OAUTH_EXCHANGE_FAILED',
  OAUTH_INTROSPECTION_FAILED: 'OAUTH_INTROSPECTION_FAILED',
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
  SESSION_INVALID: 'SESSION_INVALID',

  // hubspot api
  RATE_LIMITED: 'RATE_LIMITED',
  HUBSPOT_ERROR: 'HUBSPOT_ERROR',

  // export
  SEARCH_CAP_EXCEEDED: 'SEARCH_CAP_EXCEEDED',
  TIMEOUT: 'TIMEOUT',
  LINK_EXPIRED: 'LINK_EXPIRED',
  NO_RECIPIENTS: 'NO_RECIPIENTS',

  // generic
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  PLAN_LIMIT_REACHED: 'PLAN_LIMIT_REACHED',
  SUBSCRIPTION_INACTIVE: 'SUBSCRIPTION_INACTIVE',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  readonly code: ErrorCodeValue;
  readonly status: number;

  constructor(code: ErrorCodeValue, message: string, status = 400) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }

  toJSON() {
    return { error: { code: this.code, message: this.message } };
  }
}
