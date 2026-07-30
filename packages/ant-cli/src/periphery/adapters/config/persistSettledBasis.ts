import fs from 'fs';
import path from 'path';
import { sanitizeGameArtTier, sanitizeVisualTier } from '@ant/shared';
import type { GameArtTier, VisualTier } from '@ant/shared';

/**
 * persistSettledBasis — write-once persistence of settled visual tiers into
 * the workspace `config.json` (`WorkspaceConfig.basis`).
 *
 * Single owner for the "settled basis" write path. Called from the two
 * decompose funnels that finalize tier decisions (code decompose STEP 6.65,
 * design game-art decompose tag-apply). Read-back happens at detect
 * (`seedBasisFromWorkspace`) so subsequent jobs carry the stored tiers as
 * authoritative instead of re-inferring per job — LLM re-inference at
 * temperature > 0 flipped `perspective` 2d→3d on an unchanged codebase
 * (focal-molding-board).
 *
 * Semantics per tier (gameArtTier / visualTier):
 *  - explicit (user wizard selection) present → overwrite the stored tier
 *    (the user's choice is the new settled value);
 *  - otherwise → fill only when the stored tier is absent (write-once; an
 *    LLM-settled value never clobbers a previously stored decision).
 *
 * Values pass the registry whitelist sanitizers before landing on disk.
 * Operates on the RAW config.json body (not the merged `ConfigPort.load`
 * view) so llmModels merge defaults are never baked into the user's file.
 * Never throws — persistence is best-effort; a failure only means the next
 * job re-infers once more.
 */
export function persistSettledBasis(
  settled: { gameArtTier?: GameArtTier; visualTier?: VisualTier },
  opts?: {
    /** User wizard selections — overwrite semantics for the tiers present. */
    explicit?: { gameArtTier?: GameArtTier; visualTier?: VisualTier };
    /** Project root containing config.json. Defaults to ANT_PROJECT_PATH. */
    projectPath?: string;
  },
): boolean {
  try {
    const projectPath = opts?.projectPath ?? process.env.ANT_PROJECT_PATH;
    if (!projectPath) return false;
    const configPath = path.join(projectPath, 'config.json');
    if (!fs.existsSync(configPath)) return false;

    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    const basis: Record<string, unknown> =
      raw.basis && typeof raw.basis === 'object' ? { ...(raw.basis as Record<string, unknown>) } : {};

    let changed = false;

    const explicitGat = sanitizeGameArtTier(opts?.explicit?.gameArtTier);
    const settledGat = sanitizeGameArtTier(settled.gameArtTier);
    if (explicitGat) {
      if (JSON.stringify(basis.gameArtTier) !== JSON.stringify(explicitGat)) {
        basis.gameArtTier = explicitGat;
        changed = true;
      }
    } else if (settledGat && !basis.gameArtTier) {
      basis.gameArtTier = settledGat;
      changed = true;
    }

    const explicitVt = sanitizeVisualTier(opts?.explicit?.visualTier);
    const settledVt = sanitizeVisualTier(settled.visualTier);
    if (explicitVt) {
      if (JSON.stringify(basis.visualTier) !== JSON.stringify(explicitVt)) {
        basis.visualTier = explicitVt;
        changed = true;
      }
    } else if (settledVt && !basis.visualTier) {
      basis.visualTier = settledVt;
      changed = true;
    }

    if (!changed) return false;
    raw.basis = basis;
    fs.writeFileSync(configPath, JSON.stringify(raw, null, 2));
    console.log(
      `💾 [Config] Settled basis persisted to config.json: ` +
      `gameArtTier=${basis.gameArtTier ? 'set' : '-'}, visualTier=${basis.visualTier ? 'set' : '-'}`,
    );
    return true;
  } catch (err) {
    console.warn('⚠️ [Config] persistSettledBasis failed (non-critical):', err);
    return false;
  }
}
