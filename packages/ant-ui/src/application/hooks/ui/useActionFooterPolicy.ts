/**
 * Action Footer UI Policy Hook
 *
 * Centralized logic for ActionFooter button states.
 *
 * Universal rule:
 *   - refs not selected → chat only
 *   - refs selected → chat + build both available
 *   - context selection does not affect chat/build
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

  if (slots.target.codebase && !gitStatus?.codebaseHasFiles) {
    return { canStartChat: false, canBuild: false, isBuilding: false, chatDisabledReason: 'codebase-empty', buildDisabledReason: 'codebase-empty' };
  }

  if (slots.target.mirrorRefs) {
    const hasTarget = actionMetadata.target && actionMetadata.target.length > 0;
    if (!hasTarget) {
      return { canStartChat: false, canBuild: false, isBuilding: false, chatDisabledReason: 'target-missing', buildDisabledReason: 'target-missing' };
    }
  }

  const canStartChat = true;

  const hasRealRefs = slots.refs.some(r => !r.emptyHint && r.path);
  const hasSelectedRefs = !!(actionMetadata.refs && actionMetadata.refs.length > 0);
  const canBuild = hasRealRefs && hasSelectedRefs;

  return { canStartChat, canBuild, isBuilding: false, buildDisabledReason: canBuild ? undefined : 'refs-not-selected' };
}
