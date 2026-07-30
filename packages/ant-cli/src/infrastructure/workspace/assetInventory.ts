import * as fs from 'fs';
import * as path from 'path';

/**
 * Asset inventory — the single domain-scoped enumeration of a feature's asset
 * pool, shared by the design job (grounding `game-art-assets.json` /
 * `ui-assets.json` externals) and the code job (runtime asset placement floor).
 *
 * The `assetsRoot` passed in is ALREADY domain-scoped via `pickAssetsRoot`
 * (`assets/service` or `assets/game`) — this walker only ever descends that
 * subtree, so the Asset Surface Boundary (I6) is honored by construction:
 * neither job can observe the other domain's pool.
 *
 * Shape is a superset of the legacy `{ files, count }` runtime index (adds
 * `groups`, the first-subdir grouping that `list_assets` returns), so existing
 * `.files` / `.count` consumers stay compatible.
 */
export interface AssetInventory {
  /** Feature-relative paths, e.g. `assets/game/entities/hero.png`. */
  files: string[];
  /** First-subdir grouping under the pool root, e.g. `{ entities: [...] }`. */
  groups: Record<string, string[]>;
  count: number;
}

const DEFAULT_MAX = 200;

/**
 * Enumerate every file under the domain-scoped `assetsRoot` of a feature.
 * Returns an empty inventory when the pool directory does not exist.
 *
 * @param featurePath absolute feature root (holds `assets/`, `codebase/`, ...)
 * @param assetsRoot  feature-relative pool root from `pickAssetsRoot`
 *                    (`assets/service` | `assets/game`)
 */
/**
 * Render the inventory as a prompt block ("## Asset Files ..."), grouped by
 * category subdir. Returns '' when the pool is empty — callers can append
 * unconditionally. `usage` is the flavor-specific instruction line (what the
 * consuming job should DO with a fitting asset).
 */
export function formatAssetInventoryBlock(
  // Accepts the graph-state channel shape too (its `groups` is optional).
  inv: { count: number; groups?: Record<string, string[]> } | undefined,
  opts: { assetsRoot: string; usage: string },
): string {
  if (!inv?.count) return '';
  let block = `## Asset Files (real, already placed under ${opts.assetsRoot}/)\n`;
  block += `There are ${inv.count} real asset file(s). ${opts.usage}\n`;
  for (const [group, files] of Object.entries(inv.groups ?? {})) {
    if (files.length === 0) continue;
    block += `- ${group}: ${files.slice(0, 20).map(f => f.split('/').pop()).join(', ')}${files.length > 20 ? ` … (+${files.length - 20})` : ''}\n`;
  }
  return block + '\n';
}

export function indexAssetPool(params: {
  featurePath?: string;
  assetsRoot: string;
  maxFiles?: number;
}): AssetInventory {
  const { featurePath, assetsRoot } = params;
  const empty: AssetInventory = { files: [], groups: {}, count: 0 };
  if (!featurePath) return empty;

  const maxFiles = params.maxFiles
    ?? parseInt(process.env.ANT_RUNTIME_ASSETS_INDEX_MAX || String(DEFAULT_MAX), 10);
  const poolAbs = path.join(featurePath, ...assetsRoot.split('/'));
  if (!fs.existsSync(poolAbs)) return empty;

  const files: string[] = [];
  const walk = (dirAbs: string): void => {
    if (files.length >= maxFiles) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (files.length >= maxFiles) break;
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dirAbs, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) {
        const relToFeature = path.relative(featurePath, abs).replace(/\\/g, '/');
        if (relToFeature && !relToFeature.startsWith('..')) files.push(relToFeature);
      }
    }
  };
  walk(poolAbs);

  // Group by the first path segment BELOW the pool root (the category subdir).
  const groups: Record<string, string[]> = {};
  const rootPrefix = assetsRoot.replace(/\/$/, '') + '/';
  for (const f of files) {
    const rel = f.startsWith(rootPrefix) ? f.slice(rootPrefix.length) : f;
    const seg = rel.split('/');
    const group = seg.length > 1 ? seg[0] : '(root)';
    (groups[group] ||= []).push(f);
  }

  return { files, groups, count: files.length };
}
