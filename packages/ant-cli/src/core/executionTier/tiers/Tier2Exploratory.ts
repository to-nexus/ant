import { BaseTier } from './base';
import { miniBreadcrumb } from '../strategies/breadcrumb';
import { noopBoundary } from '../strategies/boundary';
import { noopCollapse } from '../strategies/collapse';
import { thresholdLLMCompact } from '../strategies/compact';
import { ExecutionTierId } from '../types';

/**
 * Tier 2 Exploratory — single unit of work executed through the task
 * pipeline (n=1 task with `selfVerifyOnDone`). The sole task owns inline
 * install/typecheck/build/test gates before declaring `<done>`.

  static readonly instance: Tier2Exploratory = new Tier2Exploratory({
    breadcrumb: miniBreadcrumb,
    boundary: noopBoundary,
    collapse: noopCollapse,
    compact: thresholdLLMCompact,
  });

  private constructor(strategies: ConstructorParameters<typeof BaseTier>[0]) {
    super(strategies);
  }
}
