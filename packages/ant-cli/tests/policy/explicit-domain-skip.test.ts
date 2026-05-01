/**
 * Phase 1 H-1 — explicit > infer LLM skip
 *
 * Verifies the prompt template gates the domain instruction on
 * `{{#unless explicitDomain}}` so the LLM does not waste tokens
 * re-inferring an already-known domain.
 *
 * Source-level test (no LLM execution). Inspects the rendered template
 * directly via the Handlebars renderer used by FilePromptAdapter.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Handlebars from 'handlebars';

const TEMPLATES_ROOT = path.resolve(__dirname, '../../src/core/prompt/templates');

function renderTemplate(rel: string, vars: Record<string, unknown>): string {
  const file = path.join(TEMPLATES_ROOT, `${rel}.md`);
  const src = fs.readFileSync(file, 'utf-8');
  const tmpl = Handlebars.compile(src, { noEscape: true, strict: false });
  return tmpl(vars);
}

beforeAll(() => {
  // Minimal helper registration — the adapter registers more, but our
  // domain-skip templates only need `if`/`unless` (built-in).
});

describe('plan/detect rules — explicit domain suppression', () => {
  it('emits domain instruction when explicitDomain is undefined', () => {
    const out = renderTemplate('jobs/plan/nodes/detect/variants/default/rules', {
      directive: '',
      hasExistingTarget: false,
      refs: [],
      explicitDomain: undefined,
    });
    expect(out).toContain('<domain>game|service</domain>');
    expect(out).toContain('Domain Classification');
  });

  it('suppresses domain instruction when explicitDomain is set', () => {
    const out = renderTemplate('jobs/plan/nodes/detect/variants/default/rules', {
      directive: '',
      hasExistingTarget: false,
      refs: [],
      explicitDomain: 'game',
    });
    expect(out).not.toContain('<domain>game|service</domain>');
    expect(out).not.toContain('## Domain Classification');
    // Confirms the explicit value is mentioned for transparency.
    expect(out).toContain('Domain is already committed (`game`)');
  });
});

describe('design/detect base — explicit domain suppression', () => {
  it('mentions domain in the instruction list when explicitDomain is undefined', () => {
    const out = renderTemplate('jobs/design/nodes/detect/variants/default/base', {
      directive: '',
      hasReferences: false,
      hasAssets: false,
      hasUiDocs: false,
      hasUiTokens: false,
      hasUiAssets: false,
      hasUiSpec: false,
      hasSystemDocs: false,
      hasSystemDesign: false,
      hasApiContract: false,
      hasFeSystemDesign: false,
      hasBeSystemDesign: false,
      systemDesignFiles: [],
      explicitDomain: undefined,
    });
    expect(out).toContain('### Domain Classification');
    expect(out).toMatch(/3\.\s*\*\*domain\*\*/);
  });

  it('omits the domain instruction when explicitDomain is set', () => {
    const out = renderTemplate('jobs/design/nodes/detect/variants/default/base', {
      directive: '',
      hasReferences: false,
      hasAssets: false,
      hasUiDocs: false,
      hasUiTokens: false,
      hasUiAssets: false,
      hasUiSpec: false,
      hasSystemDocs: false,
      hasSystemDesign: false,
      hasApiContract: false,
      hasFeSystemDesign: false,
      hasBeSystemDesign: false,
      systemDesignFiles: [],
      explicitDomain: 'service',
    });
    expect(out).not.toContain('### Domain Classification');
    expect(out).toContain('Domain is already committed (`service`)');
    // The system-design JSON shape suppresses `domain` field too.
    expect(out).not.toMatch(/"domain":\s*"game"\s*\|\s*"service"/);
  });
});
