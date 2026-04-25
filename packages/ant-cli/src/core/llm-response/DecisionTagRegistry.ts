/**
 * DecisionTagRegistry — Single Source of Truth (SSOT-2, Phase 1)
 *
 * LLM-emitted decision tag lifecycle (7 stages: emit → parse → validate →
 * applyToState → retry → render → preamble) lives in one registry. New
 * decision tags MUST land here so the lifecycle machinery (registry-driven
 * iteration in `parseDecisionTags`, `decisionTagRetryFraming`,
 * `SpecialTagTransformer`) picks them up automatically.
 *
 * Phase 1 registers 3 NEW tags: `domain`, `artTier`, and `gameContentTier`.
 * The 5th-slot `gameEngine` lives inside the existing `<techTier>` JSON
 * (parsed in `responseParser.ts`) — the handoff §9 describes this as the
 * "5번째 슬롯" of `<techTier>`, NOT a separate tag. The existing 4 tags
 * (`executionTier`, `techTier`, `boundary`, `directHints`) remain in their
 * own callsites for now; migration into this registry is a Phase 3 task.
 *
 * Renderable tags are also wired through `SpecialTagTransformer` (the
 * Canonical Tag Rendering SSOT) — registry entries here describe how the
 * decompose / detect node consumes the tag; the transformer describes how
 * the chat surface formats or suppresses it.
 */

import type {
  Domain,
  ArtTier,
  GameContentTier,
} from '@ant/shared';
import {
  ART_TIER_AXIS_KEYS,
  ART_CONCEPT_VARIANTS,
  ART_PERSPECTIVE_VARIANTS,
  GAME_GENRE_VARIANTS,
  GAME_CORE_LOOP_VARIANTS,
} from '@ant/shared';

// ============================================
// Public types
// ============================================

export type DecisionTagName = 'domain' | 'artTier' | 'gameContentTier';

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
  | { name: 'artTier'; value: ArtTier }
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
 * artTier emission body grammar (Phase 1):
 *   `concept=sfFantasy,perspective=2d`        (Phase 1 — 2 axis only)
 *   `concept=sfFantasy,perspective=2d,entityCatalog=standard,...`  (Phase 3)
 *
 * Unknown axes / unknown values are dropped silently — the matrix gate +
 * graceful degrade keep the system safe even when LLM emits a future-axis
 * value that isn't in the registry yet.
 */
const artTierTagDef: DecisionTagDef<ArtTier> = {
  name: 'artTier',
  pattern: /<artTier>\s*([\s\S]*?)\s*<\/artTier>/i,
  defaultOnRetryExhaustion: { concept: 'modernCasual', perspective: '2d' },
  retryPolicy: 'inline',
  parse: (raw) => {
    const out: ArtTier = {};
    const body = raw.trim();
    if (!body) return { ok: false, reason: 'missing' };
    for (const part of body.split(',')) {
      const [k, v] = part.split('=').map(s => s.trim());
      if (!k || !v) continue;
      if (!(ART_TIER_AXIS_KEYS as readonly string[]).includes(k)) continue;
      // Phase 1 only validates the two filled axes; future-axis values are
      // accepted blindly (Phase 3 fills the variants).
      switch (k) {
        case 'concept':
          if ((ART_CONCEPT_VARIANTS as readonly string[]).includes(v)) out.concept = v as ArtTier['concept'];
          break;
        case 'perspective':
          if ((ART_PERSPECTIVE_VARIANTS as readonly string[]).includes(v)) out.perspective = v as ArtTier['perspective'];
          break;
        // Phase 3 axes — accept any string for forward compatibility, the
        // type system narrows on read so this is safe.
        case 'entityCatalog':       out.entityCatalog = v as ArtTier['entityCatalog']; break;
        case 'motionPattern':       out.motionPattern = v as ArtTier['motionPattern']; break;
        case 'particleProfile':     out.particleProfile = v as ArtTier['particleProfile']; break;
        case 'projectilePolicy':    out.projectilePolicy = v as ArtTier['projectilePolicy']; break;
        case 'audioProfile':        out.audioProfile = v as ArtTier['audioProfile']; break;
      }
    }
    if (Object.keys(out).length === 0) return { ok: false, reason: 'invalid_value', observed: raw };
    return { ok: true, value: out };
  },
};

const gameContentTierTagDef: DecisionTagDef<GameContentTier> = {
  name: 'gameContentTier',
  pattern: /<gameContentTier>\s*([\s\S]*?)\s*<\/gameContentTier>/i,
  defaultOnRetryExhaustion: { genre: 'casual', coreLoop: 'collect' },
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
    if (Object.keys(out).length === 0) return { ok: false, reason: 'invalid_value', observed: raw };
    return { ok: true, value: out };
  },
};

export const DECISION_TAG_REGISTRY: ReadonlyArray<DecisionTagDef<unknown>> = [
  domainTagDef,
  artTierTagDef,
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
