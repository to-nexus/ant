/**
 * DecisionTagRegistry — Single Source of Truth (SSOT-2)
 *
 * LLM-emitted decision tag lifecycle (7 stages: emit → parse → validate →
 * applyToState → retry → render → preamble) lives in one registry. New
 * decision tags MUST land here so the lifecycle machinery (registry-driven
 * iteration in `parseDecisionTags`, `decisionTagRetryFraming`,
 * `SpecialTagTransformer`) picks them up automatically.
 *
 * Phase 1 registered 3 tags: `domain`, `gameArtTier`, `gameContentTier`. Phase 2
 * (D12-revised) renames `gameArtTier`; the on-the-wire XML tag also flips so
 * prompts must emit `<gameArtTier>...</gameArtTier>`.
 */

import type {
  Domain,
  GameArtTier,
  GameContentTier,
} from '@ant/shared';
import {
  GAME_ART_TIER_AXIS_KEYS,
  GAME_ART_CONCEPT_VARIANTS,
  GAME_ART_PERSPECTIVE_VARIANTS,
  GAME_ART_ENTITY_CATALOG_VARIANTS,
  GAME_ART_MOTION_PATTERN_VARIANTS,
  GAME_ART_PARTICLE_PROFILE_VARIANTS,
  GAME_ART_PROJECTILE_POLICY_VARIANTS,
  GAME_ART_AUDIO_PROFILE_VARIANTS,
  GAME_GENRE_VARIANTS,
  GAME_CORE_LOOP_VARIANTS,
  GENRE_CORELOOP_MATRIX,
} from '@ant/shared';

// ============================================
// Public types
// ============================================

export type DecisionTagName = 'domain' | 'gameArtTier' | 'gameContentTier';

export interface DecisionTagViolation {
  tag: DecisionTagName;
  reason: 'missing' | 'invalid_value' | 'partial';
  observed?: string;
  message: string;
}

export class DecisionTagViolationError extends Error {
  readonly violations: DecisionTagViolation[];
  constructor(violations: DecisionTagViolation[]) {
    super(`Decision tag violations: ${violations.map(v => `${v.tag}=${v.reason}`).join(', ')}`);
    this.name = 'DecisionTagViolationError';
    this.violations = violations;
  }
}

/**
 * Parsed tag result. Each tag may produce a different shape; the registry
 * uses a tagged union so consumers can switch on `name`.
 */
export type ParsedDecisionTag =
  | { name: 'domain'; value: Domain }
  | { name: 'gameArtTier'; value: GameArtTier }
  | { name: 'gameContentTier'; value: GameContentTier };

// ============================================
// Tag definitions
// ============================================

interface ParseOk<T> { ok: true; value: T }
interface ParseErr { ok: false; reason: 'missing' | 'invalid_value' | 'partial'; observed?: string }
type ParseResult<T> = ParseOk<T> | ParseErr;

interface DecisionTagDef<TValue> {
  name: DecisionTagName;
  /** XML tag pattern. The tag body is captured in group 1. */
  pattern: RegExp;
  /** Default applied when retries exhaust without a parseable value (10.4 — graceful degrade). */
  defaultOnRetryExhaustion?: TValue;
  /** Phase 1 retry policy — `inline` re-prompts in the same node, `none` falls back silently. */
  retryPolicy: 'inline' | 'none';
  /** Parser: raw match body → typed value or structured error. */
  parse: (raw: string) => ParseResult<TValue>;
}

const domainTagDef: DecisionTagDef<Domain> = {
  name: 'domain',
  pattern: /<domain>\s*([\s\S]*?)\s*<\/domain>/i,
  defaultOnRetryExhaustion: 'service',
  retryPolicy: 'none',
  parse: (raw) => {
    const v = raw.trim().toLowerCase();
    if (v === 'game' || v === 'service') return { ok: true, value: v };
    return { ok: false, reason: 'invalid_value', observed: raw };
  },
};

/**
 * gameArtTier emission body grammar:
 *   Phase 3:  `concept=flatMinimal,perspective=2d`
 *   Phase 4:  `concept=flatMinimal,perspective=2d,entityCatalog=standard,
 *             motionPattern=subtle,particleProfile=light,projectilePolicy=none,
 *             audioProfile=procedural`
 *
 * Phase 4 (this revision) — the parser validates ALL 7 axes against their
 * registry-backed candidate sets. Unknown axes are dropped silently
 * (forward-compat); unknown values for known axes are dropped (the
 * registry-disk 1:1 invariant guarantees a `.md` partial exists for every
 * accepted value).
 */
const gameArtTierTagDef: DecisionTagDef<GameArtTier> = {
  name: 'gameArtTier',
  pattern: /<gameArtTier>\s*([\s\S]*?)\s*<\/gameArtTier>/i,
  // v8 (D30 + D32-revised) — perspective single-element (`'2d'`); concept
  // default `'flatMinimal'` is the most domain-agnostic of the 5 v9
  // concepts (works for match3 / slidingPuzzle / cardSolitaire alike).
  // Phase 4 (this revision) — the 5 new axes also carry conservative
  // defaults that work in css-only inline production.
  defaultOnRetryExhaustion: {
    concept: 'flatMinimal',
    perspective: '2d',
    entityCatalog: 'minimal',
    motionPattern: 'static',
    particleProfile: 'none',
    projectilePolicy: 'none',
    audioProfile: 'procedural',
  },
  retryPolicy: 'inline',
  parse: (raw) => {
    const out: GameArtTier = {};
    const body = raw.trim();
    if (!body) return { ok: false, reason: 'missing' };
    for (const part of body.split(',')) {
      const [k, v] = part.split('=').map(s => s.trim());
      if (!k || !v) continue;
      if (!(GAME_ART_TIER_AXIS_KEYS as readonly string[]).includes(k)) continue;
      switch (k) {
        case 'concept':
          if ((GAME_ART_CONCEPT_VARIANTS as readonly string[]).includes(v)) out.concept = v as GameArtTier['concept'];
          break;
        case 'perspective':
          if ((GAME_ART_PERSPECTIVE_VARIANTS as readonly string[]).includes(v)) out.perspective = v as GameArtTier['perspective'];
          break;
        case 'entityCatalog':
          if ((GAME_ART_ENTITY_CATALOG_VARIANTS as readonly string[]).includes(v)) out.entityCatalog = v as GameArtTier['entityCatalog'];
          break;
        case 'motionPattern':
          if ((GAME_ART_MOTION_PATTERN_VARIANTS as readonly string[]).includes(v)) out.motionPattern = v as GameArtTier['motionPattern'];
          break;
        case 'particleProfile':
          if ((GAME_ART_PARTICLE_PROFILE_VARIANTS as readonly string[]).includes(v)) out.particleProfile = v as GameArtTier['particleProfile'];
          break;
        case 'projectilePolicy':
          if ((GAME_ART_PROJECTILE_POLICY_VARIANTS as readonly string[]).includes(v)) out.projectilePolicy = v as GameArtTier['projectilePolicy'];
          break;
        case 'audioProfile':
          if ((GAME_ART_AUDIO_PROFILE_VARIANTS as readonly string[]).includes(v)) out.audioProfile = v as GameArtTier['audioProfile'];
          break;
      }
    }
    if (Object.keys(out).length === 0) return { ok: false, reason: 'invalid_value', observed: raw };
    return { ok: true, value: out };
  },
};

const gameContentTierTagDef: DecisionTagDef<GameContentTier> = {
  name: 'gameContentTier',
  pattern: /<gameContentTier>\s*([\s\S]*?)\s*<\/gameContentTier>/i,
  // v9 (D31-revised) — `match3` × `solve` is the most compact, css-only-
  // verifiable default (Bejeweled-style swap+cascade). The matrix admits
  // this pair (`match3 → [solve, collect]`).
  defaultOnRetryExhaustion: { genre: 'match3', coreLoop: 'solve' },
  retryPolicy: 'inline',
  parse: (raw) => {
    const out: GameContentTier = {};
    const body = raw.trim();
    if (!body) return { ok: false, reason: 'missing' };
    for (const part of body.split(',')) {
      const [k, v] = part.split('=').map(s => s.trim());
      if (!k || !v) continue;
      if (k === 'genre' && (GAME_GENRE_VARIANTS as readonly string[]).includes(v)) {
        out.genre = v as GameContentTier['genre'];
      } else if (k === 'coreLoop' && (GAME_CORE_LOOP_VARIANTS as readonly string[]).includes(v)) {
        out.coreLoop = v as GameContentTier['coreLoop'];
      }
    }
    // v9 (D31-revised / I9) — apply the genre×coreLoop matrix at parse
    // time. If the LLM emits a (genre, coreLoop) pair outside the matrix,
    // drop the coreLoop so retry / default-fill can reissue. This is a
    // pure lookup; no node-side branching.
    if (out.genre && out.coreLoop) {
      const allowed = GENRE_CORELOOP_MATRIX[out.genre];
      if (allowed && !(allowed as readonly string[]).includes(out.coreLoop)) {
        out.coreLoop = undefined;
      }
    }
    if (Object.keys(out).length === 0) return { ok: false, reason: 'invalid_value', observed: raw };
    return { ok: true, value: out };
  },
};

export const DECISION_TAG_REGISTRY: ReadonlyArray<DecisionTagDef<unknown>> = [
  domainTagDef,
  gameArtTierTagDef,
  gameContentTierTagDef,
] as const;

// ============================================
// parseDecisionTags — single registry-iterating parser
// ============================================

export interface ParseDecisionTagsResult {
  parsed: Partial<Record<DecisionTagName, unknown>>;
  violations: DecisionTagViolation[];
  /** Tags that were missing entirely from the response. */
  missing: DecisionTagName[];
}

/**
 * Parse all registered decision tags from an LLM response.
 *
 * Phase 1 semantics:
 *   - Missing tags are recorded under `missing` but do NOT throw — the
 *     matrix gate decides which tags should have been emitted, so the
 *     consumer (decompose / detect node) judges policy.
 *   - Invalid bodies produce `violations` AND drop the value from `parsed`.
 *   - Order-independent: the registry iteration order does not affect output.
 */
export function parseDecisionTags(raw: string): ParseDecisionTagsResult {
  const parsed: Partial<Record<DecisionTagName, unknown>> = {};
  const violations: DecisionTagViolation[] = [];
  const missing: DecisionTagName[] = [];

  for (const def of DECISION_TAG_REGISTRY) {
    const m = raw.match(def.pattern);
    if (!m) {
      missing.push(def.name);
      continue;
    }
    const result = def.parse(m[1]);
    if (result.ok) {
      parsed[def.name] = result.value;
    } else {
      violations.push({
        tag: def.name,
        reason: result.reason,
        observed: result.observed,
        message: `Decision tag "${def.name}" — ${result.reason}${result.observed ? `: "${result.observed}"` : ''}`,
      });
    }
  }
  return { parsed, violations, missing };
}

/**
 * Build framing text for a retry prompt. Lists missing/invalid tags so the
 * LLM can correct on the next attempt. Phase 1 keeps the framing terse —
 * Phase 3 will move to a richer per-tag template.
 */
export function decisionTagRetryFraming(
  missing: DecisionTagName[],
  violations: DecisionTagViolation[],
): string {
  if (missing.length === 0 && violations.length === 0) return '';
  const parts: string[] = ['', '---', '## Retry: decision tag contract violation', ''];
  if (missing.length > 0) {
    parts.push(`Missing tags: ${missing.map(t => `<${t}>...</${t}>`).join(', ')}.`);
  }
  if (violations.length > 0) {
    parts.push('Invalid bodies:');
    for (const v of violations) {
      parts.push(`- ${v.message}`);
    }
  }
  parts.push('', 'Re-emit the response with valid tag bodies in the same order. Do not wrap tags in code fences.');
  return parts.join('\n');
}

/**
 * Apply the registry's `defaultOnRetryExhaustion` to any tag still missing
 * after retries are exhausted (10.4 — graceful degrade). Returns a
 * partial map keyed by tag name.
 */
export function applyDecisionTagDefaults(
  parsed: Partial<Record<DecisionTagName, unknown>>,
  expected: ReadonlyArray<DecisionTagName>,
): Partial<Record<DecisionTagName, unknown>> {
  const out = { ...parsed };
  for (const name of expected) {
    if (out[name] !== undefined) continue;
    const def = DECISION_TAG_REGISTRY.find(d => d.name === name);
    if (def?.defaultOnRetryExhaustion !== undefined) {
      out[name] = def.defaultOnRetryExhaustion;
    }
  }
  return out;
}
