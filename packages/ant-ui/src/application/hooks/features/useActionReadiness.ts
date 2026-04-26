import { useMemo } from 'react';
import { useStore } from '@/domain/store';
import { useGitSnapshot } from '@/domain/git-world';
import type { FileNode } from '@/infrastructure/http/api';
import {
  type IntentGroup,
  type ActionReadiness,
  type NamingIssue,
  ACTION_DEFINITIONS,
  validateDesignFileName,
  type DesignSubdir,
} from '@ant/shared';

/**
 * Compute action readiness from fileTree + store state.
 * Reactive: re-computes when fileTree, figmaPopulated, gitStatus, or bridgeConnected change.
 *
 * Note: refs/context/target are now determined by the config matrix module
 * (getConfigSlots) based on intent. This hook only computes
 * action-level readiness (buildReady, hasOutput, subModes, namingIssues).
 */
export function useActionReadiness(): Record<IntentGroup, ActionReadiness> {
  const fileTree = useStore(s => s.fileTree);
  const figmaPopulated = useStore(s => s.figmaPopulated);
  const snapshot = useGitSnapshot();
  const bridgeConnected = useStore(s => s.bridgeConnected);
  const figmaDesktopReachable = useStore(s => s.figmaDesktopReachable);

  return useMemo(() => {
    const hasCodebase = snapshot?.hasCodebase ?? false;
    const ctx: TreeContext = { fileTree, figmaPopulated, hasCodebase, bridgeConnected, figmaDesktopReachable };

    const result = {} as Record<IntentGroup, ActionReadiness>;
    for (const def of ACTION_DEFINITIONS) {
      result[def.id] = computeReadiness(def.id, ctx);
    }
    return result;
  }, [fileTree, figmaPopulated, snapshot, bridgeConnected, figmaDesktopReachable]);
}

interface TreeContext {
  fileTree: FileNode[];
  figmaPopulated: boolean | null;
  hasCodebase: boolean;
  bridgeConnected: boolean | null;
  figmaDesktopReachable: boolean;
}

// ============================================
// Tree traversal helpers
// ============================================

function findNode(tree: FileNode[], pathParts: string[]): FileNode | undefined {
  if (pathParts.length === 0) return undefined;
  const [head, ...rest] = pathParts;
  const node = tree.find(n => n.name === head);
  if (!node) return undefined;
  if (rest.length === 0) return node;
  return findNode(node.children || [], rest);
}

function dirHasFiles(tree: FileNode[], dirPath: string): boolean {
  const node = findNode(tree, dirPath.split('/'));
  if (!node || node.type !== 'directory' || !node.children) return false;
  return node.children.some(c => c.type === 'file');
}

function dirHasFilesDeeply(tree: FileNode[], dirPath: string): boolean {
  const node = findNode(tree, dirPath.split('/'));
  if (!node) return false;
  return hasAnyFile(node);
}

function hasAnyFile(node: FileNode): boolean {
  if (node.type === 'file') return true;
  return (node.children || []).some(hasAnyFile);
}

function listFilesInDir(tree: FileNode[], dirPath: string): { name: string; path: string; size?: number }[] {
  const node = findNode(tree, dirPath.split('/'));
  if (!node || node.type !== 'directory' || !node.children) return [];
  return node.children
    .filter(c => c.type === 'file')
    .map(c => ({ name: c.name, path: `${dirPath}/${c.name}`, size: c.meta?.size }));
}

function fileExists(tree: FileNode[], filePath: string): boolean {
  const node = findNode(tree, filePath.split('/'));
  return !!node && node.type === 'file';
}

function checkNaming(tree: FileNode[], dirPath: string, subdir: DesignSubdir): NamingIssue[] {
  const files = listFilesInDir(tree, dirPath);
  const issues: NamingIssue[] = [];
  for (const f of files) {
    const result = validateDesignFileName(f.name, subdir);
    if (!result.valid) {
      issues.push({
        file: f.name,
        dir: dirPath,
        expectedPattern: result.expectedPattern || '',
        hint: result.hint || { en: '', ko: '' },
      });
    }
  }
  return issues;
}

// ============================================
// Per-action readiness computation
// ============================================

function computeReadiness(actionId: IntentGroup, ctx: TreeContext): ActionReadiness {
  switch (actionId) {
    case 'plan': return computePlan(ctx);
    case 'design-system': return computeSystemDesign(ctx);
    case 'design-ui': return computeUiDesign(ctx);
    case 'design-art': return computeGameArtDesign(ctx);
    case 'design-spec': return computeSpec(ctx);
    case 'code': return computeCode(ctx);
    case 'visual': return computeVisual(ctx);
    case 'learn-codebase': return computeLearn(ctx);
    case 'ask': return computeAsk(ctx);
    default: {
      const _exhaustive: never = actionId;
      throw new Error(`Unhandled IntentGroup: ${_exhaustive as string}`);
    }
  }
}

function computeAsk(ctx: TreeContext): ActionReadiness {
  return {
    buildReady: true,
    hasOutput: false,
    hasCodebase: ctx.hasCodebase,
    detectedMode: { id: 'unknown', label: { en: '', ko: '' } },
    outputDir: '',
    namingIssues: [],
  };
}

function computePlan(ctx: TreeContext): ActionReadiness {
  const hasOutput = fileExists(ctx.fileTree, 'inputs/sources/prd.md');
  return {
    buildReady: true,
    hasOutput,
    hasCodebase: ctx.hasCodebase,
    detectedMode: { id: 'plan', label: { en: 'PRD', ko: '기획서' } },
    outputDir: 'inputs/sources',
    namingIssues: [],
  };
}

function computeSystemDesign(ctx: TreeContext): ActionReadiness {
  const hasSources = dirHasFilesDeeply(ctx.fileTree, 'inputs/sources');
  const hasDesign = dirHasFiles(ctx.fileTree, 'outputs/design/system');
  const canRefactor = ctx.hasCodebase && hasDesign;
  return {
    buildReady: hasSources,
    buildBlockReason: hasSources ? undefined : { en: 'Source documents are required', ko: '소스 문서가 필요합니다' },
    hasOutput: hasDesign,
    hasCodebase: ctx.hasCodebase,
    detectedMode: canRefactor
      ? { id: 'refactor', label: { en: 'Refactoring design', ko: '리팩토링 설계' } }
      : { id: 'generate', label: { en: 'New system design', ko: '신규 시스템 설계' } },
    outputDir: 'outputs/design/system',
    namingIssues: checkNaming(ctx.fileTree, 'outputs/design/system', 'system'),
  };
}

function computeUiDesign(ctx: TreeContext): ActionReadiness {
  const hasRefs = dirHasFilesDeeply(ctx.fileTree, 'inputs/references');
  const figmaConfigured = ctx.figmaPopulated === true;
  const figmaReady = figmaConfigured && ctx.bridgeConnected === true && ctx.figmaDesktopReachable;
  // Design jobs emit ant-canonical outputs at `outputs/design/ui/ant/`;
  // deep-check the parent so any of the three UiSource subdirectories
  // (ant / figma / handoff) counts as "UI source present".
  const hasUi = dirHasFilesDeeply(ctx.fileTree, 'outputs/design/ui');
  const buildReady = figmaReady || hasRefs;

  return {
    buildReady,
    buildBlockReason: buildReady ? undefined : { en: 'Figma or reference images required', ko: 'Figma 또는 레퍼런스 이미지가 필요합니다' },
    hasOutput: hasUi,
    hasCodebase: ctx.hasCodebase,
    detectedMode: figmaReady
      ? { id: 'figma', label: { en: 'Figma-based', ko: 'Figma 기반' } }
      : hasRefs
        ? { id: 'references', label: { en: 'Screenshot-based', ko: '스크린샷 기반' } }
        : { id: 'description', label: { en: 'Description-based', ko: '설명 기반' } },
    subModes: [
      { id: 'figma', active: figmaReady, blockReason: !figmaConfigured ? { en: 'Set Figma URL in figma.json', ko: 'figma.json에 Figma URL을 설정하세요' } : !figmaReady ? { en: 'Figma Desktop connection required', ko: 'Figma Desktop 연결이 필요합니다' } : undefined },
      { id: 'references', active: hasRefs, blockReason: hasRefs ? undefined : { en: 'Upload screenshots to inputs/references/', ko: 'inputs/references/에 스크린샷을 업로드하세요' } },
      { id: 'description', active: true },
    ],
    outputDir: 'outputs/design/ui/ant',
    namingIssues: checkNaming(ctx.fileTree, 'outputs/design/ui/ant', 'ui'),
  };
}

/**
 * Phase 2 (D17 / D24) — game-art design readiness.
 *
 * The intent group is gated by workspace.domain === 'game' at the
 * ActionsPanel layer (TIER_DOMAIN_MATRIX.gameArtTier). Here we compute the
 * "what's missing for build?" surface the same way as ui-design but
 * targeted at the FLAT `outputs/design/game-art/` canonical (D24).
 */
function computeGameArtDesign(ctx: TreeContext): ActionReadiness {
  const hasRefs = dirHasFilesDeeply(ctx.fileTree, 'inputs/references');
  const hasGameArt = dirHasFilesDeeply(ctx.fileTree, 'outputs/design/game-art');
  const buildReady = hasRefs || hasGameArt;
  return {
    buildReady,
    buildBlockReason: buildReady
      ? undefined
      : { en: 'Reference images or a directive are required to begin game-art design', ko: '게임 아트 설계를 시작하려면 레퍼런스 이미지 또는 채팅 지시사항이 필요합니다' },
    hasOutput: hasGameArt,
    hasCodebase: ctx.hasCodebase,
    detectedMode: hasRefs
      ? { id: 'references', label: { en: 'Reference-based', ko: '레퍼런스 기반' } }
      : { id: 'description', label: { en: 'Description-based', ko: '설명 기반' } },
    subModes: [
      { id: 'figma', active: ctx.figmaPopulated === true && ctx.bridgeConnected === true && ctx.figmaDesktopReachable, blockReason: ctx.figmaPopulated !== true ? { en: 'Set Figma URL in figma.json', ko: 'figma.json에 Figma URL을 설정하세요' } : undefined },
      { id: 'references', active: hasRefs, blockReason: hasRefs ? undefined : { en: 'Upload references or use directive-based', ko: '레퍼런스 이미지를 업로드하거나 설명 기반을 사용하세요' } },
      { id: 'description', active: true },
    ],
    outputDir: 'outputs/design/game-art',
    namingIssues: checkNaming(ctx.fileTree, 'outputs/design/game-art', 'art'),
  };
}

function computeSpec(ctx: TreeContext): ActionReadiness {
  const hasSpec = dirHasFiles(ctx.fileTree, 'outputs/design/spec');
  return {
    buildReady: false,
    buildBlockReason: { en: 'Describe the spec scope via chat', ko: '채팅에서 스펙 범위를 설명하세요' },
    hasOutput: hasSpec,
    hasCodebase: ctx.hasCodebase,
    detectedMode: ctx.hasCodebase
      ? { id: 'refactor-capable', label: { en: 'Spec (refactor possible)', ko: '스펙 (리팩토링 가능)' } }
      : { id: 'generate', label: { en: 'Feature spec', ko: '기능 스펙' } },
    outputDir: 'outputs/design/spec',
    namingIssues: checkNaming(ctx.fileTree, 'outputs/design/spec', 'spec'),
  };
}

function computeCode(ctx: TreeContext): ActionReadiness {
  const hasSpec = dirHasFilesDeeply(ctx.fileTree, 'outputs/design/spec');
  const hasSystem = dirHasFilesDeeply(ctx.fileTree, 'outputs/design/system');
  const hasUi = dirHasFilesDeeply(ctx.fileTree, 'outputs/design/ui');
  const hasDesignDocs = hasSystem || hasUi;

  let modeId: string, modeLabel: { en: string; ko: string };
  if (hasSpec) {
    modeId = 'spec-based';
    modeLabel = { en: 'Spec-based code generation', ko: '스펙 기반 코드 생성' };
  } else if (hasDesignDocs) {
    modeId = 'design-doc-based';
    modeLabel = { en: 'Design doc-based code generation', ko: '설계 문서 기반 코드 생성' };
  } else {
    modeId = 'directive-based';
    modeLabel = { en: 'Directive-based code generation', ko: '디렉티브 기반 코드 생성' };
  }

  return {
    buildReady: hasSpec || hasDesignDocs,
    buildBlockReason: (hasSpec || hasDesignDocs) ? undefined : { en: 'Provide instructions via chat', ko: '채팅에서 지시사항을 입력하세요' },
    hasOutput: false,
    hasCodebase: ctx.hasCodebase,
    detectedMode: { id: modeId, label: modeLabel },
    outputDir: 'codebase',
    namingIssues: [],
  };
}

function computeVisual(ctx: TreeContext): ActionReadiness {
  return {
    buildReady: false,
    buildBlockReason: { en: 'Describe what to generate via chat', ko: '채팅에서 생성할 이미지를 설명하세요' },
    hasOutput: false,
    hasCodebase: ctx.hasCodebase,
    detectedMode: { id: 'visual', label: { en: 'Image generation', ko: '이미지 생성' } },
    outputDir: 'inputs/assets/gen',
    namingIssues: [],
  };
}

function computeLearn(ctx: TreeContext): ActionReadiness {
  return {
    buildReady: false,
    buildBlockReason: { en: 'This feature is under development', ko: '이 기능은 개발 중입니다' },
    hasOutput: false,
    hasCodebase: ctx.hasCodebase,
    detectedMode: { id: 'learn', label: { en: 'Codebase learning', ko: '코드베이스 학습' } },
    outputDir: '',
    namingIssues: [],
  };
}
