import { DesignGraphState } from '../../../state';
import { getChatAPIClient } from '../../../../../../../core/adapters/ChatAPIClient';
import { isFigmaLocalAssetUrl, proxyAssetDownload } from '../../../../../../../periphery/adapters/figma/MCPTransport';

/**
 * Handle download_asset tool
 *
 * Downloads a file from a URL and saves it to inputs/assets/{category}/{filename}.
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

  // Infer category from extension if not provided
  if (!category) {
    const ext = sanitized.split('.').pop()?.toLowerCase();
    if (ext === 'svg') category = 'icons';
    else if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext || '')) category = 'images';
    else category = 'misc';
  }

  const pathMod = await import('path');
  const fsMod = await import('fs/promises');

  const destDir = pathMod.join(featurePath, 'inputs', 'assets', category);
  await fsMod.mkdir(destDir, { recursive: true });

  const destPath = pathMod.join(destDir, sanitized);
  const relativePath = `inputs/assets/${category}/${sanitized}`;

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
 * Lists all runtime asset files in inputs/assets/
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
  
  const assetsDir = path.join(featurePath, 'inputs', 'assets');
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
      message: 'No assets found. Add asset files to inputs/assets/',
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
