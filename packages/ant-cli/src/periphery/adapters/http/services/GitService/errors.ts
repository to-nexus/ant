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
  }

  /** Serialize to the canonical cross-boundary contract. */
  toShape(): GitOperationErrorShape {
    return {
      kind: this.kind,
      message: this.message,
      retryable: this.retryable,
      suggestedAction: this.suggestedAction ?? null,
    };
  }
}

export class GitAuthError extends GitOperationError {
  constructor(message: string, options: GitOperationErrorOptions = {}) {
    super(message, 'auth', {
      suggestedAction: options.suggestedAction ?? 'configurePat',
      retryable: options.retryable ?? false,
      cause: options.cause,
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
    });
    this.name = 'GitNetworkError';
  }
}

function statusCodeToKind(status: number): GitOperationErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'notFound';
  if (status === 409) return 'conflict';
  if (status >= 500) return 'network';
  return 'unknown';
}
