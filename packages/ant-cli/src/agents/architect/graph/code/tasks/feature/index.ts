/**
 * tasks/feature/index.ts — feature task bundle.
 *
 * Feature tasks implement the primary application work. They run in
 * parallel (via `parallelGroup`) subject to the integration barrier
 * that sequences high-priority integration tasks after all other
 * feature work.
 *
 * Hooks published:
 *   - scheduling.preIntegrationBarrier — gate integration-level features
 *   - decompose.isExclusive            — feature is non-exclusive by default
 *   - conversations.convKey            — per-task conversation scope
 */

import type { TaskHooks } from '../_shared/types';

import {
  preIntegrationBarrier,
  blocksUi,
  blocksTestgen,
  blocksDoc,
  blocksIntegration,
} from './hooks/scheduling';
import { isExclusive } from './hooks/decompose';
import { convKey } from './hooks/conversations';

export const hooks: TaskHooks = {
  scheduling: {
    preIntegrationBarrier,
    blocksUi,
    blocksTestgen,
    blocksDoc,
    blocksIntegration,
  },
  decompose: { isExclusive },
  conversations: { convKey },
};

export { isFeatureTask } from './model/is';
