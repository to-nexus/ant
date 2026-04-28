/**
 * v8 (D24-revised) — `migrateGameArtToAntSubdir`
 *
 * One-shot, idempotent migration that lifts the flat
 * `visual/game-art/{game-art-tokens,game-art-assets,game-art-spec}.json`
 * layout into the canonical sub-sourced layout introduced in D24-revised:
 *
 *   visual/game-art/{X}.json   →  visual/game-art/ant/{X}.json
 *
 * Mirrors `migrateAssetsToDomain`'s shape (idempotent / pure FS / silent
 * noop on missing or already-migrated trees). Called from
 * `ensureCanonicalStructure` so every workspace boot reconciles the layout
 * automatically.
 *
 * Safety:
 *   - Idempotent — re-running on an already-migrated workspace is a noop.
 *   - Conservative — only `game-art-*.json` files at the parent flat level
 *     are moved. Files already under `ant/` / `figma/` / `handoff/` are
 *     left alone. Unrelated files at the parent are left alone too.
 *   - Pure FS — no DB / state mutation.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

const GAME_ART_DIR_REL = 'visual/game-art';
const ANT_SUBDIR = 'ant';
const SUB_SOURCES = new Set(['ant', 'figma', 'handoff']);

export type GameArtMigrationAction = 'moved' | 'collision' | 'failed';

export interface GameArtMigrationItem {
  /** Source path relative to feature root, e.g. `visual/game-art/game-art-tokens.json`. */
  fromRel: string;
  /** Destination path relative to feature root, e.g. `visual/game-art/ant/game-art-tokens.json`. */
  toRel: string;
  action: GameArtMigrationAction;
  reason?: string;
}

export interface MigrateGameArtToAntSubdirResult {
  /** True when no work was needed (no flat game-art-*.json files existed). */
  alreadyMigrated: boolean;
  items: GameArtMigrationItem[];
  stats: { moved: number; collision: number; failed: number };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function moveFileSafe(srcAbs: string, destAbs: string): Promise<GameArtMigrationAction> {
  const destExists = await pathExists(destAbs);
  if (destExists) {
    // Idempotency / collision rule: leave both source and destination alone.
    // Caller decides whether to escalate (the legacy file MAY have been
    // hand-edited after the user already produced a new ant/ artifact).
    return 'collision';
  }
  await fs.mkdir(path.dirname(destAbs), { recursive: true });
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
 * Run the migration. Idempotent — calling twice on the same workspace is
 * safe.
 */
export async function migrateGameArtToAntSubdir(params: {
  featurePathAbs: string;
}): Promise<MigrateGameArtToAntSubdirResult> {
  const { featurePathAbs } = params;
  const gameArtRootAbs = path.join(featurePathAbs, GAME_ART_DIR_REL);
  const items: GameArtMigrationItem[] = [];

  if (!fsSync.existsSync(gameArtRootAbs)) {
    return {
      alreadyMigrated: true,
      items,
      stats: { moved: 0, collision: 0, failed: 0 },
    };
  }

  let entries: fsSync.Dirent[];
  try {
    entries = await fs.readdir(gameArtRootAbs, { withFileTypes: true });
  } catch {
    return {
      alreadyMigrated: true,
      items,
      stats: { moved: 0, collision: 0, failed: 0 },
    };
  }

  const flatFiles = entries.filter(e =>
    e.isFile() &&
    e.name.startsWith('game-art-') &&
    e.name.endsWith('.json')
  );

  if (flatFiles.length === 0) {
    return {
      alreadyMigrated: true,
      items,
      stats: { moved: 0, collision: 0, failed: 0 },
    };
  }

  for (const file of flatFiles) {
    const fromRel = `${GAME_ART_DIR_REL}/${file.name}`;
    const toRel = `${GAME_ART_DIR_REL}/${ANT_SUBDIR}/${file.name}`;
    const fromAbs = path.join(gameArtRootAbs, file.name);
    const toAbs = path.join(gameArtRootAbs, ANT_SUBDIR, file.name);

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

  // Surface unrelated files at the flat level for diagnostic purposes —
  // do NOT touch them. They are likely stray uploads or legacy artifacts
  // outside the migration's scope.
  const unrelated = entries.filter(e =>
    e.isFile() &&
    !(e.name.startsWith('game-art-') && e.name.endsWith('.json'))
  );
  if (unrelated.length > 0) {
    // No-op — kept here as a comment-only diagnostic surface. The caller
    // can inspect the directory listing if needed.
  }

  // Tolerate stray sub-directories that are NOT in the canonical sub-source
  // set — leave them untouched. The canonical set is defined by
  // `SUB_SOURCES` (referenced for parity with the parent-level policy).
  void SUB_SOURCES;

  const stats = {
    moved: items.filter(i => i.action === 'moved').length,
    collision: items.filter(i => i.action === 'collision').length,
    failed: items.filter(i => i.action === 'failed').length,
  };

  return { alreadyMigrated: false, items, stats };
}
