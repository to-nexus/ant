/**
 * execution-context-discipline — styling-graph producer-closure lock.
 *
 * Root-cause guard for the "compiles green but visually dead" UI defect
 * class (classboard `proud-flowing-rivet`): shell/nav components reference
 * global CSS classes whose producer stylesheet is never created/imported,
 * yet typecheck/build/test stay green because a class name is a string with
 * no import edge.
 *
 * The fix lives entirely in `execution-context-discipline.md`:
 *   - §2 Integrator graph integrity gains a styling-graph closure duty
 *     (the integrator that owns a root closes BOTH the runtime-import graph
 *     AND the styling graph; creates the producer if missing; closes each
 *     sibling root independently).
 *   - §4 Surface fidelity gains the emit-side reciprocal of its existing
 *     consumer-read rule for no-import-edge hooks.
 *
 * This partial is NOT pushed by AutoInjectionResolver — its reach is the two
 * static `{{> }}` include sites below. Those two sites are exactly the
 * authoring path (default execute variant + default plan), so locking both
 * the partial body and the include sites prevents a regression that would
 * (a) revert §2 to runtime-only, or (b) move the partial out of the
 * authoring-path templates.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');
const PARTIAL = 'jobs/code/base/injections/execution-context-discipline';

describe('execution-context-discipline — styling-graph closure', () => {
  let adapter: FilePromptAdapter;
  let partial: string;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
    partial = await adapter.render(PARTIAL, {});
  });

  describe('§2 Integrator graph integrity — styling graph', () => {
    it('declares the styling graph closes at the owned entry', () => {
      expect(partial).toContain('styling graph closes at this entry');
    });

    it('binds every referenced global selector to a reachable stylesheet producer', () => {
      const lower = partial.toLowerCase();
      expect(lower).toContain('global class');
      expect(lower).toContain('root-container selector');
      expect(lower).toContain('resolve');
      expect(lower).toContain('stylesheet');
    });

    it('mandates creating the producer when none exists (not deferring to another task)', () => {
      expect(partial).toContain('create the producer and import it at this entry');
    });

    it('requires closing the styling graph at EACH sibling entry independently', () => {
      // The classboard defect: one surface wired, sibling left unstyled.
      const lower = partial.toLowerCase();
      expect(lower).toContain('sibling');
      // tolerate markdown emphasis around "each" (**each** entry)
      expect(lower).toMatch(/each\*{0,2}\s+entry/);
    });

    it('frames an unproduced referenced selector as a dangling-import-equivalent open contract', () => {
      const lower = partial.toLowerCase();
      expect(lower).toContain('open contract');
      expect(lower).toContain('dangling import');
    });
  });

  describe('§4 Surface fidelity — emit reciprocal', () => {
    it('keeps the existing consumer-read rule for no-import-edge stylesheet classes', () => {
      // Pre-existing line 60 — emit reciprocal must COMPLEMENT, not replace it.
      expect(partial).toContain('stringly-typed vocabularies with no import edge');
    });

    it('adds the emit-side obligation (producer must exist when you emit a hook)', () => {
      expect(partial).toContain('reciprocal obligation');
      const lower = partial.toLowerCase();
      expect(lower).toContain('emitting');
      // Closure execution is delegated to §2, not duplicated here.
      expect(lower).toContain('styling-graph duty');
    });

    it('forbids fabricating a shared-frame producer at the consumer call site', () => {
      const lower = partial.toLowerCase();
      expect(lower).toContain('fabricate the producer');
      expect(lower).toContain("owning band's gap");
    });
  });

  describe('FPOP/SBS — body stays platform-neutral (universal partial)', () => {
    it('names no framework / styling-library / build-tool literal', () => {
      // The partial is branch-axis: none (universal). Framework-specific
      // syntax lives in techTier partials, never here.
      expect(partial).not.toMatch(/\bnext\.?js\b/i);
      expect(partial).not.toMatch(/\btailwind\b/i);
      expect(partial).not.toMatch(/\bglobals\.css\b/i);
      expect(partial).not.toMatch(/@import\b/);
      expect(partial).not.toMatch(/\bsvelte/i);
    });
  });

  describe('include-site reach — authoring path only', () => {
    it('default execute variant rules include the styling-closure language', async () => {
      const rendered = await adapter.render('jobs/code/nodes/execute/variants/default/rules', {
        hasTools: true,
      });
      expect(rendered).toContain('styling graph closes at this entry');
    });

    it('default plan rules include the styling-closure language', async () => {
      const rendered = await adapter.render('jobs/code/nodes/plan/rules', {
        hasTools: true,
      });
      expect(rendered).toContain('styling graph closes at this entry');
    });
  });
});
