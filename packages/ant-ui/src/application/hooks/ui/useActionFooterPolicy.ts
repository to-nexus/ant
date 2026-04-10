/**
 * Action Footer UI Policy Hook
 *
 * Centralized logic for ActionFooter button states.
 *
 * canStartChat: workspace + intent + basis + refs (if required)
 * canBuild:     canStartChat + buildRequiresContext check
 */

import { useStore } from '@/domain/store';
import { getConfigSlots } from '@ant/shared';
import type { Basis } from '@ant/shared';
import type { FileNode } from '@/infrastructure/http/api';

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
  const fileTree = useStore(s => s.fileTree);

  const hasWorkspace = !!selectedProject && !!selectedFeature;
  const hasRequiredMetadata = !!actionMetadata.intent && !!actionMetadata.basis;

  if (!hasWorkspace) {
    return { canStartChat: false, canBuild: false, isBuilding: false, chatDisabledReason: 'no-workspace', buildDisabledReason: 'no-workspace' };
  }

  if (actionMetadata.explicit) {
    return { canStartChat: false, canBuild: false, isBuilding: isRunning, chatDisabledReason: 'explicit-active', buildDisabledReason: 'explicit-active' };
  }

  if (isRunning) {
    return { canStartChat: false, canBuild: false, isBuilding: true, chatDisabledReason: 'job-running', buildDisabledReason: 'job-running' };
  }

  if (!hasRequiredMetadata) {
    return { canStartChat: false, canBuild: false, isBuilding: false, chatDisabledReason: 'metadata-incomplete', buildDisabledReason: 'metadata-incomplete' };
  }

  const slots = getConfigSlots(actionMetadata.intent!, actionMetadata.basis! as Basis);
  if (!slots) {
    return { canStartChat: false, canBuild: false, isBuilding: false, chatDisabledReason: 'invalid-config', buildDisabledReason: 'invalid-config' };
  }

  const isDirectiveBasis = actionMetadata.basis === 'directive';
  const refsRequired = slots.refs.some(r => !r.emptyHint && r.path);

  if (refsRequired && !isDirectiveBasis) {
    const hasSelectedRefs = actionMetadata.refs && actionMetadata.refs.length > 0;
    if (!hasSelectedRefs) {
      return { canStartChat: false, canBuild: false, isBuilding: false, chatDisabledReason: 'refs-missing', buildDisabledReason: 'refs-missing' };
    }
  }

  if (slots.target.codebase) {
    const codebaseHasFiles = hasCodebaseFilesFromTree(fileTree);
    if (!codebaseHasFiles) {
      return { canStartChat: false, canBuild: false, isBuilding: false, chatDisabledReason: 'codebase-empty', buildDisabledReason: 'codebase-empty' };
    }
  }

  if (slots.target.mirrorRefs) {
    const hasTarget = actionMetadata.target && actionMetadata.target.length > 0;
    if (!hasTarget) {
      return { canStartChat: false, canBuild: false, isBuilding: false, chatDisabledReason: 'target-missing', buildDisabledReason: 'target-missing' };
    }
  }

  const canStartChat = true;

  if (isDirectiveBasis) {
    return { canStartChat, canBuild: false, isBuilding: false, buildDisabledReason: 'directive-basis' };
  }

  let canBuild = true;
  let buildDisabledReason: string | undefined;

  if (slots.buildRequiresContext) {
    const hasSelectedContext = actionMetadata.context && actionMetadata.context.length > 0;
    if (!hasSelectedContext) {
      canBuild = false;
      buildDisabledReason = 'context-missing';
    }
  }

  return { canStartChat, canBuild, isBuilding: false, buildDisabledReason };
}

function hasFilesForSlots(defs: { path: string; type: string; emptyHint?: unknown }[], fileTree: FileNode[]): boolean {
  for (const def of defs) {
    if (def.emptyHint || !def.path) continue;
    if (def.type === 'file') {
      if (fileExists(fileTree, def.path)) return true;
    } else {
      if (dirHasFiles(fileTree, def.path)) return true;
    }
  }
  return false;
}

function fileExists(tree: FileNode[], path: string): boolean {
  const parts = path.split('/');
  let nodes = tree;
  for (let i = 0; i < parts.length; i++) {
    const node = nodes.find(n => n.name === parts[i]);
    if (!node) return false;
    if (i === parts.length - 1) return node.type === 'file';
    if (!node.children) return false;
    nodes = node.children;
  }
  return false;
}

function dirHasFiles(tree: FileNode[], dirPath: string): boolean {
  const parts = dirPath.split('/');
  let nodes = tree;
  for (const part of parts) {
    const node = nodes.find(n => n.name === part);
    if (!node || node.type !== 'directory' || !node.children) return false;
    nodes = node.children;
  }
  return nodes.some(n => n.type === 'file');
}

const CANONICAL_ROOT_NAMES = new Set(['inputs', 'outputs', 'sessions', '.gitignore', '.git']);

function hasCodebaseFilesFromTree(fileTree: FileNode[]): boolean {
  return fileTree.some(n => !CANONICAL_ROOT_NAMES.has(n.name));
}
