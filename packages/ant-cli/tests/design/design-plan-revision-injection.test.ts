/**
 * Design plan — revision-contract injection (refactor mode).
 *
 * The deep-binding-mason regression showed the plan phase authoring a
 * from-scratch outline for a rev-spec job because (a) the plan prompt had no
 * mode signal and (b) the existing document reached the plan LLM only if it
 * chose to `read_file` it. These tests lock the deterministic injection:
 * `detectedMode` rides the template vars and the existing document body is
 * injected as a Block-2 context part in refactor mode.
 */

import { describe, it, expect } from 'vitest';
import { buildPlanPromptBlocks } from '../../src/agents/architect/graph/design/nodes/plan/prompt';
import type { DesignGraphState } from '../../src/agents/architect/graph/design/state';
import type { DesignTask } from '../../src/agents/architect/types/task';

const EXISTING_DOC = `# Spec: Game Defect Refactor

## Overview

six defects

## Root Cause Analysis

deep dive
`;

function makeState(opts: {
  mode?: string;
  files?: Record<string, string>;
  captured?: { config?: any };
}): DesignGraphState {
  const files = opts.files ?? {};
  return {
    directive: 'remove hp hud',
    resolvedAction: {
      intent: 'rev-spec',
      intentGroup: 'design-spec',
      mode: opts.mode ?? 'generate',
    },
    artifacts: [],
    context: { featurePath: '/feat', userLanguage: 'en' },
    conversations: {},
    deps: {
      promptBuilder: {
        build: async (config: any) => {
          if (opts.captured) opts.captured.config = config;
          return {
            system: 'sys',
            user: 'user-turn',
            sections: {
              guardrail: '',
              systemBase: 'sys',
              profiles: '',
              rules: '',
              examples: '',
              policy: '',
              injections: '',
            },
          };
        },
      },
      fileSystem: {
        fileExists: async (p: string) => files[p] !== undefined,
        readFile: async (p: string) => {
          const c = files[p];
          if (c === undefined) throw new Error(`ENOENT ${p}`);
          return c;
        },
      },
    },
  } as unknown as DesignGraphState;
}

const TASK = {
  id: 'spec-game-defect-refactor-rev-1',
  name: 'Spec: Game Defect Refactor — Revision',
  type: 'doc',
  priority: 200,
  targetFile: 'game-defect-refactor.md',
  targetDir: 'architecture/spec',
  description: 'remove hp hud',
  completed: false,
} as unknown as DesignTask;

describe('buildPlanPromptBlocks — revision contract (refactor mode)', () => {
  it('injects the existing document as a context block and detectedMode=refactor', async () => {
    const captured: { config?: any } = {};
    const state = makeState({
      mode: 'refactor',
      files: { '/feat/architecture/spec/game-defect-refactor.md': EXISTING_DOC },
      captured,
    });

    const { blocks } = await buildPlanPromptBlocks(state, TASK);

    expect(captured.config.vars.detectedMode).toBe('refactor');
    const allText = blocks.map((b: any) => b.text).join('\n');
    expect(allText).toContain('# Existing Document (revision target)');
    expect(allText).toContain('## Root Cause Analysis');
  });

  it('generate mode: no existing-doc block, detectedMode=generate', async () => {
    const captured: { config?: any } = {};
    const state = makeState({
      mode: 'generate',
      files: { '/feat/architecture/spec/game-defect-refactor.md': EXISTING_DOC },
      captured,
    });

    const { blocks } = await buildPlanPromptBlocks(state, TASK);

    expect(captured.config.vars.detectedMode).toBe('generate');
    const allText = blocks.map((b: any) => b.text).join('\n');
    expect(allText).not.toContain('# Existing Document (revision target)');
  });

  it('refactor with missing doc: warns and proceeds without the block', async () => {
    const state = makeState({ mode: 'refactor', files: {} });
    const { blocks } = await buildPlanPromptBlocks(state, TASK);
    const allText = blocks.map((b: any) => b.text).join('\n');
    expect(allText).not.toContain('# Existing Document (revision target)');
  });
});
