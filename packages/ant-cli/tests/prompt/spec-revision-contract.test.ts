/**
 * Revision-contract template gating (refactor mode).
 *
 * Locks the deep-binding-mason fix at the template layer:
 *  - plan variants (spec + system-design) carry a refactor-gated disposition
 *    contract (keep / modify / remove / add) and hide the generate-shape
 *    outline mandate behind the mode gate;
 *  - the execute spec variant renders exactly ONE output-format framing per
 *    mode (the old layout rendered the generate "Create the document" block
 *    AND the refactor block together, contradicting each other).
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const TEMPLATES = path.join(
  __dirname,
  '../../src/core/prompt/templates/jobs/design/nodes',
);
const T = (rel: string) => fs.readFileSync(path.join(TEMPLATES, rel), 'utf-8');

const PLAN_SPEC = T('plan/variants/spec/base.md');
const PLAN_SYS = T('plan/variants/system-design/base.md');
const EXEC_SPEC = T('execute/variants/spec/base.md');

describe('plan variants — refactor disposition contract', () => {
  for (const [label, body] of [['spec', PLAN_SPEC], ['system-design', PLAN_SYS]] as const) {
    it(`${label}: revision plan block is refactor-gated and disposition-complete`, () => {
      expect(body).toContain('{{#if (eq detectedMode "refactor")}}');
      expect(body).toContain('### Revision Plan (refactor mode)');
      expect(body).toContain('# Existing Document (revision target)');
      expect(body).toContain('"disposition"');
      for (const d of ['`keep`', '`modify`', '`remove`', '`add`']) {
        expect(body).toContain(d);
      }
      expect(body).toMatch(/omits an existing section without a `remove`\s+disposition is INVALID/);
    });

    it(`${label}: generate outline mandate sits in the else branch`, () => {
      const gateIdx = body.indexOf('{{#if (eq detectedMode "refactor")}}');
      const elseIdx = body.indexOf('{{else}}', gateIdx);
      const mandateIdx = body.indexOf('Your `documentOutline` MUST cover, at minimum:');
      expect(gateIdx).toBeGreaterThan(-1);
      expect(elseIdx).toBeGreaterThan(gateIdx);
      expect(mandateIdx).toBeGreaterThan(elseIdx);
    });
  }
});

describe('execute spec variant — single output-format framing per mode', () => {
  it('refactor branch owns the create_file contract; generate blocks live in the else', () => {
    const outputIdx = EXEC_SPEC.indexOf('## Output Format');
    const refactorGate = EXEC_SPEC.indexOf('{{#if (eq detectedMode "refactor")}}', outputIdx);
    const elseIdx = EXEC_SPEC.indexOf('{{else}}', refactorGate);
    const firstSectionGate = EXEC_SPEC.indexOf('{{#if isFirstSection}}', outputIdx);

    // Refactor gate comes first; the generate/continuation blocks are nested
    // inside its else branch — never rendered alongside the refactor block.
    expect(refactorGate).toBeGreaterThan(-1);
    expect(elseIdx).toBeGreaterThan(refactorGate);
    expect(firstSectionGate).toBeGreaterThan(elseIdx);
  });

  it('refactor framing states the delta-preservation contract', () => {
    expect(EXEC_SPEC).toContain('REVISE EXISTING SPEC');
    expect(EXEC_SPEC).toMatch(/directive does not affect MUST be reproduced verbatim/);
    expect(EXEC_SPEC).toContain('Only drop a section when the directive sanctions its removal.');
    // Retained locked strings (spec-depth-calibration.test.ts guards these too).
    expect(EXEC_SPEC).toContain('`append_file` is FORBIDDEN in refactor mode');
    expect(EXEC_SPEC).toMatch(/second complete document below the first/);
  });
});
