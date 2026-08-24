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

/** Ceiling on a single downloaded asset. Generous for design assets, bounded so
 *  an attacker-controlled response cannot exhaust the worker heap (M-NEW-014). */
const ASSET_MAX_BYTES = 50 * 1024 * 1024;
/** Per-worker aggregate in-flight download budget — bounds concurrent heap use. */
const ASSET_INFLIGHT_MAX_BYTES = 150 * 1024 * 1024;
const ASSET_MAX_REDIRECT_HOPS = 5;
const ASSET_FETCH_TIMEOUT_MS = 30_000;

/** Reserved in-flight bytes across concurrent downloads in THIS worker process. */
let assetInflightBytes = 0;

/**
 * Validate one hop's URL and resolve it to a single vetted public IP.
 * Rejects non-http(s) schemes and any host resolving to an internal address
 * (every A/AAAA record checked). The returned address is what the connection is
 * pinned to, so a later DNS answer cannot rebind the socket to a private target.
 */
async function resolveVettedAddress(rawUrl: string): Promise<{ url: URL; address: string; family: number }> {
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
  return { url: parsed, address: resolved[0].address, family: resolved[0].family };
}

/**
 * SSRF-safe, memory-bounded server-side asset fetch (H-NEW-002, M-NEW-014).
 *
 * Redirects are followed MANUALLY (`maxRedirections: 0`), re-validating scheme +
 * every DNS record at each hop, and each connection is pinned to the vetted IP
 * via a custom `connect.lookup` — so neither a `Location` to a private host nor a
 * post-check DNS rebind reaches an internal endpoint. Host/SNI stay the original
 * hostname (TLS + vhosts keep working). The body is read as a bounded stream
 * with a hard byte cap and a per-worker in-flight reservation, replacing the
 * unbounded `response.arrayBuffer()`.
 */
export async function safeFetchAssetToBuffer(rawUrl: string): Promise<Buffer> {
  if (assetInflightBytes + ASSET_MAX_BYTES > ASSET_INFLIGHT_MAX_BYTES) {
    throw new Error('Asset download budget exhausted; retry shortly');
  }
  assetInflightBytes += ASSET_MAX_BYTES; // reserve the ceiling up front
  try {
    const { Agent, request } = await import('undici');
    let current = rawUrl;

    for (let hop = 0; hop <= ASSET_MAX_REDIRECT_HOPS; hop++) {
      const vetted = await resolveVettedAddress(current);
      const agent = new Agent({
        connect: {
          lookup: (_hostname: string, _opts: unknown, cb: (err: Error | null, address: string, family: number) => void) =>
            cb(null, vetted.address, vetted.family),
        },
      });

      try {
        // undici `request` does not follow redirects on its own — each 3xx is
        // returned so it can be re-validated below before the next hop.
        const res = await request(current, {
          method: 'GET',
          dispatcher: agent,
          headersTimeout: ASSET_FETCH_TIMEOUT_MS,
          bodyTimeout: ASSET_FETCH_TIMEOUT_MS,
        });

        const status = res.statusCode;
        if (status >= 300 && status < 400) {
          const loc = res.headers['location'];
          await res.body.dump();
          if (!loc || hop === ASSET_MAX_REDIRECT_HOPS) {
            throw new Error('Too many redirects or missing redirect target');
          }
          current = new URL(Array.isArray(loc) ? loc[0] : loc, current).toString();
          continue;
        }
        if (status >= 400) {
          await res.body.dump();
          throw new Error(`HTTP ${status}`);
        }

        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > ASSET_MAX_BYTES) {
          await res.body.dump();
          throw new Error(`Asset exceeds ${ASSET_MAX_BYTES} bytes`);
        }

        const chunks: Buffer[] = [];
        let total = 0;
        for await (const chunk of res.body) {
          total += chunk.length;
          if (total > ASSET_MAX_BYTES) {
            res.body.destroy();
            throw new Error(`Asset exceeds ${ASSET_MAX_BYTES} bytes`);
          }
          chunks.push(chunk as Buffer);
        }
        return Buffer.concat(chunks, total);
      } finally {
        await agent.close().catch(() => {});
      }
    }
    throw new Error('Too many redirects');
  } finally {
    assetInflightBytes -= ASSET_MAX_BYTES;
  }
}

/** Ceiling exported for tests. */
export const __ASSET_MAX_BYTES = ASSET_MAX_BYTES;

/** Bounded read of a global-fetch response body (local self-host path). */
export async function readBoundedResponse(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > ASSET_MAX_BYTES) {
    throw new Error(`Asset exceeds ${ASSET_MAX_BYTES} bytes`);
  }
  if (!response.body) return Buffer.from(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > ASSET_MAX_BYTES) {
      await reader.cancel();
      throw new Error(`Asset exceeds ${ASSET_MAX_BYTES} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
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
  // Descriptor-contained mkdir when under the service-owned base (H-017): a raw
  // recursive mkdir after a lexical guard follows a reparented feature root.
  // Raw mkdir only for out-of-base (repoType:'local') targets.
  {
    const { toBaseRelative, mkdirpContainedBase } = await import('../../../../../../../core/config/containedIo');
    const { WorkspacePathResolver } = await import('../../../../../../../core/config/WorkspacePathResolver');
    const destDirBr = toBaseRelative(WorkspacePathResolver.getPhysicalWorkspacesPath(), destDir);
    if (destDirBr) {
      const mk = mkdirpContainedBase(destDirBr);
      if (!mk.ok) {
        const msg = `Cannot create asset directory: ${mk.reason}`;
        return { content: msg, error: msg };
      }
    } else {
      await fsMod.mkdir(destDir, { recursive: true });
    }
  }

  const relativePath = `${assetsRoot}/${category}/${sanitized}`;

  const dlMergeIdx = await ctx.chatStatus.showStatus('downloading', { filename: sanitized });

  try {
    const isCloudMode = process.env.ANT_SERVER_MODE === 'cloud';
    let buffer: Buffer;

    if (isCloudMode && isFigmaLocalAssetUrl(url) && ctx.userId && ctx.redis) {
      console.log(`📥 [Tool] download_asset: proxying via bridge for ${sanitized}`);
      buffer = await proxyAssetDownload(ctx.userId, ctx.redis, url);
    } else if (isCloudMode) {
      // Server-side fetch of an LLM-supplied URL: SSRF-safe (per-hop DNS
      // validation + IP pinning + manual redirects) and memory-bounded. Legit
      // Figma-local URLs took the bridge branch above. (H-NEW-002, M-NEW-014)
      buffer = await safeFetchAssetToBuffer(url);
    } else {
      // Local self-host: the operator's own loopback (Figma Desktop) is trusted,
      // so the SSRF guard is scoped out — but still bound memory so a huge
      // response cannot OOM the process.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ASSET_FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        buffer = await readBoundedResponse(response);
      } finally {
        clearTimeout(timeout);
      }
    }

    // Shared byte-safe write core: size + GLB header verification (fail-loud
    // instead of silently poisoning the asset pool).
    const { writeBufferVerifiedContained } = await import('../../../../../../../core/utils/binaryIntegrity');
    await writeBufferVerifiedContained(assetsBase, destPath, buffer);

    const sizeBytes = buffer.length;
    const sizeKB = (sizeBytes / 1024).toFixed(1);
    console.log(`📥 [Tool] download_asset: ${relativePath} (${sizeKB} KB)`);

    // The tree refresh itself is emitted as a `fileCreated` side effect below —
    // ToolOrchestrator is the single owner of notifyFileTreeUpdate. Only the
    // unseen-badge call stays here (it is per-path, not per-mutation).
    if (ctx.fileTreeUpdate && ctx.project && ctx.featureFolder) {
      if ('addUnseenArtifacts' in ctx.fileTreeUpdate) {
        (ctx.fileTreeUpdate as any).addUnseenArtifacts(
          ctx.project, ctx.featureFolder, [relativePath]
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

    return {
      content: payload,
      sideEffects: [{ type: 'fileCreated', path: relativePath }],
    };
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
      ...(inventory.corrupted?.[p]
        ? { corrupted: `CORRUPTED on disk (${inventory.corrupted[p]}) — do NOT consume; ask the user to re-upload the original file` }
        : {}),
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
