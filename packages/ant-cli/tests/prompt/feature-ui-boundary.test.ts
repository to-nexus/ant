/**
 * Axis 3 — feature/ui boundary correctness lock.
 *
 * RCA (classboard green-basing-helix): NOT the dominant cause (presentation was
 * wired), but a real latent policy defect:
 *   (a) "skeleton" mis-signals a non-functional stub.
 *   (b) the ui task's old "DOM contract" over-constrained it to visual
 *       attributes only — contradicting the intent that ui performs whatever
 *       the enhancement requires (hooks/deps/logic) while NOT regressing the
 *       feature's functional behavior, converging on existing infrastructure.
 *   (c) the feature task had no positive functional-completeness contract
 *       (search input unwired, permission buttons ungated were the instances).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');
const EXECUTE_BASE = 'jobs/code/nodes/execute/variants/default/base';
const OUTPUT_UNIT = 'jobs/code/nodes/decompose/variants/default/output-unit-splitting';

const BASE_VARS: Record<string, any> = {
  isSpecDriven: false,
  currentTaskIsFinal: false,
  referenceRequests: undefined,
  runtimeContext: '',
  hasUi: false,
};

describe('Axis 3 — feature/ui boundary', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  describe('ui task — visual-enhancement policy (not DOM-only)', () => {
    let out: string;
    beforeAll(async () => {
      out = await adapter.render(EXECUTE_BASE, {
        ...BASE_VARS,
        currentTask: { id: 'ui-x', type: 'ui' },
      });
    });

    it('frames the ui task as enhancement that may add supporting logic', () => {
      expect(out).toMatch(/UI TASK: Visual Enhancement Pass/);
      expect(out).toMatch(/MAY legitimately add presentational logic, hooks, state, or dependencies/);
    });

    it('requires functional non-regression and infrastructure convergence', () => {
      expect(out).toMatch(/Functional non-regression/);
      expect(out).toMatch(/MUST NOT regress/);
      expect(out).toMatch(/Converge on existing infrastructure/);
    });

    it('drops the old over-constraint and the "skeleton" framing', () => {
      expect(out).not.toMatch(/Apply visual styling to skeleton files/);
      expect(out).not.toMatch(/Adding, removing, or renaming DOM elements is NOT allowed/);
      // the ui block must not call its input a "skeleton"
      const uiBlock = out.slice(out.indexOf('UI TASK: Visual Enhancement Pass'));
      expect(uiBlock.toLowerCase()).not.toContain('skeleton');
    });
  });

  describe('feature task — functional completeness contract', () => {
    let out: string;
    beforeAll(async () => {
      out = await adapter.render(EXECUTE_BASE, {
        ...BASE_VARS,
        currentTask: { id: 'feat-x', type: 'feature' },
      });
    });

    it('adds a positive functional-completeness contract', () => {
      expect(out).toMatch(/### Functional Completeness/);
      expect(out).toMatch(/wire every interactive control/i);
      expect(out).toMatch(/implement permission\/role-gated rendering/i);
    });

    it('states the observable (controls work; role-restricted action gated by identity)', () => {
      expect(out).toMatch(/role-restricted action is present for an admitting identity and absent for a non-admitting one/i);
    });

    it('does not reintroduce the "skeleton" stub framing in the feature block', () => {
      const featBlock = out.slice(
        out.indexOf('FEATURE TASK'),
        out.indexOf('UI TASK') > 0 ? out.indexOf('UI TASK') : undefined,
      );
      expect(featBlock.toLowerCase()).not.toContain('skeleton');
    });
  });

  describe('decompose splitting — skeleton vocabulary clarified', () => {
    it('describes the feature output as functionally complete but visually unstyled', async () => {
      const out = await adapter.render(OUTPUT_UNIT, {});
      expect(out).toMatch(/functionally complete but visually unstyled/);
      expect(out.toLowerCase()).not.toContain('skeleton');
    });
  });
});
