import { Session, SessionRun, SessionArtifacts, SessionState } from "../types";
import type {
  SessionableJobType,
  FeatureLine,
  FeatureUserTurnLine,
  FeatureUserTurnMetaLine,
  FeatureBreadcrumbLine,
  FeatureBoundaryLine,
  ChatLine,
  LogJobType,
} from '@ant/shared';

/**
 * Session Port
 * 
 * Manages feature development sessions with run-by-run history.
 * Sessions are stored in the workspace directory structure:
 * workspace/{project}/{feature}/sessions/{agent}/{job}.json
 * 
 * Each sessionable job type (design, code, learn, planning) maintains its own session file.
 * Ask jobs don't have sessions.
 * 
 * This port follows the Hexagonal Architecture pattern:
 * - Interface (Port) defined in core
 * - Implementation (Adapter) in periphery
 */
export interface SessionPort {
  /**
   * Load an existing session or create a new one
   * @param project - Project name
   * @param feature - Feature name
   * @param job - Sessionable job type (design, code, learn, planning)
   * @returns Session object
   */
  load(project: string, feature: string, job: SessionableJobType): Promise<Session>;
  
  /**
   * Save the entire session
   * @param session - Complete session object
   * @param job - Sessionable job type
   */
  save(session: Session, job: SessionableJobType): Promise<void>;
  
  /**
   * Add a new run to the session
   * @param project - Project name
   * @param feature - Feature name
   * @param job - Sessionable job type
   * @param run - Run data to add
   */
  addRun(project: string, feature: string, job: SessionableJobType, run: SessionRun): Promise<void>;
  
  /**
   * Update session artifacts
   * @param project - Project name
   * @param feature - Feature name
   * @param job - Sessionable job type
   * @param artifacts - Artifacts to merge
   */
  updateArtifacts(project: string, feature: string, job: SessionableJobType, artifacts: Partial<SessionArtifacts> & { state?: Partial<SessionState> }): Promise<void>;
  
  /**
   * Get the last run from the session
   * @param project - Project name
   * @param feature - Feature name
   * @param job - Sessionable job type
   * @returns Last run or null if session is empty
   */
  getLastRun(project: string, feature: string, job: SessionableJobType): Promise<SessionRun | null>;
  
  /**
   * Check if a session exists
   * @param project - Project name
   * @param feature - Feature name
   * @param job - Sessionable job type
   * @returns True if session file exists
   */
  exists(project: string, feature: string, job: SessionableJobType): Promise<boolean>;

  // ═══════════════════════════════════════════════════════════════════
  // feature.jsonl / chat.jsonl — context & UI log (append-only JSONL)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Append a generic line to feature.jsonl or chat.jsonl.
   */
  appendLine(file: 'feature' | 'chat', line: FeatureLine | ChatLine): Promise<void>;

  /**
   * Append a user_turn atomically — feature.jsonl (unless skipFeature) + chat.jsonl copy.
   * Ask jobtype callers pass skipFeature=true.
   */
  appendUserTurn(line: FeatureUserTurnLine, options?: { skipFeature?: boolean }): Promise<void>;

  /**
   * Append a user_turn_meta patch line (executionTier).
   * Written by each job's Tier Entry Node after the LLM emits
   * `<executionTier>`. Fixed-tier jobs (learn / ask / design
   * explain / design fallback) also append this with Tier 0 Reflex.
   */
  appendUserTurnMeta(line: FeatureUserTurnMetaLine): Promise<void>;

  /**
   * Append a breadcrumb line to feature.jsonl (T3).
   */
  appendBreadcrumb(line: FeatureBreadcrumbLine): Promise<void>;

  /**
   * Append a boundary line + collapse prior user_turn/user_turn_meta lines.
   * The primary Collapse mechanism.
   */
  appendBoundary(line: FeatureBoundaryLine): Promise<void>;

  /**
   * Load feature.jsonl since latest boundary.
   * Returns T2 (user_turn + user_turn_meta after boundary) + all T3 (breadcrumbs).
   */
  loadSinceBoundary(): Promise<{
    userTurns: FeatureUserTurnLine[];
    userTurnMetas: FeatureUserTurnMetaLine[];
    breadcrumbs: FeatureBreadcrumbLine[];
  }>;

  /**
   * Load chat.jsonl lines by turnId (UI).
   */
  loadChatByTurnIds(turnIds: string[]): Promise<ChatLine[]>;

  /**
   * Load chat.jsonl lines by jobType (UI filtering).
   */
  loadChatByJobType(jobTypes: LogJobType[]): Promise<ChatLine[]>;

  /**
   * Load ALL chat.jsonl lines (UI initial load).
   * Supports optional sinceTs (ISO 8601) for incremental fetching.
   * Collapsed lines are excluded.
   */
  loadAllChat(opts?: { sinceTs?: string; jobTypes?: LogJobType[] }): Promise<ChatLine[]>;

  /**
   * Load ALL breadcrumb lines from feature.jsonl (UI timeline).
   * Collapsed lines are excluded. Order preserved (append order = chronological).
   */
  loadAllBreadcrumbs(): Promise<FeatureBreadcrumbLine[]>;

  /**
   * Load ALL user_turn + user_turn_meta lines from feature.jsonl
   * (UI tier badge — §18 `tier_ui_badge`).
   *
   * Unlike `loadSinceBoundary`, this ignores the boundary cursor so the UI
   * can render tier badges on every non-collapsed turn, including ones
   * that survived the latest Hard Reset but are still visible in trace.
   * Collapsed lines are excluded.
   */
  loadFeatureTurnMeta(): Promise<{
    userTurns: FeatureUserTurnLine[];
    userTurnMetas: FeatureUserTurnMetaLine[];
  }>;

  /**
   * Mark feature.jsonl lines with the given jobId as collapsed — Job-tab
   * clear. Leaves chat.jsonl intact (UI history preserved). Sibling jobs
   * of the same jobType are not affected because each has a distinct
   * jobId.
   */
  collapseByJobId(jobId: string): Promise<void>;

  /**
   * Mark ALL chat.jsonl lines as collapsed — Chat Clear / Sweep.
   *
   * `feature.jsonl` (LLM context SSOT) is intentionally preserved so the
   * conversation can continue after a chat clear. Hard Reset does NOT go
   * through here — the `/context/reset` HTTP handler physically unlinks
   * every session file via `clearCanonicalDirectory`.
   */
  collapseChatLog(): Promise<void>;
}
