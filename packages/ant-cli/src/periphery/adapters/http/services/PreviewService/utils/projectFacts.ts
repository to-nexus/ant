/**
 * Project-facts resolution — the single owner of provenance precedence on the
 * backend read path.
 *
 * Both `GET /status` and `GET /preview-config` funnel through here so they can
 * never disagree about a workspace's `structureType` / `projectProfile`. Before
 * this existed, `/status` answered from an idle-only filesystem probe while
 * `/preview-config` answered from Redis, so the chip flipped across a
 * start/stop cycle.
 *
 * Profiles are ATOMIC bundles — see `isMoreAuthoritativeProfile` in
 * `@ant/shared/preview`. Never field-merge across provenance: a manifest result
 * without a framework means the project has no framework, not "borrow the
 * hint's framework" (which produced chimeras like `language: go` +
 * `framework: nextjs`).
 */

import {
  asProjectProfile,
  isMoreAuthoritativeProfile,
  type PreviewStructureType,
  type ProjectProfile,
} from '@ant/shared';
import type { DetectedProjectFacts } from '../detectors/ProjectProfileDetector';

/** A persisted candidate: runtime `PreviewState` or the `PREVIEW_CONFIG` cache. */
export interface PersistedProjectFacts {
  structureType?: PreviewStructureType | null;
  projectProfile?: ProjectProfile | { language?: string; framework?: string } | null;
}

export interface ResolveProjectFactsInput {
  /** Rank 1 — freshly observed manifests. */
  detected?: DetectedProjectFacts | null;
  /** Rank 2 — manifests observed at preview start, held on `PreviewState`. */
  runtime?: PersistedProjectFacts | null;
  /** Rank 3 — the `PREVIEW_CONFIG` derived cache (may hold a legacy hint). */
  cached?: PersistedProjectFacts | null;
  /** Preview is running / installing / starting — starting again is not offered. */
  isBusy: boolean;
}

export interface ProjectFactsResponse {
  structureType: PreviewStructureType | null;
  projectProfile: ProjectProfile | null;
  canStart: boolean;
}

function fromPersisted(p?: PersistedProjectFacts | null): ProjectProfile | null {
  if (!p) return null;
  const profile = asProjectProfile(p.projectProfile as any);
  if (profile) {
    return profile.structureType || !p.structureType
      ? profile
      : { ...profile, structureType: p.structureType };
  }
  // structureType alone, with no profile — a legacy bare broadcast.
  return p.structureType ? { structureType: p.structureType, source: 'techtier-hint' } : null;
}

export function resolveProjectFacts(input: ResolveProjectFactsInput): ProjectFactsResponse {
  const { detected, runtime, cached, isBusy } = input;

  // Rank order: fresh manifest > runtime PreviewState > PREVIEW_CONFIG cache.
  const candidates: Array<ProjectProfile | null> = [
    detected ? detected.profile : null,
    fromPersisted(runtime),
    fromPersisted(cached),
  ];

  let winner: ProjectProfile | null = null;
  for (const candidate of candidates) {
    // Strictly greater keeps rank as the tie-breaker among equal provenance.
    if (isMoreAuthoritativeProfile(candidate, winner)) winner = candidate;
  }

  return {
    structureType: winner?.structureType ?? null,
    projectProfile: winner,
    canStart: isBusy ? false : (detected?.canStart ?? false),
  };
}

/**
 * The write-back patch for the derived caches (`PREVIEW_CONFIG` and the runtime
 * `PreviewState`).
 *
 * Only OBSERVED facts are persisted — a hint must never be promoted into the
 * manifest slot, or the next read would rank a guess as authoritative and the
 * inversion this whole module exists to prevent would reappear from storage.
 */
export function observedFactsPatch(
  facts?: DetectedProjectFacts | null,
): { projectProfile: ProjectProfile; structureType: PreviewStructureType } | Record<string, never> {
  if (!facts || facts.profile.source !== 'manifest') return {};
  return { projectProfile: facts.profile, structureType: facts.structureType };
}

/**
 * Runtime language for spawn/install dispatch — SSOT shared by `ProcessSpawner`
 * and `DependencyInstaller`.
 *
 * `ProjectProfile.language` is optional (a Makefile-only project has none), so
 * the two cases must not collapse:
 *   profile present, language absent → `'unknown'`, i.e. the generic branch.
 *     Defaulting to Node here would run `npm run dev` in a directory with no
 *     `package.json`.
 *   profile absent entirely          → `'typescript'`, preserving the legacy
 *     default for rehydrated deploy packages that carry no profile.
 */
export function resolveSpawnLanguage(profile?: ProjectProfile | null): string {
  if (!profile) return 'typescript';
  return (profile.language ?? 'unknown').toLowerCase();
}
