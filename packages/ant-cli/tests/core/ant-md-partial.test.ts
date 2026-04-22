/**
 * L1 — `jobs/code/base/injections/ant-md` partial render contract.
 *
 * The partial is included from plan/execute base templates and dispatches
 * on `hasAntMd` + `antMdContent`. This suite pins:
 *   - empty render when hasAntMd=false
 *   - content + "Project Settings" header when hasAntMd=true
 *   - read_file pointer is always present so the LLM can fetch live
 *     content when it suspects staleness
 */

import { describe, it, expect } from 'vitest';
import { FilePromptAdapter } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATE = 'jobs/code/base/injections/ant-md';

describe('jobs/code/base/injections/ant-md', () => {
  const adapter = new FilePromptAdapter();

  it('renders empty when hasAntMd=false', async () => {
    const out = await adapter.render(TEMPLATE, { hasAntMd: false, antMdContent: '' });
    expect(out.trim()).toBe('');
  });

  it('renders the ANT.md content under a Project Settings header when hasAntMd=true', async () => {
    const content = '# ANT.md\n\n## Export Style\n- default export\n';
    const out = await adapter.render(TEMPLATE, { hasAntMd: true, antMdContent: content });
    expect(out).toMatch(/## Project Settings \(codebase\/ANT\.md\)/);
    expect(out).toContain(content);
  });

  it('surfaces the read_file pointer so the LLM can re-fetch stale content', async () => {
    const out = await adapter.render(TEMPLATE, { hasAntMd: true, antMdContent: '## X\n- y\n' });
    expect(out).toMatch(/read_file/);
    expect(out).toMatch(/codebase\/ANT\.md/);
  });
});
