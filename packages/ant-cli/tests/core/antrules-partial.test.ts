/**
 * Render contract for the `jobs/code/base/injections/antrules` partial.
 * Asserts the 3-condition filter appears in both content-present and
 * create-if-needed branches, and that the relaxed "trust code over this
 * block on disagreement" framing replaced the former "authoritative" one.
 */

import { describe, it, expect } from 'vitest';
import { FilePromptAdapter } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATE = 'jobs/code/base/injections/antrules';

describe('jobs/code/base/injections/antrules', () => {
  const adapter = new FilePromptAdapter();

  it('renders the "create-if-needed" guidance when antrulesContent is undefined', async () => {
    const out = await adapter.render(TEMPLATE, { antrulesContent: undefined });
    expect(out).toMatch(/## Project Settings \(codebase\/ANTRULES\.md\)/);
    expect(out).toMatch(/does not yet have/i);
    expect(out).toMatch(/create/i);
    expect(out).toMatch(/1500/); // size hint stays
    expect(out).toMatch(/Do NOT fabricate/i);
  });

  it('surfaces the 3-condition filter in the create-if-needed branch so seeders gate new entries', async () => {
    const out = await adapter.render(TEMPLATE, { antrulesContent: undefined });
    // All three filter conditions must be named verbatim so the LLM can cite them.
    expect(out).toMatch(/Codebase-local/);
    expect(out).toMatch(/Not auto-derivable/);
    expect(out).toMatch(/Cross-task invariant/);
    // Drift-seeding restatements (framework / alias / source-root) must be
    // explicitly prohibited so setup no longer seeds full-inventory skeletons.
    expect(out).toMatch(/package\.json/);
    expect(out).toMatch(/tsconfig\.json/);
    expect(out).toMatch(/drift/i);
  });

  it('renders the "create-if-needed" guidance when antrulesContent is an empty string', async () => {
    const out = await adapter.render(TEMPLATE, { antrulesContent: '' });
    expect(out).toMatch(/does not yet have/i);
  });

  it('renders the ANTRULES.md content under a Project Settings header', async () => {
    const content = '# ANTRULES.md\n\n## Export Style\n- default export\n';
    const out = await adapter.render(TEMPLATE, { antrulesContent: content });
    expect(out).toMatch(/## Project Settings \(codebase\/ANTRULES\.md\)/);
    expect(out).toContain(content);
  });

  it('surfaces the read_file pointer so the LLM can re-fetch stale content', async () => {
    const out = await adapter.render(TEMPLATE, { antrulesContent: '## X\n- y\n' });
    expect(out).toMatch(/read_file/);
    expect(out).toMatch(/codebase\/ANTRULES\.md/);
  });

  it('includes an "Updating ANTRULES.md" guidance so any task can record discoveries (F0)', async () => {
    const out = await adapter.render(TEMPLATE, { antrulesContent: '## X\n- y\n' });
    expect(out).toMatch(/Updating ANTRULES\.md/);
    expect(out).toMatch(/cross-task invariant/i);
    // Sharpened scope: conventions the tool configs do NOT encode, plus
    // point-in-time package compatibility / pinning rationale.
    expect(out).toMatch(/pinning rationale/i);
    expect(out).toMatch(/compatibility/i);
    expect(out).toMatch(/Do NOT fabricate/i);
  });

  it('replaces the "authoritative" framing with a "trust code over this block on disagreement" relaxation', async () => {
    const out = await adapter.render(TEMPLATE, { antrulesContent: '## X\n- y\n' });
    // The old partial said "Treat them as authoritative." — that framing
    // made the LLM trust stale rules over the actual code. The relaxation
    // names package.json / tsconfig.json as the SSOT when disagreement
    // occurs.
    expect(out).not.toMatch(/Treat them as authoritative/);
    expect(out).toMatch(/codebase-specific deviations/i);
    expect(out).toMatch(/trust.*actual project files|actual project files.*(disagree|SSOT)/i);
  });

  it('enumerates the 3-condition filter on the update path too', async () => {
    const out = await adapter.render(TEMPLATE, { antrulesContent: '## X\n- y\n' });
    expect(out).toMatch(/Codebase-local/);
    expect(out).toMatch(/Not auto-derivable/);
    expect(out).toMatch(/Cross-task invariant/);
    // Redundant categories the partial must explicitly REFUSE: framework /
    // alias / source-root restatements seed drift when duplicated.
    expect(out).toMatch(/framework/i);
    expect(out).toMatch(/alias/i);
  });
});
