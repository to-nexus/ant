/**
 * ArtifactPipeline
 *
 * Unified artifact selection + compaction pipeline.
 * Replaces per-caller documentResolver / designSelector / manual wrapping.
 *
 * Three public functions form the pipeline:
 *   selectArtifacts  — filter candidates by include patterns or taskType defaults
 *   compactArtifacts — shrink oversized artifacts to outline + tool hint
 *   resolveArtifacts — convenience: select then compact
 *
 * Pool extraction helpers (Phase 2):
 *   flattenDesignArtifacts — name→content map from system-design artifacts
 *   getDesignDocByPackageFromPool — lookup by package tag
 *   extractFirstDesign — first system-design artifact content
 *   hasSourceArtifact / getSourceContent — source/prd artifact access
 */

import type { ResolvedArtifact } from '@ant/shared';
import { ARTIFACT_PREFIX, DESIGN_DIR } from '@ant/shared';
import { compactContent } from '../../utils/contentCompactor';
import { normalizeTemplateDoc } from '../../utils/templateDetector';
import * as fs from 'fs';
import * as pathMod from 'path';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface ArtifactSelectionPolicy {
  taskType?: string;
  /** Path prefix patterns. Glob-style trailing `*` supported. */
  include?: string[];
}

export interface ArtifactCompactionConfig {
  /** Character count; artifacts above this are compacted to outline. */
  threshold: number;
  /** Tool name shown in the read hint. Default: 'read_file'. */
  toolHint?: string;
}

// ────────────────────────────────────────────────────────────────
// Selection
// ────────────────────────────────────────────────────────────────

function matchesInclude(artifactPath: string, patterns: string[]): boolean {
  return patterns.some(pattern => {
    if (pattern.endsWith('*')) {
      return artifactPath.startsWith(pattern.slice(0, -1));
    }
    return artifactPath === pattern || artifactPath.startsWith(pattern);
  });
}

/**
 * Filter candidate artifacts by policy.
 *
 * Priority:
 * 1. `taskType: 'verification'` → always empty (no docs needed)
 * 2. `include` present → exact path-prefix match
 * 3. taskType-based default rules (backward-compatible fallback)
 */
export function selectArtifacts(
  candidates: ResolvedArtifact[],
  policy: ArtifactSelectionPolicy,
): ResolvedArtifact[] {
  if (policy.taskType === 'verification') return [];

  if (policy.include?.length) {
    return candidates.filter(a => matchesInclude(a.path, policy.include!));
  }

  // taskType-based defaults (backward compat when include is absent)
  switch (policy.taskType) {
    case 'error':
      if (candidates.some(a => a.path.startsWith(ARTIFACT_PREFIX.SPEC))) {
        return candidates.filter(
          a => a.path.startsWith(ARTIFACT_PREFIX.SPEC) ||
               a.path.startsWith(ARTIFACT_PREFIX.API_CONTRACT),
        );
      }
      return [];

    case 'ui':
    case 'design-system':
      return candidates.filter(a => a.path.startsWith(ARTIFACT_PREFIX.UI));

    default:
      return candidates.filter(
        a => a.path.startsWith(ARTIFACT_PREFIX.DESIGN) || a.path.startsWith(ARTIFACT_PREFIX.SOURCES),
      );
  }
}

// ────────────────────────────────────────────────────────────────
// Compaction
// ────────────────────────────────────────────────────────────────

/**
 * Compact artifacts whose content exceeds `threshold`.
 * Small artifacts pass through unchanged.
 */
export function compactArtifacts(
  artifacts: ResolvedArtifact[],
  config: ArtifactCompactionConfig,
): ResolvedArtifact[] {
  const { threshold, toolHint = 'read_file' } = config;
  return artifacts.map(a => {
    if (!a.content || a.content.length <= threshold) return a;
    const result = compactContent(a.content, {
      threshold,
      label: a.label || a.path,
      filePath: a.path,
      toolHint,
    });
    return { ...a, content: result.content };
  });
}

// ────────────────────────────────────────────────────────────────
// Convenience: select + compact
// ────────────────────────────────────────────────────────────────

export function resolveArtifacts(
  candidates: ResolvedArtifact[],
  policy: ArtifactSelectionPolicy,
  compaction?: ArtifactCompactionConfig,
): ResolvedArtifact[] {
  const selected = selectArtifacts(candidates, policy);
  if (!compaction) return selected;
  return compactArtifacts(selected, compaction);
}

// ────────────────────────────────────────────────────────────────
// ArtifactPoolView — centralized typed access to the artifact pool
// ────────────────────────────────────────────────────────────────

/**
 * Typed read-only view over a flat ResolvedArtifact[] pool.
 *
 * All path matching is centralized here so that node-level code
 * never hard-codes artifact path prefixes.
 */
export class ArtifactPoolView {
  constructor(private readonly pool: ResolvedArtifact[]) {}

  /** Raw pool (for pipeline functions that need the array). */
  get all(): ResolvedArtifact[] { return this.pool; }
  get length(): number { return this.pool.length; }

  // ── Category filters ──

  get systemDesigns(): ResolvedArtifact[] {
    return this.pool.filter(a => a.path.startsWith(ARTIFACT_PREFIX.SYSTEM_DESIGN));
  }

  get specs(): ResolvedArtifact[] {
    return this.pool.filter(a => a.path.startsWith(ARTIFACT_PREFIX.SPEC));
  }

  get ui(): ResolvedArtifact[] {
    return this.pool.filter(a => a.path.startsWith(ARTIFACT_PREFIX.UI));
  }

  get sources(): ResolvedArtifact[] {
    return this.pool.filter(a => a.path.startsWith(ARTIFACT_PREFIX.SOURCES));
  }

  get apiContracts(): ResolvedArtifact[] {
    return this.pool.filter(a => a.path.startsWith(ARTIFACT_PREFIX.API_CONTRACT));
  }

  // ── Presence checks ──

  hasSystemDesign(): boolean { return this.pool.some(a => a.path.startsWith(ARTIFACT_PREFIX.SYSTEM_DESIGN)); }
  hasSpec(): boolean         { return this.pool.some(a => a.path.startsWith(ARTIFACT_PREFIX.SPEC)); }
  hasUi(): boolean           { return this.pool.some(a => a.path.startsWith(ARTIFACT_PREFIX.UI)); }
  hasSources(): boolean      { return this.pool.some(a => a.path.startsWith(ARTIFACT_PREFIX.SOURCES)); }

  // ── Aggregate metrics ──

  systemDesignSize(): number {
    return this.systemDesigns.reduce((s, a) => s + (a.content?.length || 0), 0);
  }

  // ── Name↔content maps ──

  /**
   * Flat name→content map from system-design artifacts.
   * Strips prefix + `.md` suffix.
   * e.g. `outputs/design/system/fe-system-main.md` → `fe-system-main`
   */
  flattenSystemDesigns(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const a of this.pool) {
      if (!a.path.startsWith(ARTIFACT_PREFIX.SYSTEM_DESIGN) || !a.content) continue;
      const name = a.path.slice(ARTIFACT_PREFIX.SYSTEM_DESIGN.length).replace(/\.md$/, '');
      map[name] = a.content;
    }
    return map;
  }

  /**
   * Look up design document by package tag.
   * `fe-{name}` → `fe-system-{name}.md`, `be-{name}` → `be-system-{name}.md`.
   */
  getDesignDocByPackage(pkg: string): string | undefined {
    let prefix: string;
    if (pkg.startsWith('fe-')) {
      prefix = `${ARTIFACT_PREFIX.FE_SYSTEM}${pkg.slice(3)}`;
    } else if (pkg.startsWith('be-')) {
      prefix = `${ARTIFACT_PREFIX.BE_SYSTEM}${pkg.slice(3)}`;
    } else {
      return undefined;
    }
    return this.pool.find(a => a.path === prefix || a.path === `${prefix}.md`)?.content;
  }

  /** First system-design artifact content (for display/logging). */
  firstDesignContent(): string | undefined {
    return this.pool.find(a => a.path.startsWith(ARTIFACT_PREFIX.SYSTEM_DESIGN))?.content;
  }

  /** Combined source/prd content. */
  sourceContent(): string | undefined {
    return this.pool.find(a => a.path === ARTIFACT_PREFIX.SOURCES)?.content;
  }

  /** Source artifacts as Record<filename, content> (legacy compat). */
  sourcesAsRecord(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const a of this.sources) {
      const name = a.path.startsWith('inputs/sources/')
        ? a.path.slice('inputs/sources/'.length)
        : a.path;
      if (a.content) map[name] = a.content;
    }
    return map;
  }

  /** Source filenames list. */
  sourceFileNames(): string[] {
    return this.sources.map(a => {
      const p = a.path;
      return p.startsWith('inputs/sources/') ? p.slice('inputs/sources/'.length) : p;
    });
  }

  /** Total character count across all source artifacts. */
  sourcesSize(): number {
    return this.sources.reduce((s, a) => s + (a.content?.length || 0), 0);
  }

  /** prd.md content (replaces sourceDocuments['prd.md']). */
  prdContent(): string | undefined {
    return this.pool.find(a => a.path === 'inputs/sources/prd.md')?.content;
  }

  /** Find a spec artifact by filename (e.g. `spec-login.md`). */
  findSpec(filename: string): ResolvedArtifact | undefined {
    return this.pool.find(a => a.path === `${ARTIFACT_PREFIX.SPEC}${filename}`);
  }
}

// ── Backward-compatible free functions (delegate to ArtifactPoolView) ──

export function flattenDesignArtifacts(artifacts: ResolvedArtifact[]): Record<string, string> {
  return new ArtifactPoolView(artifacts).flattenSystemDesigns();
}

export function getDesignDocByPackageFromPool(pkg: string, artifacts: ResolvedArtifact[]): string | undefined {
  return new ArtifactPoolView(artifacts).getDesignDocByPackage(pkg);
}

// ────────────────────────────────────────────────────────────────
// Design Job Pool Utilities (Phase 3: cross-job unification)
// ────────────────────────────────────────────────────────────────

/**
 * Strip feature-path prefix from a project-root-relative path.
 * e.g. 'features/proj/feat/outputs/design/ui/ui-tokens.json' → 'outputs/design/ui/ui-tokens.json'
 */
export function toFeatureRelative(filePath: string, featurePath: string): string {
  const featurePrefix = featurePath.replace(/^\//, '').replace(/\/?$/, '/');
  if (filePath.startsWith(featurePrefix)) return filePath.slice(featurePrefix.length);
  return filePath;
}

/**
 * Upsert artifacts into pool by path (same path → latest content wins).
 */
export function appendOrUpdatePool(
  pool: ResolvedArtifact[],
  newArtifacts: ResolvedArtifact[],
): ResolvedArtifact[] {
  const map = new Map(pool.map(a => [a.path, a]));
  for (const a of newArtifacts) map.set(a.path, a);
  return Array.from(map.values());
}

/**
 * Recursively scan outputs/design/ and return all non-template documents as ResolvedArtifact[].
 * Replaces the narrow DESIGN_FILE_PATTERNS approach that only covered 3 system-design patterns.
 */
export function scanDesignOutputs(featurePath: string): ResolvedArtifact[] {
  const designDirAbs = pathMod.join(featurePath, DESIGN_DIR);
  const artifacts: ResolvedArtifact[] = [];

  function walk(dir: string): void {
    let entries: import('fs').Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = pathMod.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile()) {
        try {
          const raw = fs.readFileSync(full, 'utf-8');
          const content = normalizeTemplateDoc(raw);
          if (content) {
            const relPath = pathMod.relative(featurePath, full).replace(/\\/g, '/');
            artifacts.push({ path: relPath, content, role: 'ref' });
          }
        } catch { /* skip unreadable */ }
      }
    }
  }

  walk(designDirAbs);
  return artifacts;
}

/**
 * Build a unified design artifact pool from heterogeneous sources.
 */
export function buildDesignArtifactPool(opts: {
  sourceDocuments?: Record<string, string>;
  designOutputs: ResolvedArtifact[];
  design?: string;
}): ResolvedArtifact[] {
  const pool: ResolvedArtifact[] = [];

  if (opts.sourceDocuments) {
    for (const [name, content] of Object.entries(opts.sourceDocuments)) {
      if (content?.trim()) {
        pool.push({ path: `inputs/sources/${name}`, content, role: 'context' });
      }
    }
  }

  for (const a of opts.designOutputs) {
    pool.push(a);
  }

  if (opts.design && !opts.designOutputs.some(a => a.path.startsWith(ARTIFACT_PREFIX.SYSTEM_DESIGN))) {
    pool.push({ path: `${ARTIFACT_PREFIX.SYSTEM_DESIGN}full`, content: opts.design, role: 'ref' });
  }

  return pool;
}
