import * as fs from 'fs';
import * as path from 'path';
import { formatByteSize } from '../../core/utils/binaryExtensions';
import { sniffCorruptedBinary } from '../../core/utils/binaryIntegrity';

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
  /**
   * Byte size per feature-relative path. Additive — `files` keeps its
   * `string[]` shape because graph state and the code job's prompt block both
   * consume it directly.
   *
   * A binary asset the model cannot read is one it can only reason about by
   * size, and with no size in reach it invented one: a fabricated "193.8 KB"
   * propagated into a spec and was then used to justify a design decision
   * ("the async load window is negligible at 193.8 KB"). One `statSync` per
   * file, bounded by the same `maxFiles` cap as the walk.
   */
  sizes: Record<string, number>;
  /**
   * Defect reason per corrupted binary asset (utf-8 round-trip mojibake /
   * GLB header mismatch). A poisoned pool file consumed silently reproduces
   * the Duck.glb incident — the inventory is the surface every job reads,
   * so the warning lives here.
   */
  corrupted: Record<string, string>;
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
  // Accepts the graph-state channel shape too (its `groups` / `sizes` / `corrupted` are optional).
  inv: { count: number; groups?: Record<string, string[]>; sizes?: Record<string, number>; corrupted?: Record<string, string> } | undefined,
  opts: { assetsRoot: string; usage: string },
): string {
  if (!inv?.count) return '';
  // Header states the pool ROOT, not that every row lives under it: callers may
  // pass the union of the pool and the files attached to this turn
  // (`effectiveAssetInventory`), whose paths are feature-relative and sit
  // wherever the user put them. Rows always print their full path.
  let block = `## Asset Files (real files on disk — asset pool root: ${opts.assetsRoot}/)\n`;
  block += `There are ${inv.count} real asset file(s). ${opts.usage}\n`;
  for (const [group, files] of Object.entries(inv.groups ?? {})) {
    if (files.length === 0) continue;
    // Full feature-relative path, not the basename: the group key is only the
    // FIRST segment below the pool root, so a basename loses the rest of the
    // path for anything nested deeper — and the path is what code must
    // reference. Size is included so a binary the model cannot read is still
    // quantifiable without inventing a number.
    const rendered = files.slice(0, 20).map((f) => {
      const bytes = inv.sizes?.[f];
      const label = bytes !== undefined ? `${f} (${formatByteSize(bytes)})` : f;
      return inv.corrupted?.[f] ? `${label} ⚠️ CORRUPTED — ${inv.corrupted[f]}` : label;
    });
    block += `- ${group}: ${rendered.join(', ')}${files.length > 20 ? ` … (+${files.length - 20})` : ''}\n`;
  }
  const corruptedCount = Object.keys(inv.corrupted ?? {}).length;
  if (corruptedCount > 0) {
    block += `⚠️ ${corruptedCount} asset(s) above are CORRUPTED on disk (see reasons). Do NOT consume or copy them as-is — report the defect and ask the user to re-upload the original file.\n`;
  }
  return block + '\n';
}

export function indexAssetPool(params: {
  featurePath?: string;
  assetsRoot: string;
  maxFiles?: number;
}): AssetInventory {
  const { featurePath, assetsRoot } = params;
  const empty: AssetInventory = { files: [], groups: {}, count: 0, sizes: {}, corrupted: {} };
  if (!featurePath) return empty;

  const maxFiles = params.maxFiles
    ?? parseInt(process.env.ANT_RUNTIME_ASSETS_INDEX_MAX || String(DEFAULT_MAX), 10);
  const poolAbs = path.join(featurePath, ...assetsRoot.split('/'));
  if (!fs.existsSync(poolAbs)) return empty;

  const files: string[] = [];
  const sizes: Record<string, number> = {};
  const corrupted: Record<string, string> = {};
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
        if (relToFeature && !relToFeature.startsWith('..')) {
          files.push(relToFeature);
          // Same Dirent walk, one extra stat — a binary the model cannot read is
          // one it can only reason about by size.
          try { sizes[relToFeature] = fs.statSync(abs).size; } catch { /* raced away */ }
          // Head-window corruption sniff (bounded by the same maxFiles cap).
          const defect = sniffCorruptedBinary(abs);
          if (defect) corrupted[relToFeature] = defect;
        }
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

  return { files, groups, count: files.length, sizes, corrupted };
}

/**
 * Is this artifact a file the job may PLACE (vs. a document it should read)?
 *
 * `kind === 'binary'` is the sniff verdict and covers every image, font, audio
 * file and model wherever the user put it. SVG is the one asset format that is
 * also text, so it is admitted by extension. That is the whole exception list —
 * do not grow it back into a directory/extension allowlist (doc 47).
 */
function isPlaceableAsset(a: { path: string; kind?: 'binary' | 'text' }): boolean {
  return a.kind === 'binary' || a.path.toLowerCase().endsWith('.svg');
}

/**
 * The real files this job may place: the domain asset pool UNION the binaries the
 * user attached to this turn, wherever they sit. Consumed by the execute 📦 block,
 * the decompose hint and the plan block — which could otherwise only ever name
 * `assets/{service,game}` paths (near-loading-brace, doc 47).
 *
 * Derived on READ, not stored: `state.assetInventory` is written at `resolve`,
 * the graph's ENTRY point, and the RAC artifacts do not exist until `detect` runs
 * later — a union computed there would always see an empty pool.
 *
 * `indexAssetPool` stays domain-scoped: I6 forbids observing the OTHER domain's
 * pool, not a file the user handed this job by name. Attachments group under
 * their first path segment so {@link formatAssetInventoryBlock} needs no case.
 */
export function effectiveAssetInventory(state: {
  assetInventory?: { files?: string[]; groups?: Record<string, string[]>; count?: number; sizes?: Record<string, number>; corrupted?: Record<string, string> };
  artifacts?: ReadonlyArray<{ path: string; kind?: 'binary' | 'text'; sizeBytes?: number }>;
}): AssetInventory {
  const pool = state.assetInventory;
  const files = [...(pool?.files ?? [])];
  const groups: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(pool?.groups ?? {})) groups[k] = [...v];
  const sizes: Record<string, number> = { ...(pool?.sizes ?? {}) };
  const corrupted: Record<string, string> = { ...(pool?.corrupted ?? {}) };

  const known = new Set(files);
  for (const a of state.artifacts ?? []) {
    if (!isPlaceableAsset(a) || known.has(a.path)) continue;
    known.add(a.path);
    files.push(a.path);
    if (a.sizeBytes !== undefined) sizes[a.path] = a.sizeBytes;
    const group = a.path.split('/')[0] || '(root)';
    (groups[group] ||= []).push(a.path);
  }

  return { files, groups, count: files.length, sizes, corrupted };
}
