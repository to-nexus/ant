/**
 * Signal-injection lock (sharp-choking-glove RCA): triage's rev-vs-gen choice
 * needs filename-level topicality evidence — `specDocNames` /
 * `systemDesignFileNames` must reach the triage prompt vars and render in
 * base.md. The boolean flags alone cannot say WHICH docs exist.
 */
import { describe, it, expect, vi } from 'vitest';

import { buildTriagePrompt } from '../../src/agents/common/graph/nodes/triage/index';
import { FilePromptAdapter } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const workspaceState = (over: Record<string, any> = {}) =>
  ({
    hasPlan: false,
    hasMetaDirectives: false,
    hasAssets: false,
    hasFigmaConfig: false,
    hasVisualUi: false,
    hasVisualGameArt: false,
    hasArchitectureSystem: true,
    systemDesignFileNames: ['fe-system-main.md'],
    hasArchitectureSpec: true,
    specDocCount: 1,
    specDocNames: ['defect-fixes.md'],
    hasCodebase: false,
    hasDesignDoc: true,
    ...over,
  }) as any;

describe('buildTriagePrompt — workspace filename signals', () => {
  it('forwards specDocNames and systemDesignFileNames into the template vars', async () => {
    const render = vi.fn(async () => 'rendered');
    await buildTriagePrompt({
      userInput: 'fix these defects',
      currentJob: 'design',
      currentAgent: 'architect',
      workspaceState: workspaceState(),
      promptPort: { render } as any,
    });

    const vars = (render.mock.calls as unknown as any[][]).find(c => c[1]?.intentCatalog)![1] as any;
    expect(vars.specDocNames).toEqual(['defect-fixes.md']);
    expect(vars.systemDesignFileNames).toEqual(['fe-system-main.md']);
  });

  it('renders the filenames in triage base.md when the flags are true, omits them when false', async () => {
    const adapter = new FilePromptAdapter();
    const withDocs = await buildTriagePrompt({
      userInput: 'x',
      currentJob: 'design',
      currentAgent: 'architect',
      workspaceState: workspaceState(),
      promptPort: adapter,
    });
    expect(withDocs.user).toContain('defect-fixes.md');
    expect(withDocs.user).toContain('fe-system-main.md');

    const withoutDocs = await buildTriagePrompt({
      userInput: 'x',
      currentJob: 'design',
      currentAgent: 'architect',
      workspaceState: workspaceState({
        hasArchitectureSpec: false,
        specDocNames: undefined,
        hasArchitectureSystem: false,
        systemDesignFileNames: undefined,
      }),
      promptPort: adapter,
    });
    expect(withoutDocs.user).not.toContain('defect-fixes.md');
    expect(withoutDocs.user).toContain('No spec documents');
  });
});
