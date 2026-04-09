import { useMemo } from 'react';
import { useStore } from '@/domain/store';
import type { FileNode } from '@/infrastructure/http/api';
import {
  type ActionId,
  type ActionReadiness,
  type MaterialInfo,
  type NamingIssue,
  ACTION_DEFINITIONS,
  validateDesignFileName,
  type DesignSubdir,
} from '@ant/shared';

/**
 * Compute action readiness from fileTree + store state.
 * Reactive: re-computes when fileTree, figmaPopulated, gitStatus, or bridgeConnected change.
 */
export function useActionReadiness(): Record<ActionId, ActionReadiness> {
  const fileTree = useStore(s => s.fileTree);
  const figmaPopulated = useStore(s => s.figmaPopulated);
  const gitStatus = useStore(s => s.gitStatus);
  const bridgeConnected = useStore(s => s.bridgeConnected);
  const figmaDesktopReachable = useStore(s => s.figmaDesktopReachable);

  return useMemo(() => {
    const hasCodebase = gitStatus?.hasCodebase ?? false;
    const ctx: TreeContext = { fileTree, figmaPopulated, hasCodebase, bridgeConnected, figmaDesktopReachable };

    const result = {} as Record<ActionId, ActionReadiness>;
    for (const def of ACTION_DEFINITIONS) {
      result[def.id] = computeReadiness(def.id, ctx);
    }
    return result;
  }, [fileTree, figmaPopulated, gitStatus, bridgeConnected, figmaDesktopReachable]);
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

function listFilesInDir(tree: FileNode[], dirPath: string): { name: string; size?: number }[] {
  const node = findNode(tree, dirPath.split('/'));
  if (!node || node.type !== 'directory' || !node.children) return [];
  return node.children
    .filter(c => c.type === 'file')
    .map(c => ({ name: c.name, size: c.size }));
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

function mat(
  name: string, path: string, required: boolean, present: boolean,
  desc: { en: string; ko: string },
  formatHint?: { en: string; ko: string },
): MaterialInfo {
  return { name, path, required, present, description: desc, formatHint };
}

// ============================================
// Per-action readiness computation
// ============================================

function computeReadiness(actionId: ActionId, ctx: TreeContext): ActionReadiness {
  switch (actionId) {
    case 'plan': return computePlan(ctx);
    case 'system-design': return computeSystemDesign(ctx);
    case 'ui-design': return computeUiDesign(ctx);
    case 'spec': return computeSpec(ctx);
    case 'code': return computeCode(ctx);
    case 'visual': return computeVisual(ctx);
    case 'learn': return computeLearn(ctx);
  }
}

function computePlan(ctx: TreeContext): ActionReadiness {
  const hasSources = dirHasFilesDeeply(ctx.fileTree, 'inputs/sources');
  const hasOutput = dirHasFiles(ctx.fileTree, 'outputs/plan');
  return {
    buildReady: true,
    hasOutput,
    hasCodebase: ctx.hasCodebase,
    detectedMode: { id: 'plan', label: { en: 'Create PRD', ko: '기획서 작성' } },
    materials: [
      mat('Source Documents', 'inputs/sources', false, hasSources,
        { en: 'PRD, requirements, reference docs — multiple files accepted', ko: 'PRD, 요구사항, 참고 문서 등 여러 파일을 넣을 수 있습니다' },
        { en: '.md, .txt, .json, .yaml text files', ko: '.md, .txt, .json, .yaml 텍스트 파일' }),
    ],
    outputDir: 'outputs/plan',
    namingIssues: [],
  };
}

function computeSystemDesign(ctx: TreeContext): ActionReadiness {
  const hasSources = dirHasFilesDeeply(ctx.fileTree, 'inputs/sources');
  const hasDesign = dirHasFiles(ctx.fileTree, 'outputs/design/system');
  const hasDirective = fileExists(ctx.fileTree, 'inputs/directives/design/directive.md');
  const canRefactor = ctx.hasCodebase && hasDesign;
  return {
    buildReady: hasSources,
    buildBlockReason: hasSources ? undefined : { en: 'Source documents are required', ko: '소스 문서가 필요합니다' },
    hasOutput: hasDesign,
    hasCodebase: ctx.hasCodebase,
    detectedMode: canRefactor
      ? { id: 'refactor', label: { en: 'Refactoring design', ko: '리팩토링 설계' } }
      : { id: 'generate', label: { en: 'New system design', ko: '신규 시스템 설계' } },
    materials: [
      mat('Source Documents', 'inputs/sources', true, hasSources,
        { en: 'PRD, requirements, reference docs — multiple files accepted', ko: 'PRD, 요구사항, 참고 문서 등 여러 파일을 넣을 수 있습니다' },
        { en: '.md, .txt, .json, .yaml text files', ko: '.md, .txt, .json, .yaml 텍스트 파일' }),
      mat('Directive', 'inputs/directives/design', false, hasDirective,
        { en: 'Additional design instructions', ko: '추가 설계 지시사항' },
        { en: 'directive.md file', ko: 'directive.md 파일' }),
    ],
    outputDir: 'outputs/design/system',
    namingIssues: checkNaming(ctx.fileTree, 'outputs/design/system', 'system'),
  };
}

function computeUiDesign(ctx: TreeContext): ActionReadiness {
  const hasSources = dirHasFilesDeeply(ctx.fileTree, 'inputs/sources');
  const hasRefs = dirHasFilesDeeply(ctx.fileTree, 'inputs/references');
  const figmaConfigured = ctx.figmaPopulated === true;
  const figmaReady = figmaConfigured && ctx.bridgeConnected === true && ctx.figmaDesktopReachable;
  const hasUi = dirHasFiles(ctx.fileTree, 'outputs/design/ui');
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
    materials: [
      mat('Figma', 'inputs/figma.json', false, figmaConfigured,
        { en: 'Figma file URL configuration', ko: 'Figma 파일 URL 설정' },
        { en: 'figma.json with file URL', ko: 'Figma URL이 포함된 figma.json' }),
      mat('References', 'inputs/references', false, hasRefs,
        { en: 'UI screenshots or mockups', ko: 'UI 스크린샷 또는 목업 이미지' },
        { en: '.png, .jpg, .webp image files', ko: '.png, .jpg, .webp 이미지 파일' }),
      mat('Source Documents', 'inputs/sources', false, hasSources,
        { en: 'PRD, requirements — recommended for better results', ko: '소스 문서 — 있으면 더 정확한 결과' }),
    ],
    outputDir: 'outputs/design/ui',
    namingIssues: checkNaming(ctx.fileTree, 'outputs/design/ui', 'ui'),
  };
}

function computeSpec(ctx: TreeContext): ActionReadiness {
  const hasDesign = dirHasFilesDeeply(ctx.fileTree, 'outputs/design');
  const hasSpec = dirHasFiles(ctx.fileTree, 'outputs/design/spec');
  return {
    buildReady: false,
    buildBlockReason: { en: 'Describe the spec scope via chat', ko: '채팅에서 스펙 범위를 설명하세요' },
    hasOutput: hasSpec,
    hasCodebase: ctx.hasCodebase,
    detectedMode: ctx.hasCodebase
      ? { id: 'refactor-capable', label: { en: 'Spec (refactor possible)', ko: '스펙 (리팩토링 가능)' } }
      : { id: 'generate', label: { en: 'Feature spec', ko: '기능 스펙' } },
    materials: [
      mat('Design docs', 'outputs/design', false, hasDesign, { en: 'Used as context if available', ko: '있으면 컨텍스트로 활용됩니다' }),
    ],
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
    materials: [
      mat('Specs', 'outputs/design/spec', false, hasSpec, { en: 'Implementation specs', ko: '구현 스펙' }),
      mat('System Design', 'outputs/design/system', false, hasSystem, { en: 'Architecture and API design', ko: '아키텍처 및 API 설계' }),
      mat('UI Design', 'outputs/design/ui', false, hasUi, { en: 'UI tokens, assets, and specs', ko: 'UI 토큰, 에셋, 스펙' }),
    ],
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
    materials: [],
    outputDir: 'inputs/assets',
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
    materials: [],
    outputDir: '',
    namingIssues: [],
  };
}
