import { getDirDescription } from '@ant/shared';
import type { SlotDef } from '@ant/shared';
import type { FileNode } from '@/infrastructure/http/api';
import { compressSelection, type SelectedEntry } from '@/shared/utils/selectionDisplay';
import type { SlotWarning, SlotFileEntry, SlotEntry, SlotSubgroup, FileWarningContext, SlotSectionView } from './types';

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
      if (def.type === 'ui-source' && def.uiSources) {
        const subgroups: SlotSubgroup[] = def.uiSources.map(sub => {
          let files = listDirWithMeta(fileTree, sub.dir).map(f => {
            const warnings = warningCtx ? resolveFileWarnings(f.path, f.meta?.size, warningCtx, f.meta?.isTemplate, f.meta?.templateReason ?? undefined, f.meta?.templateContentLength, f.meta?.templateThreshold) : [];
            return { name: f.name, path: f.path, meta: f.meta, warnings };
          });
          if (excludePaths && excludePaths.size > 0) {
            files = files.filter(f => !excludePaths.has(f.path));
          }
          // Subgroup-level completeness check: ant requires its full canonical
          // trio (ui-tokens/assets/spec.json) — a partial bundle is invalid.
          // handoff has no required-file list (free-form); figma is file-level
          // and handles its own warnings per file.
          const subgroupWarnings = resolveSubgroupWarnings(sub.id, sub.dir, files);
          const filesValid = files.every(f => f.warnings.length === 0);
          const hasFiles = files.length > 0;
          return {
            id: sub.id,
            dir: sub.dir,
            label: sub.label,
            humanLabel: sub.humanLabel,
            files,
            hasFiles,
            // hasValidFiles must reflect BOTH per-file validity and bundle
            // completeness — useActionReadiness gates off it.
            hasValidFiles: hasFiles && filesValid && subgroupWarnings.length === 0,
            warnings: subgroupWarnings.length > 0 ? subgroupWarnings : undefined,
          };
        });
        const allFiles = subgroups.flatMap(s => s.files);
        return {
          def,
          files: allFiles,
          hasFiles: allFiles.length > 0,
          hasValidFiles: subgroups.some(s => s.hasValidFiles),
          subgroups,
        };
      }
      let files: SlotFileEntry[] = [];
      if (def.type === 'file') {
        const node = findFileNode(fileTree, def.path);
        if (node) {
          const warnings = warningCtx ? resolveFileWarnings(def.path, node.meta?.size, warningCtx, node.meta?.isTemplate, node.meta?.templateReason ?? undefined, node.meta?.templateContentLength, node.meta?.templateThreshold) : [];
          files = [{ name: def.path.split('/').pop() || def.path, path: def.path, meta: node.meta, warnings }];
        }
      } else if (def.path) {
        files = listDirWithMeta(fileTree, def.path).map(f => {
          const warnings = warningCtx ? resolveFileWarnings(f.path, f.meta?.size, warningCtx, f.meta?.isTemplate, f.meta?.templateReason ?? undefined, f.meta?.templateContentLength, f.meta?.templateThreshold) : [];
          return { name: f.name, path: f.path, meta: f.meta, warnings };
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

/**
 * Selection-as-SSOT display derivation — the single owner of "what this
 * section renders".
 *
 * The slot catalog declares *candidates*; `actionMetadata.refs` / `.context`
 * is the selection SSOT (what the chat badge, the footer gate and the BE all
 * read). A selected path the catalog does not cover must still be visible, so
 * it comes back as an `added` entry rather than silently vanishing. Three
 * shapes reach this branch:
 *   - the intent declares no slot at all (`context: []` — every `explain-*` /
 *     `ask-*`, `gen-ui-desc`, `gen-visual-*`; `emptyRef()` on the refs side)
 *   - the path lives outside every declared slot dir (free-add picker)
 *   - the path IS a directory (the picker allows bare dir selection, while
 *     catalog entries are always files)
 *
 * `added` is folder-collapsed through the same `compressPathsByFolderCore`
 * SSOT the badge row uses, so one directory reads as one card in both places.
 */
export function resolveSlotSection(
  defs: SlotDef[],
  fileTree: FileNode[],
  selected: ReadonlySet<string>,
  opts?: {
    excludePaths?: Set<string>;
    warningCtx?: FileWarningContext;
    codebaseHasFiles?: boolean;
  },
): SlotSectionView {
  const entries = resolveSlotEntries(
    defs,
    fileTree,
    opts?.excludePaths,
    opts?.warningCtx,
    opts?.codebaseHasFiles,
  );

  const covered = new Set<string>();
  for (const entry of entries) {
    for (const f of entry.files) covered.add(f.path);
    for (const sg of entry.subgroups ?? []) {
      for (const f of sg.files) covered.add(f.path);
    }
  }

  const uncovered = [...selected].filter(p => !covered.has(p));
  const added = compressSelection(uncovered, fileTree);

  // Reproduces both legacy gates with one predicate: refs (`emptyRef()` carries
  // an `emptyHint` and no path) and context (no ctx def ever sets `emptyHint`,
  // so this collapses to `length > 0`).
  const hasDeclaredSlots = defs.some(d => !d.emptyHint);

  return { entries, added, isEmpty: !hasDeclaredSlots && added.length === 0 };
}

export type { SelectedEntry };

/**
 * Compute bundle-level warnings for a ui-source subgroup.
 *
 * Scoped to the `ant` canonical subgroup: its three files (ui-tokens.json,
 * ui-assets.json, ui-spec.json) form a single conceptual bundle, so any
 * missing file makes the entire bundle invalid. Only literal patterns
 * (no `*` wildcards) from DirDescription.expectedFiles are treated as
 * required — wildcard patterns (`fe-system-*.md` etc.) never apply here
 * but the filter makes the helper safe for any dir that happens to
 * declare both literal and wildcard expectations.
 *
 * `figma` and `handoff` return no subgroup warnings:
 *   - figma is rendered file-level; per-file warnings already surface the
 *     URL/MCP issues.
 *   - handoff is a free-form bundle with no required-file contract.
 */
function resolveSubgroupWarnings(
  id: SlotSubgroup['id'],
  dir: string,
  files: SlotFileEntry[],
): SlotWarning[] {
  if (id !== 'ant') return [];
  const desc = getDirDescription(dir);
  const required = (desc?.expectedFiles ?? []).filter(p => !p.includes('*'));
  if (required.length === 0) return [];
  const present = new Set(files.map(f => f.name));
  const missing = required.filter(name => !present.has(name));
  if (missing.length === 0) return [];
  const list = missing.join(', ');
  // Surface label from the dir — the same helper serves `visual/ui/ant` and
  // `visual/game-art/ant`, so the copy must not hardcode "UI".
  const isGameArt = dir.startsWith('visual/game-art');
  const surface = { en: isGameArt ? 'game-art' : 'UI', ko: isGameArt ? '게임아트' : 'UI' };
  return [{
    type: 'invalid-file',
    message: {
      en: `Ant ${surface.en} bundle is incomplete — missing ${missing.length}/${required.length} file(s): ${list}. Run a ${surface.en} design job to regenerate the full set.`,
      ko: `Ant ${surface.ko} 번들이 불완전합니다 — ${required.length}개 중 ${missing.length}개 파일 누락: ${list}. ${surface.ko} 설계 잡을 실행해 전체 세트를 재생성하세요.`,
    },
  }];
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

function listDirWithMeta(fileTree: FileNode[], dirPath: string): Array<{ name: string; path: string; meta?: FileNode['meta'] }> {
  const parts = dirPath.split('/');
  let nodes: FileNode[] = fileTree;
  for (const part of parts) {
    const found = nodes.find(n => n.name === part);
    if (!found || found.type !== 'directory' || !found.children) return [];
    nodes = found.children;
  }
  // Recursive walk: handoff is free-form and may carry nested subdirs
  // (screens/login/spec.md, assets/logo.png). Without recursion, FE drops
  // those files and the RAC selection never reaches BE — even though
  // loadResolvedArtifacts.walkDir handles nested paths correctly.
  const out: Array<{ name: string; path: string; meta?: FileNode['meta'] }> = [];
  const walk = (children: FileNode[], prefix: string): void => {
    for (const child of children) {
      const childPath = `${prefix}/${child.name}`;
      if (child.type === 'file') {
        out.push({ name: child.name, path: childPath, meta: child.meta });
      } else if (child.type === 'directory' && child.children) {
        walk(child.children, childPath);
      }
    }
  };
  walk(nodes, dirPath);
  return out;
}
