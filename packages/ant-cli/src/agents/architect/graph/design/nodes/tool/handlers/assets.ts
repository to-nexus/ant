import { DesignGraphState } from '../../../state';
import { getChatAPIClient } from '../../../../../../../core/adapters/ChatAPIClient';
import { isFigmaLocalAssetUrl, proxyAssetDownload } from '../../../../../../../periphery/adapters/figma/MCPTransport';
import type { Domain } from '@ant/shared';

/**
 * Pure routing input for `pickAssetsRoot` (Phase 2 — D22).
 *
 * Decoupled from `DesignGraphState` so the router is unit-testable without
 * needing to fabricate a full graph state. Both `download_asset` and
 * `list_assets` derive these three signals from the live state and delegate
 * the actual decision to `pickAssetsRoot`.
 */
export interface AssetsRootInput {
  /** Workspace-level domain (SSOT after `p2-ui-actions-art-group`). */
  workspaceDomain?: Domain;
  /** Per-turn explicit/inferred RAC override. */
  racDomain?: Domain;
  /** RAC intent group — `'design-game-art'` implies `game` by matrix gate. */
  intentGroup?: string;
}

/**
 * Pure resolver — picks the asset pool root from the three D22 signals.
 *
 * Resolution order (most authoritative first):
 *   1. `workspaceDomain`  — workspace-level 1st-class slot.
 *   2. `racDomain`        — per-turn explicit/inferred override.
 *   3. `intentGroup === 'design-game-art'` heuristic — `game` (matrix gate).
 *   4. Default `'service'`.
 *
 * Returns relative path string starting with `inputs/assets/`.
 */
export function pickAssetsRoot(input: AssetsRootInput): string {
  const { workspaceDomain, racDomain, intentGroup } = input;
  const effective: Domain =
    workspaceDomain
      ?? racDomain
      ?? (intentGroup === 'design-game-art' ? 'game' : 'service');
  return `inputs/assets/${effective}`;
}

/**
 * Resolve the workspace asset pool root for the current job state (Phase 2 — D22).
 * Thin adapter that pulls the three signals out of `DesignGraphState` and
 * delegates to the pure `pickAssetsRoot`.
 */
export function resolveAssetsRoot(state: DesignGraphState): string {
  const workspaceDomain = (state.workspaceConfig as { domain?: Domain } | undefined)?.domain;
  return pickAssetsRoot({
    workspaceDomain,
    racDomain: state.resolvedAction?.domain,
    intentGroup: state.resolvedAction?.intentGroup,
  });
}

/**
 * Handle download_asset tool
 *
 * Downloads a file from a URL and saves it under the workspace's domain-keyed
 * pool — `inputs/assets/{service|game}/{category}/{filename}` (Phase 2 — D22).
 * Used by LLM to download Figma-exported assets (SVG, PNG, etc.) from CDN URLs
 * returned by get_design_context.
 */
export async function handleDownloadAsset(
  state: DesignGraphState,
  args: { url: string; filename: string; category?: string }
): Promise<string> {
  const { url, filename } = args;
  let { category } = args;

  if (!url || !filename) {
    throw new Error('download_asset requires url and filename');
  }

  const featurePath = state.context.featurePath;
  if (!featurePath) {
    throw new Error('featurePath not available in context');
  }

  // Path traversal prevention
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (sanitized.includes('..') || sanitized.startsWith('/')) {
    throw new Error(`Invalid filename: ${filename}`);
  }

  // Infer category from extension if not provided. For game-art context the
  // `entities` / `particles` / `sfx` defaults are more appropriate, but we
  // keep the conservative `icons`/`images` fallback because the LLM is
  // expected to pass `category` explicitly when working on game assets.
  if (!category) {
    const ext = sanitized.split('.').pop()?.toLowerCase();
    if (ext === 'svg') category = 'icons';
    else if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext || '')) category = 'images';
    else category = 'misc';
  }

  const pathMod = await import('path');
  const fsMod = await import('fs/promises');

  const assetsRoot = resolveAssetsRoot(state); // 'inputs/assets/service' | 'inputs/assets/game'
  const destDir = pathMod.join(featurePath, ...assetsRoot.split('/'), category);
  await fsMod.mkdir(destDir, { recursive: true });

  const destPath = pathMod.join(destDir, sanitized);
  const relativePath = `${assetsRoot}/${category}/${sanitized}`;

  try {
    const isCloudMode = process.env.ANT_SERVER_MODE === 'cloud';
    const userId = state.context?.userId;
    const redis = state.deps?.redis;
    let buffer: Buffer;

    if (isCloudMode && isFigmaLocalAssetUrl(url) && userId && redis) {
      console.log(`📥 [Tool] download_asset: proxying via bridge for ${sanitized}`);
      buffer = await proxyAssetDownload(userId, redis, url);
    } else {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      buffer = Buffer.from(await response.arrayBuffer());
    }

    await fsMod.writeFile(destPath, buffer);

    const sizeKB = (buffer.length / 1024).toFixed(1);
    console.log(`📥 [Tool] download_asset: ${relativePath} (${sizeKB} KB)`);

    if (state.deps?.fileTreeUpdate) {
      const featureName = state.context.featureFolder || 'default';
      state.deps.fileTreeUpdate.notifyFileTreeUpdate(state.context.project, featureName);

      if ('addUnseenArtifacts' in state.deps.fileTreeUpdate) {
        (state.deps.fileTreeUpdate as any).addUnseenArtifacts(
          state.context.project, featureName, [relativePath]
        );
      }
    }

    return JSON.stringify({
      success: true,
      path: relativePath,
      filename: sanitized,
      category,
      sizeBytes: buffer.length,
    });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Download timed out after 30s: ${url}`);
    }
    throw new Error(`Failed to download asset from ${url}: ${err.message}`);
  }
}

/**
 * Handle list_assets tool
 *
 * Lists all runtime asset files under the workspace's domain-keyed pool —
 * `inputs/assets/{service|game}/...` (Phase 2 — D22). Lookup is strictly
 * scoped to the resolved domain root; the parent `inputs/assets/` is a
 * container only and is never enumerated as a fallback.
 */
export async function handleListAssets(
  state: DesignGraphState,
  args: { category?: string }
): Promise<string> {
  const { category } = args;
  const fileSystem = state.deps?.fileSystem;
  
  if (!fileSystem) {
    throw new Error('FileSystemPort not available');
  }
  
  const path = await import('path');
  const featurePath = state.context.featurePath;
  if (!featurePath) {
    throw new Error('featurePath not available in context');
  }

  const assetsRoot = resolveAssetsRoot(state);
  const assetsDir = path.join(featurePath, ...assetsRoot.split('/'));
  const targetDir = category 
    ? path.join(assetsDir, category)
    : assetsDir;
  
  const rootPath = fileSystem.getRootPath?.() || '';
  const relativePath = rootPath
    ? path.relative(rootPath, targetDir)
    : targetDir.replace(/^\//, '');
  
  let allFiles: string[] = [];
  try {
    allFiles = await fileSystem.listFiles(relativePath, []);
  } catch {
    // Directory doesn't exist or not accessible
  }
  
  if (allFiles.length === 0) {
    return JSON.stringify({
      category: category || 'all',
      assets: [],
      count: 0,
      message: `No assets found. Add asset files under ${assetsRoot}/.`,
    }, null, 2);
  }
  
  const featureRelPath = rootPath
    ? path.relative(rootPath, featurePath)
    : featurePath.replace(/^\//, '');
  
  const assetsRelPath = rootPath
    ? path.relative(rootPath, assetsDir)
    : assetsDir.replace(/^\//, '');
  
  const grouped: Record<string, { path: string; filename: string; extension: string }[]> = {};
  
  for (const file of allFiles) {
    const featureRelativePath = file.startsWith(featureRelPath)
      ? file.slice(featureRelPath.length).replace(/^[\/\\]/, '')
      : file;
    const filename = path.basename(file);
    const extension = path.extname(file).toLowerCase();
    
    const assetInfo = { path: featureRelativePath, filename, extension };
    
    const assetRelative = file.startsWith(assetsRelPath)
      ? file.slice(assetsRelPath.length).replace(/^[\/\\]/, '')
      : featureRelativePath;
    const parts = assetRelative.split(/[\/\\]/);
    const group = parts.length > 1 ? parts[0] : '(root)';
    (grouped[group] ||= []).push(assetInfo);
  }
  
  const totalCount = Object.values(grouped).reduce((sum, arr) => sum + arr.length, 0);
  const groupSummary = Object.entries(grouped).map(([k, v]) => `${k}: ${v.length}`).join(', ');
  console.log(`   📦 Found ${totalCount} assets (${groupSummary})`);
  
  if (totalCount > 0) {
    const chatAPI = getChatAPIClient();
    const mergeIndex = await chatAPI.showChatStatus('grepping', { filesCount: 0, totalFiles: 0 });
    await chatAPI.showChatStatus('grepped', { 
      filesCount: totalCount,
      filesList: allFiles,
      _mergeIndex: mergeIndex
    });
  }
  
  return JSON.stringify({
    category: category || 'all',
    groups: grouped,
    total: totalCount,
  }, null, 2);
}
