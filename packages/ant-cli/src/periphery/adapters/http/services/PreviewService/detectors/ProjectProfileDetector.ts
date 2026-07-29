/**
 * ProjectProfileDetector — the single owner of "what is this codebase", for the
 * preview/deploy runtime axis.
 *
 * The codebase is the SSOT: the Redis `PREVIEW_CONFIG` entry is a derived cache
 * (same contract the connections registry already declares). Detection runs at
 * read time on every preview endpoint and needs no fingerprint cache because it
 * reads manifests only — root plus depth-1 workspace `package.json` — and never
 * walks source or `node_modules`.
 *
 * Axis boundary: `CodebaseAnalyzer` / `EnvironmentDetector` serve the techTier
 * DECISION axis (closed `typescript | go` enum keying prompt partials) and
 * `BuildRunner.detectFramework` classifies build artifacts / env-var prefixes
 * (`vite`, `static`). Neither is a substitute for this one — see
 * `@ant/shared/preview`.
 */

import * as fs from 'fs';
import type { PreviewStructureType, ProjectProfile } from '@ant/shared';
import type { ProjectStructure } from '../types';
import { PackageDetector } from './PackageDetector';
import { ProjectStructureDetector } from './ProjectStructureDetector';
import { logger } from '../../../../../../utils/logger';

export interface DetectedProjectFacts {
  structureType: PreviewStructureType;
  /**
   * Repo-level representative profile: the entry package's, else the first
   * package's, else the root directory's. Always `source: 'manifest'` unless it
   * fell back to a supplied hint.
   */
  profile: ProjectProfile;
  canStart: boolean;
  /**
   * The structure detection result, returned so callers never re-run it — one
   * filesystem pass per request (`GET /preview-config` also needs it for
   * `ConnectionDetector`).
   *
   * Absent when the facts came from a hint rather than from observed manifests.
   * Callers MUST NOT synthesize an empty structure in that case: feeding one to
   * `ConnectionDetector` would overwrite the cached connections registry with an
   * empty list.
   */
  structure?: ProjectStructure;
}

export class ProjectProfileDetector {
  private structureDetector: ProjectStructureDetector;

  constructor(structureDetector?: ProjectStructureDetector, packageDetector?: PackageDetector) {
    this.structureDetector = structureDetector ?? new ProjectStructureDetector(packageDetector);
  }

  /**
   * Detect the project facts for a feature's codebase root.
   *
   * @param rootPath - Absolute path to the codebase root
   * @param fallback - Greenfield-only hint (the decompose `<techTier>` guess).
   *   Consulted ONLY when the filesystem holds no recognized manifest.
   * @returns null when the path holds no recognized project and no fallback applies
   */
  async detectFacts(rootPath: string, fallback?: ProjectProfile): Promise<DetectedProjectFacts | null> {
    if (!fs.existsSync(rootPath)) return null;

    const startability = ProjectStructureDetector.probeStartability(rootPath);
    if (!startability) {
      // Greenfield — no manifest to observe. The hint is all we have.
      return fallback ? this.factsFromHint(fallback) : null;
    }

    let structure: ProjectStructure;
    try {
      structure = await this.structureDetector.detect(rootPath, fallback);
    } catch (err: any) {
      logger.debug(`Structure detection failed for ${rootPath}: ${err?.message ?? err}`, {
        component: 'ProjectProfileDetector',
      });
      return fallback ? this.factsFromHint(fallback) : null;
    }

    const representative =
      structure.entry?.projectProfile ??
      structure.packages[0]?.projectProfile ??
      ProjectStructureDetector.detectDirectoryProfile(rootPath) ??
      { source: 'manifest' as const };

    return {
      structureType: structure.type,
      profile: { ...representative, structureType: structure.type },
      canStart: startability.canStart,
      structure,
    };
  }

  /**
   * Greenfield shape — no manifest exists, so structure detection is meaningless
   * and the preview cannot start. The hint's own `structureType` carries through;
   * `structure` is deliberately omitted (see the field's contract).
   */
  private factsFromHint(fallback: ProjectProfile): DetectedProjectFacts {
    const structureType = fallback.structureType ?? 'frontend-only';
    return {
      structureType,
      profile: { ...fallback, structureType },
      canStart: false,
    };
  }
}
