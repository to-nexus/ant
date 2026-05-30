/**
 * Typed errors for phased-operation cascades (project deletion, feature
 * deletion, future phased flows).
 *
 * `PhasedOperationError<TPhase>` is the generic base that wraps a
 * stage-specific failure with structured response metadata (`stage` /
 * `hint` / `leftovers` / `canForceCleanup` / `retryable`). Domain classes
 * (`ProjectDeletionError`, `FeatureDeletionError`) supply the `kind`
 * discriminator and a typed `toShape()` that the HTTP route returns and
 * the FE unwraps via `ApiError.body`.
 *
 * `DeletionVerificationError` is the lower-level error thrown by
 * `ProjectCrudService.deleteProject` (and the analogous feature path) when
 * the post-`fs.rm` poll loop times out with leftover paths still on disk.
 * The route-side mapper converts it into a domain `*DeletionError({
 * stage: 'fsVerify', leftovers })`.
 *
 * Mirrors `GitOperationError`'s `toShape()` contract (`@ant/shared`) so the
 * cross-boundary error vocabulary stays consistent.
 */

import type {
  FeatureDeletionErrorShape,
  FeatureDeletionPhase,
  PhasedOperationErrorShape,
  ProjectDeletionErrorShape,
  ProjectDeletionPhase,
} from '@ant/shared';

export interface PhasedOperationErrorOptions {
  canForceCleanup?: boolean;
  hint?: string;
  leftovers?: string[];
  retryable?: boolean;
}

export abstract class PhasedOperationError<TPhase extends string> extends Error {
  public abstract readonly kind: string;
  public readonly stage: TPhase;
  public readonly cause: Error;
  public readonly canForceCleanup: boolean;
  public readonly hint?: string;
  public readonly leftovers?: string[];
  public readonly retryable: boolean;

  constructor(stage: TPhase, cause: Error, opts: PhasedOperationErrorOptions = {}) {
    super(`[${stage}] ${cause.message}`);
    this.stage = stage;
    this.cause = cause;
    this.canForceCleanup = opts.canForceCleanup ?? false;
    this.hint = opts.hint;
    this.leftovers = opts.leftovers;
    this.retryable = opts.retryable ?? this.canForceCleanup;
  }

  protected baseShape(): PhasedOperationErrorShape<TPhase> {
    const shape: PhasedOperationErrorShape<TPhase> = {
      stage: this.stage,
      message: this.cause.message,
      canForceCleanup: this.canForceCleanup,
      retryable: this.retryable,
    };
    if (this.hint !== undefined) shape.hint = this.hint;
    if (this.leftovers !== undefined && this.leftovers.length > 0) shape.leftovers = this.leftovers;
    return shape;
  }

  abstract toShape(): PhasedOperationErrorShape<TPhase> & { kind: string };
}

export class ProjectDeletionError extends PhasedOperationError<ProjectDeletionPhase> {
  public readonly kind = 'projectDeletion' as const;

  constructor(stage: ProjectDeletionPhase, cause: Error, opts: PhasedOperationErrorOptions = {}) {
    super(stage, cause, opts);
    Object.setPrototypeOf(this, ProjectDeletionError.prototype);
    this.name = 'ProjectDeletionError';
  }

  toShape(): ProjectDeletionErrorShape {
    return { ...this.baseShape(), kind: 'projectDeletion' };
  }
}

export class FeatureDeletionError extends PhasedOperationError<FeatureDeletionPhase> {
  public readonly kind = 'featureDeletion' as const;

  constructor(stage: FeatureDeletionPhase, cause: Error, opts: PhasedOperationErrorOptions = {}) {
    super(stage, cause, opts);
    Object.setPrototypeOf(this, FeatureDeletionError.prototype);
    this.name = 'FeatureDeletionError';
  }

  toShape(): FeatureDeletionErrorShape {
    return { ...this.baseShape(), kind: 'featureDeletion' };
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
