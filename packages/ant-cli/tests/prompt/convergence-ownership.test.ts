/**
 * Axis 1 — Convergence (shared-decision ownership) regression lock.
 *
 * RCA (classboard green-basing-helix): parallel tasks each decided locally a
 * thing siblings had to match (route/URL scheme, data-access ownership, shared
 * style primitive) → divergence (404s, layout-group split, god-repository,
 * unstyled sibling app). Fix is ONE generative principle, not N rules:
 *   - decompose rules.md "Shared Decisions" — a decision multiple units must
 *     agree on is owned by one producer (band) and consumed; recognition is a
 *     TEST, not a closed list (few-shot over-fit guard).
 *   - execution-context-discipline §4 — emitting a nav target requires the
 *     route to EXIST; entity routes keyed by id, not display name.
 *   - nextjs basis — a route outside a (group) loses that group's layout;
 *     nested routes live under the parent's group; missing route silently
 *     falls through to a sibling dynamic segment.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');
const DECOMPOSE_RULES = 'jobs/code/nodes/decompose/variants/default/rules';
const EXEC_CONTEXT = 'jobs/code/base/injections/execution-context-discipline';
const NEXTJS = 'jobs/code/basis/techTier/framework/nextjs';

const BASE_VARS: Record<string, any> = {
  directive: 'Build a multi-screen app',
  techTier: { language: 'typescript', stack: 'frontend' },
  hasExistingCode: false,
  codebaseFilePaths: [],
  fileList: '',
  hasDocuments: false,
  documents: [],
  hasCompactedArtifacts: false,
  hasErrorInDirective: false,
  hasUi: false,
  uiSource: undefined,
  hasRuntimeError: false,
  isExplicitPipeline: false,
  visualTierActive: false,
  gameArtTierActive: false,
  gameContentTierActive: false,
  domainTierActive: false,
  needsBoundaryClassification: false,
  specClarifyBypassed: false,
  intentClarifyDisabled: true,
};

describe('Axis 1 — convergence / shared-decision ownership', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  describe('decompose rules — Shared Decisions principle', () => {
    it('introduces the Shared Decisions principle owned by one producer task', async () => {
      const out = await adapter.render(DECOMPOSE_RULES, BASE_VARS);
      expect(out).toMatch(/## Shared Decisions/);
      expect(out).toMatch(/owned by exactly ONE producer task and consumed/i);
      // band assignment by dependency position reuses the existing mechanism
      expect(out).toMatch(/dependency POSITION/);
    });

    it('makes recognition a TEST, not a closed list (few-shot over-fit guard)', async () => {
      const out = await adapter.render(DECOMPOSE_RULES, BASE_VARS);
      // the governing test
      expect(out).toMatch(/would another unit have to make the SAME choice/i);
      // explicit non-exhaustiveness marker
      expect(out).toMatch(/NOT a closed checklist/i);
      // shapes identified by dependency RELATION, not by a named artifact
      expect(out).toMatch(/dependency RELATION/);
      expect(out).toMatch(/never by a specific file or class name/i);
    });

    it('frames the example shapes as relations (producer→consumer), not a fixed artifact roster', async () => {
      const out = await adapter.render(DECOMPOSE_RULES, BASE_VARS);
      expect(out).toMatch(/addressing \/ navigation scheme/i);
      expect(out).toMatch(/access contract \/ boundary/i);
      expect(out).toMatch(/cross-unit vocabulary \/ primitive/i);
      // each shape carries the "one produces, others depend" relation wording
      expect(out).toMatch(/one unit's .*is referenced by another|is called or consumed by another/i);
    });
  });

  describe('execution-context-discipline §4 — nav target must resolve to a real route', () => {
    it('makes an emitted navigation target valid only against an existing route, keyed by id', async () => {
      const out = await adapter.render(EXEC_CONTEXT, {});
      expect(out).toMatch(/navigation target is one of these hooks/i);
      expect(out).toMatch(/a path that some task actually authors in the route tree/i);
      expect(out).toMatch(/dead link/i);
      expect(out).toMatch(/stable id, never by a human-readable name/i);
    });
  });

  describe('nextjs basis — route-group layout inheritance + route existence', () => {
    it('teaches that a route outside a (group) loses that group layout and nested routes stay under the parent group', async () => {
      const out = await adapter.render(NEXTJS, {});
      expect(out).toMatch(/does NOT receive that group's layout/);
      expect(out).toMatch(/MUST live under the SAME group as its parent surface/);
    });

    it('teaches that a missing route silently falls through to a sibling dynamic segment, and entity routes are keyed by id', async () => {
      const out = await adapter.render(NEXTJS, {});
      expect(out).toMatch(/silently falls through to a sibling dynamic segment/);
      expect(out).toMatch(/keyed by id, never a display name/);
    });
  });
});
