/**
 * Codespace Capability — SSOT for the `ANT_CODESPACE_ENABLED` switch.
 *
 * "Codespace" is the code-generation surface as one unit: canonical projects
 * (code / design / plan jobs, features, git), the Cloud IDE, and the
 * preview/deploy output those projects produce. An operator who runs Ant as a
 * custom-agent-only (AX) deployment makes ONE decision — "no codespace" — so
 * there is one env var, and `false` applies both consequences together:
 *
 *   - the IDE surface is not mounted (routes, `/ide` proxy, orchestrator,
 *     idle-check — no Docker socket / K8s client is touched at boot);
 *   - only `universal` projects can be created, re-typed, or run — canonical
 *     jobs on any project answer 400 `project-kind-disabled`.
 *
 * Per-surface switches (an IDE flag, a project-kind list) are deliberately
 * absent: a deployment that turned one off and forgot the other would still
 * run user code somewhere. `process.env.ANT_CODESPACE_ENABLED` is read here
 * and nowhere else. Default: enabled.
 */

import type { ProjectKind } from '@ant/shared';

const FALSY = new Set(['0', 'false', 'no', 'off']);

/** Lazy read on every call so tests can flip the flag without re-importing. */
export function isCodespaceEnabled(): boolean {
  const raw = process.env.ANT_CODESPACE_ENABLED;
  if (raw === undefined) return true;
  return !FALSY.has(raw.trim().toLowerCase());
}

/** IDE surface presence — an alias naming the intent at the mount sites; there is no separate env. */
export function isIdeEnabled(): boolean {
  return isCodespaceEnabled();
}

const ALL_KINDS: ReadonlySet<ProjectKind> = new Set<ProjectKind>(['canonical', 'universal']);
const UNIVERSAL_ONLY: ReadonlySet<ProjectKind> = new Set<ProjectKind>(['universal']);

export function enabledProjectKinds(): ReadonlySet<ProjectKind> {
  return isCodespaceEnabled() ? ALL_KINDS : UNIVERSAL_ONLY;
}

export function isProjectKindEnabled(kind: ProjectKind): boolean {
  return enabledProjectKinds().has(kind);
}

/** The kind a project gets when the caller names none. */
export function defaultProjectKind(): ProjectKind {
  return isCodespaceEnabled() ? 'canonical' : 'universal';
}

export const PROJECT_KIND_DISABLED_CODE = 'project-kind-disabled' as const;

export class ProjectKindDisabledError extends Error {
  readonly code = PROJECT_KIND_DISABLED_CODE;
  constructor(public readonly kind: ProjectKind) {
    super(
      `Project kind "${kind}" is disabled on this deployment (ANT_CODESPACE_ENABLED=false) — ` +
        `only ${[...enabledProjectKinds()].join(', ')} projects are available`,
    );
    this.name = 'ProjectKindDisabledError';
  }
}

export function assertProjectKindEnabled(kind: ProjectKind): void {
  if (!isProjectKindEnabled(kind)) throw new ProjectKindDisabledError(kind);
}
