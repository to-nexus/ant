import { UserContext } from '../types/user';
import type { ProjectProfile } from '@ant/shared';

/**
 * Preview Update Port
 *
 * Port for broadcasting preview-related state changes from Job Worker processes.
 * The code job's decompose node uses it to publish its `<techTier>` guess as a
 * HINT — a greenfield stand-in until the codebase exists. The codebase's own
 * manifests are authoritative (`ProjectProfileDetector`); the hint must never
 * overwrite observed facts, which `isMoreAuthoritativeProfile` enforces.
 *
 * Hexagonal Architecture: Core → Port ← Adapter (PreviewBroadcaster)
 */

// Re-exported from @ant/shared so existing backend imports keep working; the
// shared package is the SSOT (the frontend needs the same union).
export type { PreviewStructureType } from '@ant/shared';

/**
 * The persisted `PREVIEW_CONFIG` record — a DERIVED CACHE, never the authority.
 *
 * `connections` is re-derived from `.env.example` / `.env` on every read;
 * `projectProfile` / `structureType` are re-derived from the codebase manifests.
 * Cached values only serve cross-pod reads and transient workspace
 * unavailability.
 */
export interface PreviewConfigRecord {
  connections?: import('./portRegistry').ServiceConnection[] | null;
  structureType?: import('@ant/shared').PreviewStructureType | null;
  projectProfile?: ProjectProfile | null;
}

export interface PreviewUpdatePort {
  /**
   * Broadcast the decompose-inferred project profile hint to the frontend via
   * SSE, and persist it to the PREVIEW_CONFIG cache.
   *
   * @param projectId - Project identifier
   * @param featureName - Feature name
   * @param hint - The techTier-derived profile (`source: 'techtier-hint'`)
   * @param userContext - Optional user context for Cloud mode
   */
  broadcastProjectProfileHint(
    projectId: string,
    featureName: string,
    hint: ProjectProfile,
    userContext?: UserContext
  ): void;
}
