/**
 * Plan-Overlay Domain Locality (Phase 3 — D27 / SBS regression)
 *
 * The job × domain plan overlays at
 *   `templates/jobs/plan/domain/{game,service}.md`
 * are gated on `domain === 'game'` and `domain === 'service'`
 * respectively. Under SBS (Scope-Bound Specificity) each file MUST
 * speak its own gate's vocabulary and MUST NOT leak vocabulary that
 * belongs to the sibling gate — otherwise the gate's information
 * payload is zero (game.md that talks like service.md is wasted, and
 * vice versa).
 *
 * Mechanics:
 *   1. Positive sanity — game.md must use game-design vocabulary in
 *      its plain text; service.md must use service / SaaS PRD
 *      vocabulary.
 *   2. Cross-pollution — game.md plain text MUST NOT mention service
 *      vocabulary, and service.md plain text MUST NOT mention game
 *      vocabulary. "Plain text" excludes backtick-wrapped tokens so
 *      the explicit "FORBIDDEN to use X / Y / Z" disclaimer at the
 *      end of each file is allowed.
 *
 * This is the plan-job analogue of `motion-locality.test.ts` (I5)
 * and the locality complement to `domain-branching-locality.test.ts`
 * (I1).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TEMPLATES_ROOT = path.resolve(__dirname, '../src/core/prompt/templates');

const GAME_FILE = path.join(TEMPLATES_ROOT, 'jobs/plan/domain/game.md');
const SERVICE_FILE = path.join(TEMPLATES_ROOT, 'jobs/plan/domain/service.md');

/**
 * Strip everything inside backticks (inline code spans). Disclaimer
 * sections cite cross-domain vocabulary as code spans on purpose; the
 * test only flags pollution in narrative prose.
 */
function plainText(src: string): string {
  return src
    .replace(/```[\s\S]*?```/g, '')   // fenced code blocks
    .replace(/`[^`\n]*`/g, '');        // inline code spans
}

// Word-boundary regex helpers. Case-insensitive because headings and
// prose mix capitalization.
function hasAny(text: string, words: readonly string[]): { hit: boolean; matched: string[] } {
  const matched: string[] = [];
  for (const w of words) {
    const re = new RegExp(`\\b${w.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
    if (re.test(text)) matched.push(w);
  }
  return { hit: matched.length > 0, matched };
}

const GAME_VOCAB = [
  'coreloop',
  'core loop',
  'coreLoop',
  '5-minute hook',
  '5-Minute Hook',
  'MDA',
  'fail condition',
  'playable verb',
  'playable verbs',
  'playtest',
  'progression curve',
  'GDD',
  'game design document',
  'mechanic',
  'mechanics',
  'aesthetic',
];

const SERVICE_VOCAB = [
  'RBAC',
  'ACL',
  'SLA',
  'persona',
  'personas',
  'non-functional',
  'audit',
  'retention',
  'PRD',
  'SaaS',
  'permissions',
];

describe('Plan-Overlay Domain Locality (D27 / SBS)', () => {
  it('plan game overlay uses game-design vocabulary in plain text (positive sanity)', () => {
    const src = fs.readFileSync(GAME_FILE, 'utf-8');
    const plain = plainText(src);
    const { hit, matched } = hasAny(plain, GAME_VOCAB);
    expect(hit, `game.md must use game-design vocabulary in plain text. Matched: ${matched.join(', ')}`).toBe(true);
    expect(matched.length).toBeGreaterThanOrEqual(3);
  });

  it('plan service overlay uses service / SaaS PRD vocabulary in plain text (positive sanity)', () => {
    const src = fs.readFileSync(SERVICE_FILE, 'utf-8');
    const plain = plainText(src);
    const { hit, matched } = hasAny(plain, SERVICE_VOCAB);
    expect(hit, `service.md must use service vocabulary in plain text. Matched: ${matched.join(', ')}`).toBe(true);
    expect(matched.length).toBeGreaterThanOrEqual(3);
  });

  it('plan game overlay must NOT leak service vocabulary into plain text', () => {
    const src = fs.readFileSync(GAME_FILE, 'utf-8');
    const plain = plainText(src);
    const { matched } = hasAny(plain, SERVICE_VOCAB);
    expect(
      matched,
      `game.md plain text contains service-domain vocabulary (move to backticks if quoting): ${matched.join(', ')}`,
    ).toEqual([]);
  });

  it('plan service overlay must NOT leak game vocabulary into plain text', () => {
    const src = fs.readFileSync(SERVICE_FILE, 'utf-8');
    const plain = plainText(src);
    const { matched } = hasAny(plain, GAME_VOCAB);
    expect(
      matched,
      `service.md plain text contains game-domain vocabulary (move to backticks if quoting): ${matched.join(', ')}`,
    ).toEqual([]);
  });

  it('both overlays exist in the post-D27 directory location', () => {
    expect(fs.existsSync(GAME_FILE), 'jobs/plan/domain/game.md must exist (D27 — moved out of basis/)').toBe(true);
    expect(fs.existsSync(SERVICE_FILE), 'jobs/plan/domain/service.md must exist (D27 — moved out of basis/)').toBe(true);
  });

  it('legacy basis/domain/ paths must NOT exist (D27 cleanup)', () => {
    const legacyGame = path.join(TEMPLATES_ROOT, 'jobs/plan/basis/domain/game.md');
    const legacyService = path.join(TEMPLATES_ROOT, 'jobs/plan/basis/domain/service.md');
    expect(fs.existsSync(legacyGame), 'jobs/plan/basis/domain/game.md should be moved to jobs/plan/domain/game.md').toBe(false);
    expect(fs.existsSync(legacyService), 'jobs/plan/basis/domain/service.md should be moved to jobs/plan/domain/service.md').toBe(false);
  });
});
