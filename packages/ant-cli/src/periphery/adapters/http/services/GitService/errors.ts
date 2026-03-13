/**
 * Typed error classes for Git operations.
 *
 * Operations throw these instead of plain Error so route handlers can
 * derive the HTTP status code from the error type — no string matching.
 */

export class GitOperationError extends Error {
  constructor(message: string, public readonly statusCode: number = 400) {
    super(message);
    this.name = 'GitOperationError';
  }
}

export class GitAuthError extends GitOperationError {
  constructor(message: string) {
    super(message, 401);
    this.name = 'GitAuthError';
  }
}

export class GitConflictError extends GitOperationError {
  constructor(message: string) {
    super(message, 409);
    this.name = 'GitConflictError';
  }
}

export class GitNotFoundError extends GitOperationError {
  constructor(message: string) {
    super(message, 404);
    this.name = 'GitNotFoundError';
  }
}
