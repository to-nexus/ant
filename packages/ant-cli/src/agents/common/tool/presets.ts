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
} from './toolCatalog';
import { applyCodeCommandPolicy } from './handlers/codeCommandPolicy';
type Gate = string;

/**
 * Build a registry from the catalog matrix for a given job.
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
    const handler = TOOL_HANDLERS.get(toolName);

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
    const rejection = applyCodeCommandPolicy(
      ctx,
      args as { command: string; verifies?: Gate; working_directory?: string; keep_running?: boolean },
    );
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

/**
 * Universal job — artifact-tree agent runtime.
 *
 * The full preset is the upper bound; the custom job's `tools.builtin`
 * allowlist (job ⊆ agent ⊆ preset, validated by the loader) narrows what is
 * ADVERTISED to the LLM — the registry itself always carries the full preset
 * so approval-gated dispatch can produce a proper "not allowed" failure turn
 * instead of an unknown-tool crash. The policy SSOT the loader validates
 * against is `core/customAgents/universalToolPolicy.ts::UNIVERSAL_BUILTIN_TOOLS`;
 * a policy test reconciles it with `JOB_TOOL_MATRIX[JobType.UNIVERSAL]`.
 */
export function createUniversalToolRegistry(): ToolRegistry {
  return buildRegistryFromMatrix(JobType.UNIVERSAL);
}
