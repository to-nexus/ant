/**
 * Default / fallback DesignTask factories for decompose node.
 *
 * Used when the spec is empty (`createDefaultTask`) or the job is an
 * explain-mode single task (`createExplainTask`). Near-pure — reads
 * `state.resolvedAction?.intentGroup` + `state.directive` but no side
 * effects or port access.
 */

import type { DesignGraphState } from "../../state";
import type { DesignTask } from "../../../../types/task";
import { ARTIFACT_PREFIX } from "@ant/shared";

export function createDefaultTask(): DesignTask {
  return {
    id: 'design-doc',
    name: 'Create Design Document',
    type: 'doc',
    priority: 250,
    description: 'Create design document based on requirements',
    include: [ARTIFACT_PREFIX.SOURCES],
    completed: false,
  };
}

export function createExplainTask(state: DesignGraphState): DesignTask {
  const isUi = state.resolvedAction?.intentGroup === 'design-ui';
  return {
    id: 'explain-1',
    name: 'Explain: Design documents',
    type: 'explain',
    priority: 200,
    // No targetFile — explain mode is chat-only, no disk artifact.
    include: isUi
      ? [ARTIFACT_PREFIX.SOURCES, ARTIFACT_PREFIX.UI_ANT]
      : [ARTIFACT_PREFIX.SOURCES],
    description: state.directive || 'Analyze and explain the design documents',
  };
}
