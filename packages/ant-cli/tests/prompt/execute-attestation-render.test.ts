/**
 * Pre-`<done>` contract attestation — template render gate.
 *
 * The default execute template includes the attestation partial behind
 * `{{#if requiresAttestation}}`. Asserts: renders for consumer feature/ui
 * (true), renders nothing for non-consumer task types (false / undefined).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import Handlebars from 'handlebars';

import { initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');

// Mirrors the gate wired into `variants/default/base.md` (feature + ui sections).
const gate = '{{#if requiresAttestation}}{{> jobs/code/nodes/execute/injections/attestation}}{{/if}}';

describe('execute attestation render gate', () => {
  let tmpl: Handlebars.TemplateDelegate;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    tmpl = Handlebars.compile(gate);
  });

  it('renders the attestation block when requiresAttestation=true', () => {
    const out = tmpl({ requiresAttestation: true });
    expect(out).toContain('CONTRACT ATTESTATION');
    expect(out).toMatch(/PASS \| DEVIATION/);
    // It is design-conformance, not physical build/test.
    expect(out).toMatch(/do NOT run build/i);
  });

  it('renders nothing when requiresAttestation=false', () => {
    expect(tmpl({ requiresAttestation: false }).trim()).toBe('');
  });

  it('renders nothing when requiresAttestation is undefined (non-consumer task types)', () => {
    expect(tmpl({}).trim()).toBe('');
  });
});
