/**
 * Existing-code discipline SSOT — presence-driven successor to the retired
 * code-job refactor mode (rev-code removal).
 *
 * Locks:
 *  1. The discipline partial renders ONLY when `hasExistingCode` is true.
 *  2. The decompose existing-code-check wrapper includes the discipline
 *     partial (single SSOT — no drifting duplicate copy).
 *  3. The fresh-build conflict check renders ONLY when an existing codebase
 *     AND an active clarify gate coincide (`hasExistingCode && clarifyActive`).
 *  4. The plan base template carries the discipline + codebase-channel
 *     includes (plan rides render(), not the auto-injection resolver).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { readFileSync } from 'fs';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');
const DISCIPLINE = 'jobs/code/base/injections/existing-code-discipline';
const CHECK = 'jobs/code/nodes/decompose/variants/default/existing-code-check';

let adapter: FilePromptAdapter;

beforeAll(async () => {
  await initPartials(TEMPLATES_DIR);
  adapter = new FilePromptAdapter(TEMPLATES_DIR);
});

describe('existing-code-discipline partial', () => {
  it('renders the discipline when hasExistingCode=true', async () => {
    const out = await adapter.render(DISCIPLINE, { hasExistingCode: true });
    expect(out).toContain('Existing-Code Discipline');
    expect(out).toContain('Preserve existing behavior');
    expect(out).toContain('Minimize blast radius');
  });

  it('renders empty on greenfield', async () => {
    const out = await adapter.render(DISCIPLINE, { hasExistingCode: false });
    expect(out.trim()).toBe('');
  });
});

describe('decompose existing-code-check wrapper', () => {
  it('includes the discipline partial (single SSOT)', async () => {
    const out = await adapter.render(CHECK, {
      hasExistingCode: true,
      fileCount: 3,
      fileList: '- a.ts\n- b.ts\n- c.ts',
    });
    expect(out).toContain('EXISTING CODEBASE DETECTED');
    expect(out).toContain('Existing-Code Discipline');
    expect(out).toContain('3 files detected');
  });

  it('fresh-build conflict check renders only when clarifyActive', async () => {
    const withClarify = await adapter.render(CHECK, {
      hasExistingCode: true,
      clarifyActive: true,
      fileCount: 1,
      fileList: '- a.ts',
    });
    expect(withClarify).toContain('Fresh-build conflict check');
    expect(withClarify).toContain('<clarify>');

    const withoutClarify = await adapter.render(CHECK, {
      hasExistingCode: true,
      clarifyActive: false,
      fileCount: 1,
      fileList: '- a.ts',
    });
    expect(withoutClarify).not.toContain('Fresh-build conflict check');
  });

  it('greenfield branch renders the no-code notice, no clarify check', async () => {
    const out = await adapter.render(CHECK, { hasExistingCode: false, clarifyActive: true });
    expect(out).toContain('NO EXISTING CODE DETECTED');
    expect(out).not.toContain('Fresh-build conflict check');
  });
});

describe('plan base wiring (render path — resolver not involved)', () => {
  it('plan base.md includes codebase-channel and existing-code-discipline', () => {
    const src = readFileSync(join(TEMPLATES_DIR, 'jobs/code/nodes/plan/base.md'), 'utf-8');
    expect(src).toContain('{{> jobs/shared/injections/codebase-channel}}');
    expect(src).toContain('{{> jobs/code/base/injections/existing-code-discipline}}');
  });
});
