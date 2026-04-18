/**
 * DeployMetaStore
 *
 * Persists deploy re-hydration metadata as `.deploy/meta.json` inside the
 * workspace directory. The workspace lives on EFS (ReadWriteMany), so the
 * meta survives pod restarts, rolling updates, and Redis TTL expiration.
 *
 * This is the source of truth for "can this deploy auto-wake?".
 * Redis is only a cache of the running state.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { DeployFramework } from '../../core/ports/portRegistry';

export interface DeployMeta {
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

function metaPath(workspacePath: string): string {
  return path.join(workspacePath, META_DIR, META_FILE);
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
      const meta = JSON.parse(raw) as DeployMeta;
      if (meta.version !== 1) return null;
      return meta;
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
