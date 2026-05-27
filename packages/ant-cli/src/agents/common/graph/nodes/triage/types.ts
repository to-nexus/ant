/**
 * Triage System Types — SSOT (single-tag intent lookup).
 *
 * Triage LLM emits only `<intentId>X</intentId>`. Everything else
 * (group / mode / domain) is derived from the matrix.
 * Progressibility (status / missingPrerequisites / choiceOptions /
 * suggestedAlternatives / displayMessage) lives on `DetectResult`.
 */

import type { ResolvableState } from '../resolve/types.js';
import type { ActionMetadata, IntentId, Mode, Domain } from '@ant/shared';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Choice System
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * ChoiceAction: 선택 후 수행할 액션
 * - proceed: 정상 진행 (조건 충족)
 * - proceedAnyway: 권장 조건 부족하지만 진행
 * - redirect: 다른 job으로 전환
 * - guide: 가이드 제공
 * - dismiss: 작업 취소
 */
export type ChoiceAction = 'proceed' | 'proceedAnyway' | 'redirect' | 'guide' | 'dismiss';

/**
 * ChoiceOptions: 선택지 구성
 */
export interface ChoiceOptions {
  positive: {
    label: string;      // "예", "전환", "그래도 진행"
    action: ChoiceAction;
  };
  negative: {
    label: string;      // "Dismiss", "취소"
    action: ChoiceAction;  // 'guide' or 'dismiss'
  };
  neutral?: {
    label: string;      // "현재 모드로 진행"
    action: ChoiceAction;  // 'proceed' - continue with current agent/job
  };
  fallbackGuide?: string;  // Optional - for 'guide' action
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Triage Result
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * TriageResult — SSOT (single-tag intent lookup).
 *
 * `triage()` populates these four fields and nothing else; progressibility
 * (status / missingPrerequisites / displayMessage / choiceOptions) is on
 * `DetectResult`.
 */
export interface TriageResult {
  /** Single LLM-emitted intent id, validated against INTENT_DEFINITIONS. */
  resolvedIntentId: IntentId;
  /** Derived from matrix — `'ask'` ⇔ intentGroup === 'ask'. */
  group: 'ask' | 'work';
  /** Derived from matrix — universal Mode (generate / refactor / explain). */
  mode: Mode;
  /** Derived: actionMetadata.domain ?? workspaceState hint ?? 'service'. */
  domain: Domain;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Workspace State
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * MonorepoManager: workspace marker that pins the root and the
 * invocation surface for dependency mutations.
 *
 * Naming follows the marker (not the package manager binary) so that
 * a single binary like `pnpm` that supports both single-package and
 * workspace mode is not conflated with the workspace marker itself.
 */
export type MonorepoManager =
  | 'pnpm-workspace'
  | 'npm-workspaces'
  | 'yarn-workspaces'
  | 'bun-workspaces'
  | 'cargo-workspace'
  | 'go-workspace'
  | 'uv-workspace';

/**
 * MonorepoLayout: detected workspace topology.
 *
 * Set by `analyzeWorkspace` when a workspace root marker is observed
 * inside `codebase/` (depth-1). Consumed by:
 *   - `workspaceDepSnapshotVars` → prompt variables for the
 *     `monorepo-install-locality` partial (Section B.3 of the
 *     test-code-script-wiring plan).
 *   - `codeCommandPolicy` install-locality guard → reject install
 *     commands issued from a member directory when the marker pins
 *     the root elsewhere (B.5).
 *
 * Single-package projects leave `WorkspaceState.monorepo` undefined.
 */
export interface MonorepoLayout {
  /**
   * Workspace root, relative to the feature directory. Conventionally
   * `'codebase'` (the canonical codebase root) — but stored explicitly
   * so consumers do not have to hard-code that constant.
   */
  rootPath: string;
  /**
   * Workspace marker manager — pinned by the file that declared the
   * workspace, not by the lockfile alone (a `package-lock.json` next
   * to a `pnpm-workspace.yaml` is still a pnpm workspace).
   */
  manager: MonorepoManager;
  /**
   * The actual file (or single key inside a file) that triggered
   * the detection. Surfaced in the prompt for debugging-grade
   * orientation; never used for control flow.
   */
  rootMarker: string;
  /**
   * Member globs / paths declared by the marker, relative to
   * `rootPath`. Empty list means "marker present but member set
   * unparseable" — treat as monorepo, but the prompt-side hint
   * cannot list members.
   */
  members?: string[];
}

/**
 * WorkspaceState: 워크스페이스 상태
 *
 * Path-presence flags use domain labels (`hasPlan`, `hasArchitecture*`,
 * `hasVisual*`, `hasAssets`, `hasMeta*`) — see Phase B canonical layout.
 */
export interface WorkspaceState {
  // Plan track — `plan/` (text-bearing files such as prd.md / gdd.md / tech-spec.md)
  hasPlan: boolean;              // any text file in plan/ (prd.md, gdd.md, etc.)
  planPath?: string;             // path to canonical plan file (prd.md or gdd.md)
  planFileCount?: number;        // number of text files in plan/
  planFileNames?: string[];      // e.g. ["prd.md", "tech-spec.md"]

  // Meta track — directives & evaluation reports
  hasMetaDirectives: boolean;    // ⚠️ true if meta/directives/{design,code}/directive.md exists OR chat directive supplied
  directivePath?: string;
  hasMetaEvals: boolean;         // meta/evals/ has any reports
  evalCount?: number;

  featurePath?: string;          // Feature directory path (for debug logging)

  // Visual track — `visual/`
  hasVisualUi: boolean;          // visual/ui/ant/ui-*.json (ant UiSource present)
  hasVisualGameArt: boolean;     // visual/game-art/ant/game-art-*.json present
  hasFigmaConfig: boolean;       // visual/ui/figma/figma.json with populated file value (workfile reference only; MCP reachability is NOT included — see code resolve's detectFigmaSource for the combined check)

  // Assets track — `assets/`
  hasAssets: boolean;
  assetCount?: number;

  // Architecture track — `architecture/`
  hasArchitectureSystem: boolean;     // architecture/system/*-system-*.md or api-contract-*.md
  systemDesignFileNames?: string[];   // e.g. ['fe-system-main.md', 'be-system-order.md', 'api-contract-public.md']
  hasArchitectureSpec: boolean;       // Any spec-*.md in architecture/spec/
  specDocCount?: number;
  specDocNames?: string[];            // e.g. ['spec-social-login.md', 'spec-payment.md']

  /**
   * Aggregate convenience flag — true when ANY architecture/visual artifact
   * is present (system / spec / ui / game-art). Derived; consumers may use
   * the granular flags above when they need finer routing.
   */
  hasDesignDoc: boolean;

  // Codebase track — disk presence OR vector index (Codebase Channel SSOT)
  hasCodebase: boolean;
  indexedFileCount?: number;
  /**
   * Path-only manifest of recognised entry points under `codebase/`
   * (e.g. `package.json`, `tsconfig.json`, `pyproject.toml`, `src/`,
   * `app/`, `README.md`). Populated when `hasCodebase=true` is reached
   * via disk walk. Surfaces in the codebase-channel partial so the LLM
   * has cheap orientation cues without reading any file body.
   * Empty / undefined when only the memory index detected the codebase.
   */
  codebaseEntryPoints?: string[];

  /**
   * Workspace topology of the `codebase/` tree, when a monorepo
   * marker is observed. Undefined for single-package projects.
   * See `MonorepoLayout` JSDoc for consumer wiring.
   */
  monorepo?: MonorepoLayout;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Graph State Extension
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * TriageableContext: Minimal context for triage node.
 * Architect uses full ProjectContext (subtype), Planner uses { featurePath }.
 */
export type TriageableContext = {
  featurePath?: string;
  project?: string;
  [key: string]: any;
};

/**
 * TriageableState: Triage 기능이 추가된 Graph State
 * Design/Code/Plan/Visual/Learn 그래프의 공통 베이스 타입
 *
 * Extends ResolvableState (resolve → triage → detect execution chain).
 * Fields common to ALL nodes (featurePath, context, directive, deps, etc.)
 * live in ResolvableState. Triage-specific fields live here.
 */
export interface TriageableState extends ResolvableState {
  // Triage state (triage-specific fields only; common fields are in ResolvableState)
  skipTriage?: boolean;
  triageResult?: TriageResult;
  workspaceState?: WorkspaceState;
}
