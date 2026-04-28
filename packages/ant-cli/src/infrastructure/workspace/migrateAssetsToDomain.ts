/**
 * Phase 2 (D19-revised) — `migrateAssetsToDomain`
 *
 * One-shot, idempotent migration that lifts the legacy
 * `assets/{icons,images,misc}/*` flat layout into the canonical
 * domain-1:1 layout introduced in Phase 2:
 *
 *   service workspaces → `assets/service/{icons,images,misc}/*`
 *   game    workspaces → `assets/game/{icons,images,misc}/*`
 *
 * In addition, any `visual/ui/ant/ui-assets.json` is rewritten so its
 * `src` paths follow the relocated files. This way `code` jobs that
 * import the catalog continue resolving real files after migration.
 *
 * Safety:
 *   - Idempotent — re-running on an already-migrated workspace is a noop.
 *   - Conservative — heuristic-free. Every legacy entry is moved into the
 *     workspace's resolved domain pool. If the user intentionally placed
 *     a game asset on a `service` workspace (or vice versa), they must
 *     manually relocate it after migration. The returned report flags
 *     this so the FE can surface a notification.
 *   - Pure FS — no DB / state mutation. Callers are responsible for
 *     invoking it during workspace boot or when the user toggles domain.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import type { Domain } from '@ant/shared';

const LEGACY_CATEGORIES: ReadonlyArray<string> = ['icons', 'images', 'misc'];

export type MigrationAction = 'moved' | 'skipped' | 'collision' | 'failed';

export interface MigrationItem {
  /** Source path relative to workspace root, e.g. `assets/icons/foo.svg`. */
  fromRel: string;
  /** Destination path relative to workspace root, e.g. `assets/service/icons/foo.svg`. */
  toRel: string;
  action: MigrationAction;
  reason?: string;
}

export interface MigrateAssetsToDomainResult {
  domain: Domain;
  /** True when no work was needed (no legacy categories existed). */
  alreadyMigrated: boolean;
  items: MigrationItem[];
  /** Summary stats keyed by action. */
  stats: { moved: number; skipped: number; collision: number; failed: number };
  /** Sourced ui-assets.json src rewrites (best-effort, may be empty). */
  uiAssetsRewritten: number;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function moveFileSafe(srcAbs: string, destAbs: string): Promise<MigrationAction> {
  const destExists = await pathExists(destAbs);
  if (destExists) {
    // Idempotency / collision rule: leave the destination alone, leave the
    // source alone too. Caller decides whether to escalate to the user.
    return 'collision';
  }
  await fs.mkdir(path.dirname(destAbs), { recursive: true });
  // Try native rename first; fall back to copy+unlink for cross-device moves.
  try {
    await fs.rename(srcAbs, destAbs);
    return 'moved';
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'EXDEV') {
      await fs.copyFile(srcAbs, destAbs);
      await fs.unlink(srcAbs);
      return 'moved';
    }
    throw err;
  }
}

/**
 * Recursively walk a directory and yield file relative paths (slash-separated).
 */
async function walkFiles(rootAbs: string, baseAbs: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(rootAbs, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const childAbs = path.join(rootAbs, e.name);
    if (e.isDirectory()) {
      out.push(...(await walkFiles(childAbs, baseAbs)));
    } else if (e.isFile()) {
      out.push(path.relative(baseAbs, childAbs).split(path.sep).join('/'));
    }
  }
  return out;
}

/**
 * Best-effort rewrite of `ui-assets.json` `src` paths. Tolerant to
 * malformed JSON / missing file; returns the count of replacements.
 */
async function rewriteUiAssetsManifest(
  featurePathAbs: string,
  domain: Domain,
): Promise<number> {
  const manifestRel = 'visual/ui/ant/ui-assets.json';
  const manifestAbs = path.join(featurePathAbs, manifestRel);
  if (!(await pathExists(manifestAbs))) return 0;
  let raw: string;
  try {
    raw = await fs.readFile(manifestAbs, 'utf8');
  } catch {
    return 0;
  }
  let replacements = 0;
  let next = raw;
  for (const cat of LEGACY_CATEGORIES) {
    const fromPrefix = `assets/${cat}/`;
    const toPrefix = `assets/${domain}/${cat}/`;
    // Match the prefix as JSON-string content (not at byte level — avoids
    // stomping unrelated occurrences in inline svg, etc.).
    const re = new RegExp(`("(?:src|path)"\\s*:\\s*")${escapeRegExp(fromPrefix)}`, 'g');
    next = next.replace(re, (_match, p1) => {
      replacements++;
      return `${p1}${toPrefix}`;
    });
  }
  if (replacements === 0) return 0;
  try {
    await fs.writeFile(manifestAbs, next, 'utf8');
  } catch {
    return 0;
  }
  return replacements;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Run the migration. Idempotent — calling twice on the same workspace
 * is safe. Returns a structured report so the caller can surface it in
 * the UI (notification / log line).
 */
export async function migrateAssetsToDomain(params: {
  featurePathAbs: string;
  domain: Domain;
}): Promise<MigrateAssetsToDomainResult> {
  const { featurePathAbs, domain } = params;
  const assetsRootAbs = path.join(featurePathAbs, 'assets');
  const items: MigrationItem[] = [];
  let alreadyMigrated = true;
  let uiAssetsRewritten = 0;

  if (!fsSync.existsSync(assetsRootAbs)) {
    return {
      domain,
      alreadyMigrated: true,
      items,
      stats: { moved: 0, skipped: 0, collision: 0, failed: 0 },
      uiAssetsRewritten: 0,
    };
  }

  for (const cat of LEGACY_CATEGORIES) {
    const legacyDirAbs = path.join(assetsRootAbs, cat);
    if (!fsSync.existsSync(legacyDirAbs)) continue;
    const stat = fsSync.statSync(legacyDirAbs);
    if (!stat.isDirectory()) continue;

    alreadyMigrated = false;
    const relPaths = await walkFiles(legacyDirAbs, assetsRootAbs); // prefix = `${cat}/...`

    for (const rel of relPaths) {
      // rel = `${cat}/<rest>` — verify defensively, skip otherwise.
      if (!rel.startsWith(`${cat}/`)) continue;
      const rest = rel.slice(cat.length + 1);
      const fromRel = `assets/${rel}`;
      const toRel = `assets/${domain}/${cat}/${rest}`;
      const fromAbs = path.join(assetsRootAbs, rel);
      const toAbs = path.join(assetsRootAbs, domain, cat, rest);

      try {
        const action = await moveFileSafe(fromAbs, toAbs);
        items.push({ fromRel, toRel, action });
      } catch (err: unknown) {
        items.push({
          fromRel,
          toRel,
          action: 'failed',
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Try to clean up the now-empty legacy category directory. If anything
    // remains (subdirectories the user added, hidden files), leave it alone.
    try {
      const remaining = await fs.readdir(legacyDirAbs);
      if (remaining.length === 0) await fs.rmdir(legacyDirAbs);
    } catch {
      // best-effort; do not fail migration over a cleanup hiccup
    }
  }

  if (!alreadyMigrated) {
    uiAssetsRewritten = await rewriteUiAssetsManifest(featurePathAbs, domain);
  }

  const stats = {
    moved: items.filter(i => i.action === 'moved').length,
    skipped: items.filter(i => i.action === 'skipped').length,
    collision: items.filter(i => i.action === 'collision').length,
    failed: items.filter(i => i.action === 'failed').length,
  };

  return { domain, alreadyMigrated, items, stats, uiAssetsRewritten };
}
