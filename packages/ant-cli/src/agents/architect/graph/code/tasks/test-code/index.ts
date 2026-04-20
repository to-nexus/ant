/**
 * tasks/test-code/index.ts — test-code task bundle.
 *
 * Test-code tasks generate unit / integration tests after the feature
 * work has stabilised. They carry a testgen barrier (no test-code
 * scheduling while feature/setup work remains) and a completion guard
 * (LLM can't claim done without files actually being on disk).
 *
 * Hooks published:
 *   - scheduling.preTestgenBarrier — block test-code while feature/setup runs
 *   - conversations.convKey        — per-task conversation scope
 *   - check.evaluate               — async disk scan for real test files
 */

import type { TaskHooks } from '../_shared/types';

import { preTestgenBarrier, blocksDoc } from './hooks/scheduling';
import { convKey } from './hooks/conversations';
import { evaluate } from './hooks/check';

export const hooks: TaskHooks = {
  scheduling: { preTestgenBarrier, blocksDoc },
  conversations: { convKey },
  check: { evaluate },
};
