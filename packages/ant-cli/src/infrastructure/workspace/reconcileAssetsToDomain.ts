/**
 * Phase 2 (D19/D22) — `reconcileAssetsToDomain`
 *
 * Glue around the pure `migrateAssetsToDomain` helper. Two call sites:
 *
 *   1. **Workspace boot** (`ensureCanonicalStructure`) — every feature
 *      access auto-discovers `<projectPath>/config.json` to resolve
 *      `workspaceConfig.domain`, then runs the migration idempotently
 *      against the feature's `inputs/assets/`. Already-migrated features
 *      complete in O(1) (a single `existsSync` per legacy category).
 *
 *   2. **Domain toggle** (`ProjectCrudService.updateProjectConfig`) —
 *      after a config write that mutates `domain`, every feature in the
 *      project gets a one-shot migration so the new pool layout is
 *      reachable on the next agent turn.
 *
 * The helper is intentionally side-effect tolerant. Any failure to
 * resolve the domain (missing config.json, unparseable JSON, unexpected
 * tree shape) results in a silent noop — the caller's flow MUST NOT be
 * blocked by a migration probe.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { Domain } from '@ant/shared';
import {
  migrateAssetsToDomain,
  type MigrateAssetsToDomainResult,
} from './migrateAssetsToDomain';

const DEFAULT_DOMAIN: Domain = 'service';

/**
 * Auto-discover the project's domain from `<projectPath>/config.json`.
 *
 * Project layout (D17):
 *   <workspaces>/<org>/<user>/<projectId>/config.json
 *   <workspaces>/<org>/<user>/<projectId>/features/<featureName>/...
 *
 * Walks up from `featurePath` until a sibling `config.json` is found
 * (max 5 levels — guards against runaway traversal in malformed trees).
 * Returns `null` when no config or domain field is reachable.
 */
async function discoverProjectDomain(featurePath: string): Promise<Domain | null> {
  let current = path.resolve(featurePath);
  for (let depth = 0; depth < 5; depth++) {
    const parent = path.dirname(current);
    if (parent === current) break;
    const configPath = path.join(parent, 'config.json');
    try {
      const raw = await fs.readFile(configPath, 'utf8');
      const parsed = JSON.parse(raw) as { domain?: unknown };
      if (parsed?.domain === 'service' || parsed?.domain === 'game') {
        return parsed.domain;
      }
      // config.json found but no `domain` — workspace existed before D22
      // and never got upgraded; fall back to default.
      return DEFAULT_DOMAIN;
    } catch {
      // Either the file does not exist at this level, or it is
      // unreadable. Keep walking up.
    }
    current = parent;
  }
  return null;
}

/**
 * Reconcile a single feature's asset pool against the project's
 * declared domain. Idempotent — already-migrated features return
 * `alreadyMigrated=true` with zero stat counts.
 */
export async function reconcileAssetsToDomain(featurePathAbs: string): Promise<
  MigrateAssetsToDomainResult | null
> {
  const domain = await discoverProjectDomain(featurePathAbs);
  if (!domain) return null;

  try {
    return await migrateAssetsToDomain({ featurePathAbs, domain });
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(
      `[reconcileAssetsToDomain] migration aborted for ${featurePathAbs}: ${reason}`,
    );
    return null;
  }
}

/**
 * Reconcile every feature directly under a project's `features/`
 * subtree. Used after `WorkspaceConfig.domain` toggles so all features
 * pick up the new pool layout in one pass. Returns per-feature results
 * (best-effort — partial failures do NOT abort the loop).
 */
export async function reconcileProjectAssetsToDomain(params: {
  projectPathAbs: string;
  domain: Domain;
}): Promise<Record<string, MigrateAssetsToDomainResult | { error: string }>> {
  const { projectPathAbs, domain } = params;
  const featuresRoot = path.join(projectPathAbs, 'features');
  const out: Record<string, MigrateAssetsToDomainResult | { error: string }> = {};

  let entries: string[] = [];
  try {
    entries = await fs.readdir(featuresRoot);
  } catch {
    return out; // no features yet — nothing to migrate
  }

  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const featurePathAbs = path.join(featuresRoot, name);
    try {
      const stat = await fs.stat(featurePathAbs);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }
    try {
      out[name] = await migrateAssetsToDomain({ featurePathAbs, domain });
    } catch (err: unknown) {
      out[name] = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  return out;
}
