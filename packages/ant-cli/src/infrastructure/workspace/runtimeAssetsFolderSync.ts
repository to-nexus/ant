import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export type RuntimeAssetSyncAction = 'copied' | 'updated' | 'skipped' | 'failed';

export interface RuntimeAssetSyncItem {
  sourceRel: string; // relative to assets
  destRel: string;   // relative to codebase root
  action: RuntimeAssetSyncAction;
  reason?: string;
}

export interface RuntimeAssetSyncResult {
  items: RuntimeAssetSyncItem[];
  stats: {
    total: number;
    copied: number;
    updated: number;
    skipped: number;
    failed: number;
  };
}

function sha256File(absPath: string): string {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(absPath);
  hash.update(data);
  return hash.digest('hex');
}

function normalizeSlash(p: string): string {
  return p.replace(/\\/g, '/');
}

function detectRuntimeAssetRoot(codebaseRootAbs: string): { rootAbs: string; label: string } {
  const publicAbs = path.join(codebaseRootAbs, 'public');
  if (fs.existsSync(publicAbs) && fs.statSync(publicAbs).isDirectory()) {
    return { rootAbs: publicAbs, label: 'public' };
  }

  const staticAbs = path.join(codebaseRootAbs, 'static');
  if (fs.existsSync(staticAbs) && fs.statSync(staticAbs).isDirectory()) {
    return { rootAbs: staticAbs, label: 'static' };
  }

  const srcAbs = path.join(codebaseRootAbs, 'src');
  const srcAssetsAbs = path.join(codebaseRootAbs, 'src', 'assets');
  if (fs.existsSync(srcAssetsAbs) && fs.statSync(srcAssetsAbs).isDirectory()) {
    return { rootAbs: srcAssetsAbs, label: 'src/assets' };
  }
  if (fs.existsSync(srcAbs) && fs.statSync(srcAbs).isDirectory()) {
    // If there's src/ but no src/assets yet, prefer creating src/assets as a reasonable fallback.
    return { rootAbs: srcAssetsAbs, label: 'src/assets (created)' };
  }

  const packageJsonAbs = path.join(codebaseRootAbs, 'package.json');
  if (fs.existsSync(packageJsonAbs) && fs.statSync(packageJsonAbs).isFile()) {
    // Most JS web projects can safely use public/ as static root.
    return { rootAbs: publicAbs, label: 'public (created)' };
  }

  // Ultimate fallback: codebase root (legacy behavior)
  return { rootAbs: codebaseRootAbs, label: 'codebase-root (fallback)' };
}

export function syncRuntimeAssetsFolder(params: {
  featurePathAbs: string;   // absolute feature directory
  codebaseRootAbs: string;  // absolute codebase root (repo root)
}): RuntimeAssetSyncResult {
  const { featurePathAbs, codebaseRootAbs } = params;

  const assetsRootAbs = path.join(featurePathAbs, 'assets');
  const items: RuntimeAssetSyncItem[] = [];
  const destRoot = detectRuntimeAssetRoot(codebaseRootAbs);
  // Ensure destination root exists if we picked a subdirectory.
  try {
    if (destRoot.rootAbs !== codebaseRootAbs) {
      fs.mkdirSync(destRoot.rootAbs, { recursive: true });
    }
  } catch {
    // If creation fails, fall back to codebase root.
  }
  const effectiveDestRootAbs = fs.existsSync(destRoot.rootAbs) ? destRoot.rootAbs : codebaseRootAbs;

  if (!fs.existsSync(assetsRootAbs)) {
    return {
      items,
      stats: { total: 0, copied: 0, updated: 0, skipped: 0, failed: 0 }
    };
  }

  const walk = (dirAbs: string) => {
    const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dirAbs, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) {
        const relFromAssets = normalizeSlash(path.relative(assetsRootAbs, abs));
        if (!relFromAssets || relFromAssets.startsWith('..')) continue;

        // Mirror into detected runtime asset root (prefer public/).
        const destAbs = path.resolve(effectiveDestRootAbs, relFromAssets);
        const destRel = normalizeSlash(path.relative(codebaseRootAbs, destAbs));

        // Safety: prevent escaping codebase root
        if (!destAbs.startsWith(codebaseRootAbs)) {
          items.push({ sourceRel: relFromAssets, destRel, action: 'failed', reason: 'dest_outside_codebase_root' });
          continue;
        }

        try {
          fs.mkdirSync(path.dirname(destAbs), { recursive: true });

          if (!fs.existsSync(destAbs)) {
            fs.copyFileSync(abs, destAbs);
            items.push({ sourceRel: relFromAssets, destRel, action: 'copied' });
            continue;
          }

          // Destination exists: do NOT overwrite unless content changed.
          const srcHash = sha256File(abs);
          const dstHash = sha256File(destAbs);
          if (srcHash === dstHash) {
            items.push({ sourceRel: relFromAssets, destRel, action: 'skipped' });
            continue;
          }

          // Content differs -> update (overwrite)
          fs.copyFileSync(abs, destAbs);
          items.push({ sourceRel: relFromAssets, destRel, action: 'updated' });
        } catch (e: any) {
          items.push({
            sourceRel: relFromAssets,
            destRel,
            action: 'failed',
            reason: e instanceof Error ? e.message : 'copy_failed'
          });
        }
      }
    }
  };

  walk(assetsRootAbs);

  const stats = {
    total: items.length,
    copied: items.filter(i => i.action === 'copied').length,
    updated: items.filter(i => i.action === 'updated').length,
    skipped: items.filter(i => i.action === 'skipped').length,
    failed: items.filter(i => i.action === 'failed').length
  };

  return { items, stats };
}


