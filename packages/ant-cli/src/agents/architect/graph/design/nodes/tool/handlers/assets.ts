import type { ToolExecutionContext, ToolResult } from '../../../../../../common/tool/types';
import { isFigmaLocalAssetUrl, proxyAssetDownload } from '../../../../../../../periphery/adapters/figma/MCPTransport';
// Asset pool root resolution moved to `@ant/shared` (canonical.ts) so the
// code/spec jobs share the single domain gate instead of re-deriving it.
// Re-exported here for back-compat with existing importers of this module.
export { pickAssetsRoot, type AssetsRootInput } from '@ant/shared';

/**
 * True when `ip` is a loopback / private / link-local / CGNAT address (IPv4 or
 * IPv6). Unparseable input is treated as unsafe. `169.254.169.254` (cloud
 * metadata) falls under the IPv4 link-local block.
 */
export function isPrivateAddress(ip: string): boolean {
  if (ip.includes(':')) {
    const v6 = ip.toLowerCase();
    if (v6 === '::1' || v6 === '::') return true;
    if (v6.startsWith('fe80')) return true; // link-local
    if (v6.startsWith('fc') || v6.startsWith('fd')) return true; // unique-local
    const mapped = v6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  const parts = ip.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local incl. metadata endpoint
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/**
 * SSRF guard for server-side asset fetches: rejects non-http(s) schemes and
 * hosts that resolve to any internal address (checks every A/AAAA record to
 * blunt DNS-rebinding). Throws on a blocked target.
 */
async function assertPublicHttpUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked URL scheme: ${parsed.protocol}`);
  }
  const { lookup } = await import('dns/promises');
  const resolved = await lookup(parsed.hostname, { all: true });
  if (resolved.length === 0 || resolved.some((r) => isPrivateAddress(r.address))) {
    throw new Error(`Blocked internal address for host: ${parsed.hostname}`);
  }
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

  // Path traversal prevention — the LLM-supplied `category` is a single pool
  // segment (e.g. 'icons' / 'entities'). Sanitize identically to `filename` so
  // it cannot escape the assets root (e.g. `../../../tmp`).
  const safeCategory = category.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!safeCategory || safeCategory === '.' || safeCategory.includes('..')) {
    const msg = `Invalid category: ${category}`;
    return { content: msg, error: msg };
  }
  category = safeCategory;

  const pathMod = await import('path');
  const fsMod = await import('fs/promises');

  // Containment guard (defense in depth): the resolved destination MUST stay
  // within the feature's assets root even if sanitization is ever loosened.
  const assetsBase = pathMod.resolve(featurePath, ...assetsRoot.split('/'));
  const destDir = pathMod.join(assetsBase, category);
  const destPath = pathMod.join(destDir, sanitized);
  const resolvedDest = pathMod.resolve(destPath);
  if (resolvedDest !== assetsBase && !resolvedDest.startsWith(assetsBase + pathMod.sep)) {
    const msg = 'Resolved asset path escapes the assets root';
    return { content: msg, error: msg };
  }
  await fsMod.mkdir(destDir, { recursive: true });

  const relativePath = `${assetsRoot}/${category}/${sanitized}`;

  const dlMergeIdx = await ctx.chatStatus.showStatus('downloading', { filename: sanitized });

  try {
    const isCloudMode = process.env.ANT_SERVER_MODE === 'cloud';
    let buffer: Buffer;

    if (isCloudMode && isFigmaLocalAssetUrl(url) && ctx.userId && ctx.redis) {
      console.log(`📥 [Tool] download_asset: proxying via bridge for ${sanitized}`);
      buffer = await proxyAssetDownload(ctx.userId, ctx.redis, url);
    } else {
      // SSRF guard (cloud only): the direct fetch runs server-side, so an
      // LLM-supplied URL must not reach internal/metadata endpoints. Legit
      // Figma-local URLs go through the bridge-proxy branch above in cloud;
      // in local self-host mode the operator's own loopback (Figma Desktop)
      // is trusted, so the guard is scoped to cloud.
      if (isCloudMode) {
        await assertPublicHttpUrl(url);
      }

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
 *
 * Built on `indexAssetPool`, the same enumeration the resolve nodes use, so a
 * `category` filter is an in-memory group lookup rather than a path join. That
 * distinction is load-bearing: joining an LLM-supplied `category` onto the
 * already domain-scoped root turned `game/models` into `assets/game/game/models`,
 * and because `listFiles` returns `[]` for a missing directory rather than
 * throwing, the miss was reported as the affirmative denial "No assets found.
 * Add asset files under assets/game/." The model believed that over its own
 * `list_files` result and designed around an asset it had been given
 * (zero-hunting-label). An unknown category must therefore be distinguishable
 * from an empty pool, and both must share ONE response shape so "zero" can be
 * compared against "some".
 */
export async function handleListAssets(
  ctx: ToolExecutionContext,
  args: { category?: string },
): Promise<ToolResult> {
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

  const { indexAssetPool } = await import('../../../../../../../infrastructure/workspace/assetInventory');
  const inventory = indexAssetPool({ featurePath, assetsRoot });
  const availableCategories = Object.keys(inventory.groups).sort();

  const describe = (files: string[]) =>
    files.map((p) => ({
      path: p,
      filename: p.split('/').pop() ?? p,
      extension: (p.match(/\.[^./]+$/)?.[0] ?? '').toLowerCase(),
      ...(inventory.sizes?.[p] !== undefined ? { sizeBytes: inventory.sizes[p] } : {}),
    }));

  // Tolerate the predictable domain-prefixed form (`game/models`) instead of
  // failing on it — the pool root is implicit, so strip it and proceed.
  let requested = args.category?.replace(/^\/+|\/+$/g, '');
  if (requested) {
    const rootHead = assetsRoot.split('/').filter(Boolean).pop();
    for (const prefix of [assetsRoot, rootHead].filter(Boolean) as string[]) {
      if (requested === prefix) { requested = undefined; break; }
      if (requested.startsWith(`${prefix}/`)) {
        requested = requested.slice(prefix.length + 1);
        break;
      }
    }
  }

  if (requested && !(requested in inventory.groups)) {
    // NOT "no assets" — the pool may be full. Say which categories exist.
    return {
      content: JSON.stringify({
        assetsRoot,
        category: requested,
        categoryFound: false,
        availableCategories,
        assets: [],
        count: 0,
        total: inventory.count,
        message:
          `Category "${requested}" does not exist under ${assetsRoot}/. ` +
          (availableCategories.length > 0
            ? `Available categories: ${availableCategories.join(', ')}. ` +
              `Call list_assets with no category to see every asset.`
            : `The pool is empty — add asset files under ${assetsRoot}/.`),
      }, null, 2),
    };
  }

  const selected = requested ? inventory.groups[requested] : inventory.files;

  if (selected.length > 0) {
    const mergeIndex = await ctx.chatStatus.showStatus('grepping', { filesCount: 0, totalFiles: 0 });
    await ctx.chatStatus.showStatus('grepped', {
      filesCount: selected.length,
      filesList: selected,
      _mergeIndex: mergeIndex,
    });
  }

  console.log(
    `   📦 Found ${selected.length} assets under ${assetsRoot}/${requested ?? ''} ` +
    `(categories: ${availableCategories.join(', ') || 'none'})`,
  );

  return {
    content: JSON.stringify({
      assetsRoot,
      category: requested ?? 'all',
      categoryFound: true,
      availableCategories,
      assets: describe(selected),
      count: selected.length,
      total: inventory.count,
      ...(inventory.count === 0
        ? { message: `The pool is empty — add asset files under ${assetsRoot}/.` }
        : {}),
    }, null, 2),
  };
}
