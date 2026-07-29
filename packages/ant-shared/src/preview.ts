/**
 * Preview project-facts contract — the OBSERVATION axis.
 *
 * `ProjectProfile` describes what a feature's `codebase/` actually IS, as read
 * from its manifests. It is deliberately distinct from `TechTier` (see
 * `tech-tier-registry.ts`), which is the DECISION axis: a closed enum
 * (`typescript | go` × `react | nextjs | react-native | nestjs | gin`) that the
 * user/LLM picks for what to BUILD and that keys prompt basis partials.
 *
 * The runtime vocabulary here is broader because `ProcessSpawner` /
 * `DependencyInstaller` dispatch on it (python/rust/java, django/fastapi/flask).
 * Keep them separate — narrowing this to TechTier's enum would break preview
 * spawning; widening TechTier would select prompt partials that don't exist.
 */

export type PreviewStructureType =
  | 'frontend-only'
  | 'backend-only'
  | 'fullstack'
  | 'monorepo';

/**
 * Provenance of a `ProjectProfile`. Rank: `'manifest'` > `'techtier-hint'`.
 *
 * `'manifest'` — read from the codebase (authoritative).
 * `'techtier-hint'` — the code job's `<techTier>` LLM guess. Greenfield only:
 *   it must never overwrite observed facts.
 */
export type ProjectProfileSource = 'manifest' | 'techtier-hint';

const SOURCE_RANK: Record<ProjectProfileSource, number> = {
  manifest: 2,
  'techtier-hint': 1,
};

export interface ProjectProfile {
  /**
   * Runtime language: `typescript | javascript | go | python | rust | java`.
   * `undefined` when no manifest identified one — NEVER the literal `'unknown'`
   * (callers branch on absence; a magic string silently hits the Node path).
   */
  language?: string;
  /**
   * Runtime framework, e.g. `nextjs | nuxt | remix | sveltekit | astro |
   * angular | vue | svelte | react | cra | react-native | nestjs | express |
   * fastify | koa | hono | django | fastapi | flask | streamlit | gin | fiber |
   * echo | chi | axum | actix-web | rocket | spring-boot | quarkus`.
   * Absent means there is no framework — not "unknown, go ask someone else".
   */
  framework?: string;
  structureType?: PreviewStructureType;
  source: ProjectProfileSource;
}

/**
 * The single owner of profile precedence, shared by the backend resolver and
 * the frontend store slice.
 *
 * A profile is an ATOMIC bundle: never field-merge across provenance. A
 * manifest result without a framework means the project has no framework, not
 * "borrow the hint's framework".
 */
export function isMoreAuthoritativeProfile(
  candidate?: ProjectProfile | null,
  incumbent?: ProjectProfile | null,
): boolean {
  if (!candidate) return false;
  if (!incumbent) return true;
  return SOURCE_RANK[candidate.source] > SOURCE_RANK[incumbent.source];
}

/**
 * Coerce a persisted/legacy record into a `ProjectProfile`. Records written
 * before provenance existed came from the decompose broadcaster, so a missing
 * `source` is treated as `'techtier-hint'`.
 */
export function asProjectProfile(
  raw: { language?: string; framework?: string; structureType?: PreviewStructureType; source?: ProjectProfileSource } | null | undefined,
): ProjectProfile | null {
  if (!raw) return null;
  if (!raw.language && !raw.framework && !raw.structureType) return null;
  return {
    ...(raw.language ? { language: raw.language } : {}),
    ...(raw.framework ? { framework: raw.framework } : {}),
    ...(raw.structureType ? { structureType: raw.structureType } : {}),
    source: raw.source ?? 'techtier-hint',
  };
}
