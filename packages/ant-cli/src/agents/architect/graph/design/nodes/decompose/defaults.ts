/**
 * Default / fallback DesignTask factories for decompose node.
 *
 * Used when the spec is empty (`createDefaultTask`) or the job is an
 * explain-mode single task (`createExplainTask`). Near-pure — reads
 * `state.resolvedAction?.intentGroup` but no side effects or port access.
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
  const intentGroup = state.resolvedAction?.intentGroup;
  // Surface the surface-specific canonical docs so explain-ui / explain-game-art
  // can inspect the produced catalog. Game-art is the game-domain peer of UI (D28).
  const surfacePrefix = intentGroup === 'design-ui'
    ? ARTIFACT_PREFIX.UI_ANT
    : intentGroup === 'design-game-art'
      ? ARTIFACT_PREFIX.GAME_ART_ANT
      : undefined;
  return {
    id: 'explain-1',
    name: 'Explain: Design documents',
    type: 'explain',
    priority: 200,
    // No targetFile — explain mode is chat-only, no disk artifact.
    include: surfacePrefix
      ? [ARTIFACT_PREFIX.SOURCES, surfacePrefix]
      : [ARTIFACT_PREFIX.SOURCES],
    // Constant, NOT the directive — the directive reaches the explain prompt on
    // its own channel (template var + user message); copying it here would
    // double-inject it and violate the Task Description Authorship SSOT.
    description:
      "Answer the user's question about the existing design material as a chat reply. " +
      'No design document is produced.',
  };
}
