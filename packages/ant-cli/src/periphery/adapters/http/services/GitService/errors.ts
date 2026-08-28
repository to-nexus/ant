import type {
  GitOperationErrorKind,
  GitSuggestedAction,
  GitOperationError as GitOperationErrorShape,
} from '@ant/shared';

/**
 * Typed error classes for Git operations.
 *
 * Operations throw these instead of plain Error so route handlers can derive
 * the HTTP status code + payload from the error type — no string matching.
 *
 * ## Structured classification
 *
 * Each error carries:
 * - `kind`            — discriminator aligned with {@link GitOperationErrorShape.kind}.
 * - `retryable`       — whether a mechanical retry is likely to succeed.
 * - `suggestedAction` — optional FE hint for the next recovery step.
 *
 * The {@link GitOperationError.toShape} helper serializes the canonical
 * {@link GitOperationErrorShape} that the FE consumes.
 */

export interface GitOperationErrorOptions {
  suggestedAction?: GitSuggestedAction | null;
  retryable?: boolean;
  cause?: unknown;
  retryAfterMs?: number;
  /** Interpolation values for the FE's localized copy (branch, counts). */
  params?: Readonly<Record<string, string | number>>;
}

const DEFAULT_STATUS_BY_KIND: Record<GitOperationErrorKind, number> = {
  auth: 401,
  conflict: 409,
  notFound: 404,
  config: 400,
  network: 503,
  unknown: 400,
};

const DEFAULT_RETRYABLE_BY_KIND: Record<GitOperationErrorKind, boolean> = {
  auth: false,
  conflict: false,
  notFound: false,
  config: false,
  network: true,
  unknown: true,
};

export class GitOperationError extends Error {
  public readonly kind: GitOperationErrorKind;
  public readonly statusCode: number;
  public readonly retryable: boolean;
  public readonly suggestedAction: GitSuggestedAction | null;
  public readonly retryAfterMs: number | null;
  public readonly params: Readonly<Record<string, string | number>> | null;

  constructor(
    message: string,
    kindOrStatus: GitOperationErrorKind | number = 'unknown',
    options: GitOperationErrorOptions = {}
  ) {
    super(message);
    this.name = 'GitOperationError';

    // Back-compat: legacy call sites passed (message, statusCode:number).
    if (typeof kindOrStatus === 'number') {
      this.statusCode = kindOrStatus;
      this.kind = statusCodeToKind(kindOrStatus);
    } else {
      this.kind = kindOrStatus;
      this.statusCode = DEFAULT_STATUS_BY_KIND[kindOrStatus];
    }

    this.retryable = options.retryable ?? DEFAULT_RETRYABLE_BY_KIND[this.kind];
    this.suggestedAction = options.suggestedAction ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.params = options.params ?? null;
  }

  /** Serialize to the canonical cross-boundary contract. */
  toShape(): GitOperationErrorShape {
    const shape: GitOperationErrorShape = {
      kind: this.kind,
      message: this.message,
      retryable: this.retryable,
      suggestedAction: this.suggestedAction ?? null,
    };
    if (this.retryAfterMs !== null) shape.retryAfterMs = this.retryAfterMs;
    if (this.params !== null) shape.params = this.params;
    return shape;
  }
}

export class GitAuthError extends GitOperationError {
  constructor(message: string, options: GitOperationErrorOptions = {}) {
    super(message, 'auth', {
      suggestedAction: options.suggestedAction ?? 'configurePat',
      retryable: options.retryable ?? false,
      cause: options.cause,
      retryAfterMs: options.retryAfterMs,
      params: options.params,
    });
    this.name = 'GitAuthError';
  }
}

export class GitConflictError extends GitOperationError {
  constructor(message: string, options: GitOperationErrorOptions = {}) {
    super(message, 'conflict', {
      suggestedAction: options.suggestedAction ?? 'resolveConflict',
      retryable: options.retryable ?? false,
      cause: options.cause,
      retryAfterMs: options.retryAfterMs,
      params: options.params,
    });
    this.name = 'GitConflictError';
  }
}

export class GitNotFoundError extends GitOperationError {
  constructor(message: string, options: GitOperationErrorOptions = {}) {
    super(message, 'notFound', {
      suggestedAction: options.suggestedAction ?? 'reconfigureRepo',
      retryable: options.retryable ?? false,
      cause: options.cause,
      retryAfterMs: options.retryAfterMs,
      params: options.params,
    });
    this.name = 'GitNotFoundError';
  }
}

export class GitConfigError extends GitOperationError {
  constructor(message: string, options: GitOperationErrorOptions = {}) {
    super(message, 'config', {
      suggestedAction: options.suggestedAction ?? 'reconfigureRepo',
      retryable: options.retryable ?? false,
      cause: options.cause,
      retryAfterMs: options.retryAfterMs,
      params: options.params,
    });
    this.name = 'GitConfigError';
  }
}

export class GitNetworkError extends GitOperationError {
  constructor(message: string, options: GitOperationErrorOptions = {}) {
    super(message, 'network', {
      suggestedAction: options.suggestedAction ?? null,
      retryable: options.retryable ?? true,
      cause: options.cause,
      retryAfterMs: options.retryAfterMs,
      params: options.params,
    });
    this.name = 'GitNetworkError';
  }
}

/**
 * Promote a non-fast-forward `git push` rejection to a typed conflict.
 *
 * Shared by PushOperation and InitOperation's `push -u` so the stderr match
 * exists exactly once. Returns `null` for anything else — the caller rethrows.
 */
export function asPushRejection(error: unknown): GitConflictError | null {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lower = message.toLowerCase();
  const rejected = lower.includes('[rejected]') || lower.includes('failed to push some refs');
  const nonFastForward =
    lower.includes('non-fast-forward') ||
    lower.includes('fetch first') ||
    lower.includes('behind its remote counterpart');
  if (!rejected || !nonFastForward) return null;
  return new GitConflictError(
    'Push rejected: the remote branch has commits that are not in this workspace. Sync first.',
    { retryable: false, suggestedAction: 'syncFirst', cause: error }
  );
}

function statusCodeToKind(status: number): GitOperationErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'notFound';
  if (status === 409) return 'conflict';
  if (status >= 500) return 'network';
  return 'unknown';
}
