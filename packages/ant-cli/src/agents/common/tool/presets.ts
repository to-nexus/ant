/**
 * Job-specific ToolRegistry presets
 *
 * Each factory reads from JOB_TOOL_MATRIX and TOOL_HANDLERS in toolCatalog.ts.
 * The catalog is the single source of truth — this file only applies
 * job-specific handler overrides (e.g., CodeCommandPolicy on RUN_COMMAND).
 */

import { ToolRegistry } from './registry';
import {
  ToolName,
  JobType,
  JOB_TOOL_MATRIX,
  TOOL_HANDLERS,
  SHADOW_ALIASES,
} from './toolCatalog';
import { applyCodeCommandPolicy } from './handlers/codeCommandPolicy';
import type { Gate } from '../../architect/graph/code/tasks/verification/model/gates';

/**
 * Build a registry from the catalog matrix for a given job.
 * Resolves shadow aliases to their canonical handler.
 *
 * Tools whose handlers depend on job-specific graph state (e.g.,
 * artifact-scope readers, ant-source readers) are not in TOOL_HANDLERS.
 * Their handlers are registered at runtime by the job's tool node wrapper
 * using registry.register(ToolName.XXX, handler).
 */
function buildRegistryFromMatrix(job: JobType): ToolRegistry {
  const registry = new ToolRegistry();
  const tools = JOB_TOOL_MATRIX[job];

  for (const toolName of tools) {
    const canonical = SHADOW_ALIASES.get(toolName) ?? toolName;
    const handler = TOOL_HANDLERS.get(canonical);

    if (handler) {
      registry.register(toolName, handler);
    }
  }

  return registry;
}

/** Code job — wraps RUN_COMMAND with CodeCommandPolicy. */
export function createCodeToolRegistry(): ToolRegistry {
  const registry = buildRegistryFromMatrix(JobType.CODE);

  registry.wrap(ToolName.RUN_COMMAND, (original) => async (ctx, args) => {
    const rejection = applyCodeCommandPolicy(ctx, args as { command: string; verifies?: Gate });
    if (rejection) return rejection;
    return original(ctx, args);
  });

  return registry;
}

/** Design job — base handlers only. Artifact-scope handlers added at runtime. */
export function createDesignToolRegistry(): ToolRegistry {
  return buildRegistryFromMatrix(JobType.DESIGN);
}

/** Plan job — codebase read/write + web search. */
export function createPlanToolRegistry(): ToolRegistry {
  return buildRegistryFromMatrix(JobType.PLAN);
}

/** Ask job — ant-source/workspace handlers added at runtime. */
export function createAskToolRegistry(): ToolRegistry {
  return buildRegistryFromMatrix(JobType.ASK);
}
