import type { SlotDef } from '@ant/shared';
import type { FileNode } from '@/infrastructure/http/api';
import type { SlotWarning, SlotFileEntry, SlotEntry, FileWarningContext } from './types';

export function resolveFileWarnings(
  filePath: string,
  fileSize: number | undefined,
  ctx: FileWarningContext,
  isTemplate?: boolean,
  templateReason?: string,
  templateContentLength?: number,
  templateThreshold?: number,
): SlotWarning[] {
  const warnings: SlotWarning[] = [];
  const fileName = filePath.split('/').pop() || '';

  if (fileName === 'figma.json') {
    if (ctx.figmaPopulated === false) {
      warnings.push({
        type: 'invalid-file',
        message: { en: 'Figma URL is not configured', ko: 'Figma URL이 설정되지 않았습니다' },
      });
    }
    if (!ctx.bridgeConnected || !ctx.figmaDesktopReachable) {
      warnings.push({
        type: 'invalid-env',
        message: { en: 'Figma Desktop connection required', ko: 'Figma Desktop 연결이 필요합니다' },
        fixLabel: { en: 'Connect', ko: '연결하기' },
        onFix: ctx.onOpenFigmaSettings,
      });
    }
  } else if (isTemplate) {
    if (templateReason === 'marker_and_short_content' && templateContentLength !== undefined && templateThreshold !== undefined) {
      warnings.push({
        type: 'invalid-file',
        message: {
          en: `Template marker present — content ${templateContentLength}/${templateThreshold} chars. Remove marker or add more content.`,
          ko: `템플릿 마커 존재 — 실질 콘텐츠 ${templateContentLength}/${templateThreshold}자. 마커를 삭제하거나 내용을 추가하세요.`,
        },
      });
    } else if (templateReason === 'file_empty') {
      warnings.push({
        type: 'invalid-file',
        message: { en: 'File is empty (0 bytes)', ko: '파일이 비어있습니다 (0 bytes)' },
      });
    } else {
      warnings.push({
        type: 'invalid-file',
        message: { en: 'File contains only placeholder content — needs real data', ko: '실제 데이터가 없는 빈 파일입니다 — 내용을 작성해주세요' },
      });
    }
  } else if (fileSize === 0) {
    warnings.push({
      type: 'invalid-file',
      message: { en: 'File is empty', ko: '파일이 비어있습니다' },
    });
  }

  return warnings;
}

export function resolveSlotEntries(
  defs: SlotDef[],
  fileTree: FileNode[],
  excludePaths?: Set<string>,
  warningCtx?: FileWarningContext,
  codebaseHasFiles?: boolean,
): SlotEntry[] {
  return defs
    .filter(def => !def.emptyHint || def.path)
    .map(def => {
      if (def.codebase) {
        const hasFiles = !!codebaseHasFiles;
        return { def, files: [], hasFiles, hasValidFiles: hasFiles };
      }
      let files: SlotFileEntry[] = [];
      if (def.type === 'file') {
        const node = findFileNode(fileTree, def.path);
        if (node) {
          const warnings = warningCtx ? resolveFileWarnings(def.path, node.size, warningCtx, node.isTemplate, node.templateReason, node.templateContentLength, node.templateThreshold) : [];
          files = [{ name: def.path.split('/').pop() || def.path, path: def.path, size: node.size, warnings }];
        }
      } else if (def.path) {
        files = listDirWithMeta(fileTree, def.path).map(f => {
          const warnings = warningCtx ? resolveFileWarnings(f.path, f.size, warningCtx, f.isTemplate, f.templateReason, f.templateContentLength, f.templateThreshold) : [];
          return { name: f.name, path: f.path, size: f.size, warnings };
        });
      }
      if (def.excludeFiles && def.excludeFiles.length > 0) {
        files = files.filter(f => !def.excludeFiles!.includes(f.name));
      }
      if (excludePaths && excludePaths.size > 0) {
        files = files.filter(f => !excludePaths.has(f.path));
      }
      const hasFiles = files.length > 0;
      const hasValidFiles = files.some(f => f.warnings.length === 0);
      return { def, files, hasFiles, hasValidFiles };
    });
}

export function findFileNode(tree: FileNode[], path: string): FileNode | null {
  const parts = path.split('/');
  let nodes = tree;
  for (let i = 0; i < parts.length; i++) {
    const node = nodes.find(n => n.name === parts[i]);
    if (!node) return null;
    if (i === parts.length - 1) return node.type === 'file' ? node : null;
    if (!node.children) return null;
    nodes = node.children;
  }
  return null;
}

export function listDir(fileTree: FileNode[], dirPath: string): { name: string; path: string; size?: number }[] {
  return listDirWithMeta(fileTree, dirPath);
}

function listDirWithMeta(fileTree: FileNode[], dirPath: string): { name: string; path: string; size?: number; isTemplate?: boolean; templateReason?: string; templateContentLength?: number; templateThreshold?: number }[] {
  const parts = dirPath.split('/');
  let nodes: FileNode[] = fileTree;
  for (const part of parts) {
    const found = nodes.find(n => n.name === part);
    if (!found || found.type !== 'directory' || !found.children) return [];
    nodes = found.children;
  }
  return nodes
    .filter(n => n.type === 'file')
    .map(n => ({ name: n.name, path: `${dirPath}/${n.name}`, size: n.size, isTemplate: n.isTemplate, templateReason: n.templateReason, templateContentLength: n.templateContentLength, templateThreshold: n.templateThreshold }));
}
