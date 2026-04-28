import type { ToolExecutionContext, ToolResult } from '../../../../../../common/tool/types';
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
 * Returns relative path string starting with `assets/`.
 */
export function pickAssetsRoot(input: AssetsRootInput): string {
  const { workspaceDomain, racDomain, intentGroup } = input;
  const effective: Domain =
    workspaceDomain
      ?? racDomain
      ?? (intentGroup === 'design-game-art' ? 'game' : 'service');
  return `assets/${effective}`;
}

/**
 * Handle download_asset tool (ctx-pure).
 *
 * Downloads a file from a URL and saves it under the workspace's domain-keyed
 * pool — `assets/{service|game}/{category}/{filename}` (Phase 2 — D22).
 * Used by LLM to download Figma-exported assets (SVG, PNG, etc.) from CDN URLs
 * returned by get_design_context.
 *
 * In cloud mode, asset URLs that point to Figma Desktop's local server
 * (127.0.0.1:3845) are proxied through the bridge — `ctx.userId` /
 * `ctx.redis` MUST be populated for that branch. Falls back to direct
 * `fetch` for public CDN URLs.
 */
export async function handleDownloadAsset(
  ctx: ToolExecutionContext,
  args: { url: string; filename: string; category?: string },
): Promise<ToolResult> {
  const { url, filename } = args;
  let { category } = args;

  if (!url || !filename) {
    const msg = 'download_asset requires url and filename';
    return { content: msg, error: msg };
  }

  const featurePath = ctx.featurePath;
  if (!featurePath) {
    const msg = 'featurePath not available in context';
    return { content: msg, error: msg };
  }

  const assetsRoot = ctx.assetsRoot;
  if (!assetsRoot) {
    const msg = 'assetsRoot not configured in context (design buildContext must populate it)';
    return { content: msg, error: msg };
  }

  // Path traversal prevention — sanitize the LLM-supplied filename.
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (sanitized.includes('..') || sanitized.startsWith('/')) {
    const msg = `Invalid filename: ${filename}`;
    return { content: msg, error: msg };
  }

  // Infer category from extension if not provided. Conservative defaults
  // (icons / images) — game-art tasks are expected to pass `category`
  // explicitly (e.g. 'entities' / 'particles' / 'sfx').
  if (!category) {
    const ext = sanitized.split('.').pop()?.toLowerCase();
    if (ext === 'svg') category = 'icons';
    else if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext || '')) category = 'images';
    else category = 'misc';
  }

  const pathMod = await import('path');
  const fsMod = await import('fs/promises');

  const destDir = pathMod.join(featurePath, ...assetsRoot.split('/'), category);
  await fsMod.mkdir(destDir, { recursive: true });

  const destPath = pathMod.join(destDir, sanitized);
  const relativePath = `${assetsRoot}/${category}/${sanitized}`;

  const dlMergeIdx = await ctx.chatStatus.showStatus('downloading', { filename: sanitized });

  try {
    const isCloudMode = process.env.ANT_SERVER_MODE === 'cloud';
    let buffer: Buffer;

    if (isCloudMode && isFigmaLocalAssetUrl(url) && ctx.userId && ctx.redis) {
      console.log(`📥 [Tool] download_asset: proxying via bridge for ${sanitized}`);
      buffer = await proxyAssetDownload(ctx.userId, ctx.redis, url);
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

    const sizeBytes = buffer.length;
    const sizeKB = (sizeBytes / 1024).toFixed(1);
    console.log(`📥 [Tool] download_asset: ${relativePath} (${sizeKB} KB)`);

    if (ctx.fileTreeUpdate && ctx.project && ctx.featureFolder) {
      const featureName = ctx.featureFolder;
      ctx.fileTreeUpdate.notifyFileTreeUpdate(ctx.project, featureName);

      if ('addUnseenArtifacts' in ctx.fileTreeUpdate) {
        (ctx.fileTreeUpdate as any).addUnseenArtifacts(
          ctx.project, featureName, [relativePath]
        );
      }
    }

    const isImage = /\.(png|jpe?g|webp|gif|svg)$/i.test(relativePath);
    await ctx.chatStatus.showStatus('downloaded', {
      filename: sanitized,
      sizeKB,
      _mergeIndex: dlMergeIdx,
      ...(isImage ? { imagePath: relativePath } : {}),
    });

    const payload = JSON.stringify({
      success: true,
      path: relativePath,
      filename: sanitized,
      category,
      sizeBytes,
    });

    return { content: payload };
  } catch (err: any) {
    const errMsg = err.name === 'AbortError'
      ? `Download timed out after 30s: ${url}`
      : `Failed to download asset from ${url}: ${err.message}`;

    await ctx.chatStatus.showStatus('downloaded', {
      filename: sanitized,
      error: true,
      _mergeIndex: dlMergeIdx,
    });

    return { content: JSON.stringify({ error: errMsg }), error: errMsg };
  }
}

/**
 * Handle list_assets tool (ctx-pure).
 *
 * Lists all runtime asset files under the workspace's domain-keyed pool —
 * `assets/{service|game}/...` (Phase 2 — D22). Lookup is strictly
 * scoped to the resolved domain root; the parent `assets/` is a
 * container only and is never enumerated as a fallback.
 */
export async function handleListAssets(
  ctx: ToolExecutionContext,
  args: { category?: string },
): Promise<ToolResult> {
  const { category } = args;
  const fileSystem = ctx.fileSystem;
  if (!fileSystem) {
    const msg = 'FileSystemPort not available';
    return { content: msg, error: msg };
  }

  const featurePath = ctx.featurePath;
  if (!featurePath) {
    const msg = 'featurePath not available in context';
    return { content: msg, error: msg };
  }

  const assetsRoot = ctx.assetsRoot;
  if (!assetsRoot) {
    const msg = 'assetsRoot not configured in context';
    return { content: msg, error: msg };
  }

  const path = await import('path');
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
    // Directory doesn't exist or not accessible — treated as empty pool.
  }

  if (allFiles.length === 0) {
    return {
      content: JSON.stringify({
        category: category || 'all',
        assets: [],
        count: 0,
        message: `No assets found. Add asset files under ${assetsRoot}/.`,
      }, null, 2),
    };
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
    const mergeIndex = await ctx.chatStatus.showStatus('grepping', { filesCount: 0, totalFiles: 0 });
    await ctx.chatStatus.showStatus('grepped', {
      filesCount: totalCount,
      filesList: allFiles,
      _mergeIndex: mergeIndex,
    });
  }

  return {
    content: JSON.stringify({
      category: category || 'all',
      groups: grouped,
      total: totalCount,
    }, null, 2),
  };
}
