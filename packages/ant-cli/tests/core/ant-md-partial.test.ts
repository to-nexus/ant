/**
 * L1 — `jobs/code/base/injections/ant-md` partial render contract.
 */

import { describe, it, expect } from 'vitest';
import { FilePromptAdapter } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATE = 'jobs/code/base/injections/ant-md';

describe('jobs/code/base/injections/ant-md', () => {
  const adapter = new FilePromptAdapter();

  it('renders empty when antrulesContent is undefined', async () => {
    const out = await adapter.render(TEMPLATE, { antrulesContent: undefined });
    expect(out.trim()).toBe('');
  });

  it('renders empty when antrulesContent is an empty string', async () => {
    const out = await adapter.render(TEMPLATE, { antrulesContent: '' });
    expect(out.trim()).toBe('');
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
});
