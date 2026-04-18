/**
 * Action Footer UI Policy Hook
 *
 * Centralized logic for ActionFooter button states.
 * All decisions are driven by ConfigSlots system rules + override flags.
 * See action-config-matrix.ts header for the 2-layer activation policy.
 */

import { useStore } from '@/domain/store';
import { useGitState } from '@/application/hooks/git';
import { getConfigSlots, deriveChatNeedsRefs, deriveBuildNeedsRefs, hasMixedCodebaseRefs, hasRealRefSlots } from '@ant/shared';

export interface ActionFooterPolicy {
  canStartChat: boolean;
  canBuild: boolean;
  isBuilding: boolean;
  chatDisabledReason?: string;
  buildDisabledReason?: string;
}

export function useActionFooterPolicy(): ActionFooterPolicy {
  const selectedProject = useStore(s => s.selectedProject);
  const selectedFeature = useStore(s => s.selectedFeature);
  const isRunning = useStore(s => s.isRunning);
  const actionMetadata = useStore(s => s.actionMetadata);
  const { gitStatus } = useGitState();

  const hasWorkspace = !!selectedProject && !!selectedFeature;

  if (!hasWorkspace) {
    return { canStartChat: false, canBuild: false, isBuilding: false, chatDisabledReason: 'no-workspace', buildDisabledReason: 'no-workspace' };
  }

  if (actionMetadata.explicit) {
    return { canStartChat: false, canBuild: false, isBuilding: isRunning, chatDisabledReason: 'explicit-active', buildDisabledReason: 'explicit-active' };
  }

  if (isRunning) {
    return { canStartChat: false, canBuild: false, isBuilding: true, chatDisabledReason: 'job-running', buildDisabledReason: 'job-running' };
  }

  if (!actionMetadata.intent) {
    return { canStartChat: false, canBuild: false, isBuilding: false, chatDisabledReason: 'metadata-incomplete', buildDisabledReason: 'metadata-incomplete' };
  }

  const slots = getConfigSlots(actionMetadata.intent);
  if (!slots) {
    return { canStartChat: false, canBuild: false, isBuilding: false, chatDisabledReason: 'invalid-config', buildDisabledReason: 'invalid-config' };
  }

  // System rule: revise target → both chat and build need target selected
  if (slots.target.kind === 'revise') {
    const hasTarget = actionMetadata.target && actionMetadata.target.length > 0;
    if (!hasTarget) {
      return { canStartChat: false, canBuild: false, isBuilding: false, chatDisabledReason: 'target-missing', buildDisabledReason: 'target-missing' };
    }
  }

  const hasLockedCodebaseRef = slots.refs.some(r => r.codebase && r.locked);
  const codebaseAvailable = !hasLockedCodebaseRef || !!gitStatus?.codebaseHasFiles;

  if (hasLockedCodebaseRef && !codebaseAvailable) {
    return { canStartChat: false, canBuild: false, isBuilding: false, chatDisabledReason: 'codebase-empty', buildDisabledReason: 'codebase-empty' };
  }

  // --- Selection state ---
  const hasUserSelectedRefs = !!(actionMetadata.refs && actionMetadata.refs.length > 0);
  const hasSelectedRefs = hasLockedCodebaseRef || hasUserSelectedRefs;
  const hasSelectedContext = !!(actionMetadata.context && actionMetadata.context.length > 0);

  // --- Layer 1+2: chat gate ---
  const chatNeedsRefs = deriveChatNeedsRefs(slots);
  const canStartChat = chatNeedsRefs ? hasSelectedRefs : true;

  // --- Layer 1+2: build gate ---

  // buildDisabled: directive-required intents (e.g. gen-visual-*, gen-code-directive)
  if (slots.buildDisabled) {
    return {
      canStartChat,
      canBuild: false,
      isBuilding: false,
      chatDisabledReason: canStartChat ? undefined : 'refs-not-selected',
    };
  }

  // chat-only + no selectable refs → build impossible (ask-*)
  if (slots.target.kind === 'chat-only' && !hasRealRefSlots(slots)) {
    return {
      canStartChat,
      canBuild: false,
      isBuilding: false,
      chatDisabledReason: canStartChat ? undefined : 'refs-not-selected',
    };
  }

  const buildNeedsRefs = deriveBuildNeedsRefs(slots);
  const buildRefsOk = !buildNeedsRefs
    ? true
    : hasMixedCodebaseRefs(slots) ? hasUserSelectedRefs : hasSelectedRefs;
  const contextGate = slots.buildRequiresContext ? hasSelectedContext : true;
  const canBuild = buildRefsOk && contextGate;

  const buildDisabledReason = !canBuild
    ? (slots.buildRequiresContext && !hasSelectedContext ? 'context-not-selected' : 'refs-not-selected')
    : undefined;

  return {
    canStartChat,
    canBuild,
    isBuilding: false,
    chatDisabledReason: canStartChat ? undefined : 'refs-not-selected',
    buildDisabledReason,
  };
}
