/**
 * L1 — `jobs/code/base/injections/ant-md` partial render contract.
 *
 * F0 (2026-04) turned ANTRULES.md into a live document: every code-job
 * task may read AND modify it. The partial now always renders a
 * Project Settings block — either with the current content plus an
 * "Updating ANTRULES.md" guidance (when content exists) or with a
 * "create-if-you-discover-invariants" hint (when it does not).
 */

import { describe, it, expect } from 'vitest';
import { FilePromptAdapter } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATE = 'jobs/code/base/injections/ant-md';

describe('jobs/code/base/injections/ant-md', () => {
  const adapter = new FilePromptAdapter();

  it('renders the "create-if-needed" guidance when antrulesContent is undefined', async () => {
    const out = await adapter.render(TEMPLATE, { antrulesContent: undefined });
    expect(out).toMatch(/## Project Settings \(codebase\/ANTRULES\.md\)/);
    expect(out).toMatch(/does not yet have/i);
    expect(out).toMatch(/create/i);
    expect(out).toMatch(/1500/); // size hint stays
    expect(out).toMatch(/Do NOT fabricate/i);
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
    expect(out).toMatch(/library .*(compat|incompat)/i);
    expect(out).toMatch(/test runner/i);
    expect(out).toMatch(/Do NOT fabricate/i);
  });
});
