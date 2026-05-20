/**
 * Typed errors for the project deletion cascade.
 *
 * `ProjectDeletionError` wraps a stage-specific failure so the HTTP route
 * can return a structured response body (`stage` / `hint` / `leftovers` /
 * `canForceCleanup`) instead of a generic "Internal Server Error". The FE
 * unwraps this via `ApiError.body` and renders the failed step rail with
 * a "Force Delete" CTA when applicable.
 *
 * `DeletionVerificationError` is the more specific error thrown by
 * `ProjectCrudService.deleteProject` when the post-`fs.rm` poll loop times
 * out with leftover paths still on disk. The route-side mapper converts it
 * into a `ProjectDeletionError({ stage: 'fsVerify', leftovers })`.
 *
 * Mirrors `GitOperationError`'s `toShape()` contract (`@ant/shared`) so the
 * cross-boundary error vocabulary stays consistent.
 */

import type { ProjectDeletionErrorShape, ProjectDeletionPhase } from '@ant/shared';

export interface ProjectDeletionErrorOptions {
  canForceCleanup?: boolean;
  hint?: string;
  leftovers?: string[];
  retryable?: boolean;
}

export class ProjectDeletionError extends Error {
  public readonly stage: ProjectDeletionPhase;
  public readonly cause: Error;
  public readonly canForceCleanup: boolean;
  public readonly hint?: string;
  public readonly leftovers?: string[];
  public readonly retryable: boolean;

  constructor(stage: ProjectDeletionPhase, cause: Error, opts: ProjectDeletionErrorOptions = {}) {
    super(`[${stage}] ${cause.message}`);
    // Fixes instanceof checks across realm/transpilation boundaries.
    Object.setPrototypeOf(this, ProjectDeletionError.prototype);
    this.name = 'ProjectDeletionError';
    this.stage = stage;
    this.cause = cause;
    this.canForceCleanup = opts.canForceCleanup ?? false;
    this.hint = opts.hint;
    this.leftovers = opts.leftovers;
    this.retryable = opts.retryable ?? this.canForceCleanup;
  }

  toShape(): ProjectDeletionErrorShape {
    const shape: ProjectDeletionErrorShape = {
      kind: 'projectDeletion',
      stage: this.stage,
      message: this.cause.message,
      canForceCleanup: this.canForceCleanup,
      retryable: this.retryable,
    };
    if (this.hint !== undefined) shape.hint = this.hint;
    if (this.leftovers !== undefined && this.leftovers.length > 0) shape.leftovers = this.leftovers;
    return shape;
  }
}

export class DeletionVerificationError extends Error {
  public readonly projectPath: string;
  public readonly leftovers: string[];

  constructor(projectPath: string, leftovers: string[]) {
    super(
      `Project deletion verification timed out: ${projectPath} still exists with ${leftovers.length} leftover entr${leftovers.length === 1 ? 'y' : 'ies'}`,
    );
    Object.setPrototypeOf(this, DeletionVerificationError.prototype);
    this.name = 'DeletionVerificationError';
    this.projectPath = projectPath;
    this.leftovers = leftovers;
  }
}
