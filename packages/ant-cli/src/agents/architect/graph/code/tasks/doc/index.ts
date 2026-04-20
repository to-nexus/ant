/**
 * tasks/doc/index.ts — doc task bundle.
 *
 * Doc tasks generate README / API docs after the code they describe
 * has stabilised. They run last in the execution pipeline via the doc
 * barrier.
 *
 * Hooks published:
 *   - scheduling.preDocBarrier  — block doc while feature/setup/test-code runs
 *   - conversations.convKey     — per-task conversation scope
 */

import type { TaskHooks } from '../_shared/types';

import { preDocBarrier } from './hooks/scheduling';
import { convKey } from './hooks/conversations';

export const hooks: TaskHooks = {
  scheduling: { preDocBarrier },
  conversations: { convKey },
};

export { isDocTask } from './model/is';
