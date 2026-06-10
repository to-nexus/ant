/**
 * DeployMetaStore
 *
 * Persists deploy re-hydration metadata as `.deploy/meta.json` inside the
 * workspace directory. The workspace lives on EFS (ReadWriteMany), so the
 * meta survives pod restarts, rolling updates, and Redis TTL expiration.
 *
 * This is the source of truth for "can this deploy auto-wake?".
 * Redis is only a cache of the running state.
 *
 * ── v1 → v2 schema migration ──
 * v1 stored a single deployed package directly on the meta object
 * (`framework`, `buildOutputDir`, `basePath`, `urlKey`). v2 introduces
 * `packages[]` so multi-frontend monorepos can rehydrate every static
 * server. `read()` transparently lifts v1 records into v2 shape in memory
 * — the on-disk file stays v1 until the next `write()`. This keeps the
 * upgrade path forward-only without requiring a one-shot migration job.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { DeployFramework } from '../../core/ports/portRegistry';
import type { DeployVisibility } from '@ant/shared';

export interface DeployMetaPackage {
  /** Original package name (e.g. "apps/web"). UI display value. */
  name: string;
  /** URL-safe identifier — derived via `packageSlug(name)` and deduped. */
  slug: string;
  framework: DeployFramework;
  /**
   * Absolute path to THIS package's directory inside the deploy workspace.
   * Used as `cwd` for `next start` on rehydration. For single-frontend
   * projects this equals `DeployMeta.workspacePath`.
   */
  workspacePath: string;
  /** Per-package build artifact directory (absolute). */
  buildOutputDir: string;
  /**
   * Public path prefix this package is served under.
   *   single-frontend: `/deploy/{4partUrlKey}`
   *   multi-frontend:  `/deploy/{4partUrlKey}--{slug}`
   */
  basePath: string;
  /** urlKey segment (4-part for single, 5-part for multi). */
  urlKey: string;
}

export interface DeployMeta {
  version: 2;
  tenantId: string;
  userId: string;
  projectId: string;
  feature: string;
  workspacePath: string;
  packages: DeployMetaPackage[];
  /**
   * Access visibility for this deploy build. Absent on records written
   * before the visibility field existed — `read()` defaults them to
   * `'public'` (the historical, always-served behavior).
   */
  visibility?: DeployVisibility;
  createdAt: string;
  updatedAt: string;
}

/** Legacy v1 layout — still readable so existing deploys can rehydrate. */
interface DeployMetaV1 {
  version: 1;
  tenantId: string;
  userId: string;
  projectId: string;
  feature: string;
  framework: DeployFramework;
  workspacePath: string;
  buildOutputDir: string;
  basePath: string;
  urlKey: string;
  createdAt: string;
  updatedAt: string;
}

const META_DIR = '.deploy';
const META_FILE = 'meta.json';
/**
 * Slug used when lifting v1 meta. v1 deploys are by definition single-package
 * (the legacy code couldn't produce more than one), so this slug is stable
 * and never collides with anything.
 */
const V1_LIFT_SLUG = 'root';

function metaPath(workspacePath: string): string {
  return path.join(workspacePath, META_DIR, META_FILE);
}

function liftV1(meta: DeployMetaV1): DeployMeta {
  return {
    version: 2,
    tenantId: meta.tenantId,
    userId: meta.userId,
    projectId: meta.projectId,
    feature: meta.feature,
    workspacePath: meta.workspacePath,
    packages: [
      {
        name: V1_LIFT_SLUG,
        slug: V1_LIFT_SLUG,
        framework: meta.framework,
        // v1 always built and served at the deploy workspace root.
        workspacePath: meta.workspacePath,
        buildOutputDir: meta.buildOutputDir,
        basePath: meta.basePath,
        urlKey: meta.urlKey,
      },
    ],
    visibility: 'public', // v1 deploys predate visibility — served publicly.
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
}

export class DeployMetaStore {
  async write(workspacePath: string, meta: DeployMeta): Promise<void> {
    const dir = path.join(workspacePath, META_DIR);
    await fs.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `${META_FILE}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(meta, null, 2), 'utf8');
    await fs.rename(tmp, metaPath(workspacePath));
  }

  async read(workspacePath: string): Promise<DeployMeta | null> {
    try {
      const raw = await fs.readFile(metaPath(workspacePath), 'utf8');
      const parsed = JSON.parse(raw) as DeployMeta | DeployMetaV1;
      if (parsed.version === 2) {
        // Records written before the visibility field default to public.
        if (parsed.visibility == null) parsed.visibility = 'public';
        return parsed;
      }
      if (parsed.version === 1) return liftV1(parsed);
      // Unknown / future version → ignore (caller will treat as "no meta").
      return null;
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async remove(workspacePath: string): Promise<void> {
    try {
      await fs.rm(metaPath(workspacePath), { force: true });
    } catch {
      /* best-effort */
    }
  }

  async exists(workspacePath: string): Promise<boolean> {
    return (await this.read(workspacePath)) !== null;
  }
}
