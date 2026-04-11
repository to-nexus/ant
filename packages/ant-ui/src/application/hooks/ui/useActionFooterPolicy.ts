/**
 * Action Footer UI Policy Hook
 *
 * Centralized logic for ActionFooter button states.
 * All policy decisions are driven by the ConfigSlots matrix — no mode/target special cases here.
 *
 * Policy (from matrix):
 *   - Default: refs not selected → chat only; refs selected → chat + build
 *   - chatRequiresRefs: true → refs required for BOTH chat and build
 *   - codebaseRef (locked) counts as "selected" automatically
 *   - context selection does not affect chat/build by default
 *   - buildRequiresContext: true → context must be selected for build
 */

import { useStore } from '@/domain/store';
import { getConfigSlots } from '@ant/shared';

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
  const gitStatus = useStore(s => s.gitStatus);

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

  const hasRealRefs = slots.refs.some(r => !r.emptyHint && (r.path || r.codebase));
  const hasSelectedRefs = hasLockedCodebaseRef || !!(actionMetadata.refs && actionMetadata.refs.length > 0);
  const hasSelectedContext = !!(actionMetadata.context && actionMetadata.context.length > 0);

  const canStartChat = slots.chatRequiresRefs ? hasSelectedRefs : true;
  const contextGate = slots.buildRequiresContext ? hasSelectedContext : true;
  const canBuild = hasRealRefs && hasSelectedRefs && contextGate;

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
