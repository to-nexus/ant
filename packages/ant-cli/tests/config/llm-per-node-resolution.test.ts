/**
 * Per-node LLM model resolution:
 * - verifies that projects with only job.default set fall through to that default for unconfigured node types
 * - verifies that resolveModelForContext correctly prioritizes node-specific over job default
 * - verifies that FileConfigAdapter does NOT leak node-specific hardcoded defaults from merge base
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveModelForContext,
  createLLMClient,
  setLLMClientFactory,
  type LLMContext,
} from '../../src/periphery/adapters/llm/LLMClientFactory';
import { getConfigMergeDefaults, getDefaultWorkspaceConfig } from '../../src/core/types/workspace';

// Mock LLM client for testing without API keys
class MockLLMClient {
  modelName: string;
  constructor(modelName: string) {
    this.modelName = modelName;
  }
}

beforeEach(() => {
  // Use mock factory to avoid auth errors
  setLLMClientFactory((agentJob, config, context, workspaceConfig) => {
    const modelName = resolveModelForContext(context, workspaceConfig);
    return new MockLLMClient(modelName) as any;
  });
});

// Reset the factory after each test
afterEach(() => {
  setLLMClientFactory(null);
});

describe('LLM Per-Node Model Resolution', () => {
  it('A: getConfigMergeDefaults returns only job-level defaults (no node-specific overrides)', () => {
    const mergeDefaults = getConfigMergeDefaults();

    // Check that no job has node-specific keys like 'decompose', 'plan', 'execute'
    for (const [job, config] of Object.entries(mergeDefaults)) {
      if (job === 'visual') {
        // visual is special: only default
        expect(config).toEqual({ default: expect.any(String) });
      } else if (job === 'learn' || job === 'reviewer' || job === 'doc') {
        // single-default jobs
        expect(config).toEqual({ default: expect.any(String) });
      } else {
        // multi-node jobs (design, code, plan) MUST only have 'default', never 'decompose'/'plan'/'execute'
        expect(config).toEqual({ default: expect.any(String) });
        expect(Object.keys(config)).toEqual(['default']);
      }
    }
  });

  it('B: getDefaultWorkspaceConfig contains the opinionated per-node defaults (for creation-time snapshot)', () => {
    const defaults = getDefaultWorkspaceConfig('test-project');

    // `llmModels` is optional on WorkspaceConfig, but the whole point of this
    // case is that the creation-time snapshot ships it — so assert that first
    // and let the per-job checks below read a non-optional local.
    expect(defaults.llmModels).toBeDefined();
    const llmModels = defaults.llmModels!;

    // Check that opinionated defaults are present
    expect(llmModels.code).toHaveProperty('decompose');
    expect(llmModels.code).toHaveProperty('plan');
    expect(llmModels.code).toHaveProperty('execute');

    expect(llmModels.plan).toHaveProperty('plan');
    expect(llmModels.plan).toHaveProperty('execute');

    expect(llmModels.design).toHaveProperty('decompose');
    expect(llmModels.design).toHaveProperty('plan');
    expect(llmModels.design).toHaveProperty('execute');
  });

  it('C: resolveModelForContext returns job default for unconfigured node types', () => {
    // Simulate a persisted config that only sets code.default (user customization)
    const userConfig = {
      llmModels: {
        code: { default: 'custom-model-123' },
      },
    };

    // When resolving code:decompose (node not explicitly set), should fall back to code.default
    const resolved = resolveModelForContext(
      { jobType: 'code', nodeType: 'decompose' },
      userConfig,
    );

    expect(resolved).toBe('custom-model-123');
  });

  it('D: resolveModelForContext returns node-specific when both node and default are set', () => {
    const userConfig = {
      llmModels: {
        code: {
          default: 'model-a',
          decompose: 'model-b',
        },
      },
    };

    // code:decompose should return the explicit node-specific value
    const resolved = resolveModelForContext(
      { jobType: 'code', nodeType: 'decompose' },
      userConfig,
    );

    expect(resolved).toBe('model-b');
  });

  it('E: resolveModelForContext does not leak merge-base node defaults to configs without those keys', () => {
    // Simulate a persisted config from an old project that only has code.default
    // (no decompose/plan/execute keys, as they didn't exist at project-creation time)
    const oldProjectConfig = {
      llmModels: {
        code: { default: 'old-project-default' },
      },
    };

    // When a new code node type (e.g. 'execute') is added to the codebase,
    // resolveModelForContext should NOT use a hardcoded merge-base fallback.
    // Instead, it should fall through to the job default.
    const resolved = resolveModelForContext(
      { jobType: 'code', nodeType: 'execute' },
      oldProjectConfig,
    );

    // Should be the project's custom default, NOT a hardcoded merge-base value
    expect(resolved).toBe('old-project-default');
  });

  it('F: createLLMClient resolves correct model for each node type', () => {
    const workspaceConfig = {
      llmModels: {
        plan: {
          default: 'claude-sonnet-5',
          plan: 'claude-opus-5',
          execute: 'claude-sonnet-5-alt',
        },
      },
    };

    const planNodeClient = createLLMClient(
      'planner',
      undefined,
      { jobType: 'plan', nodeType: 'plan' },
      workspaceConfig,
    );

    const executeNodeClient = createLLMClient(
      'planner',
      undefined,
      { jobType: 'plan', nodeType: 'execute' },
      workspaceConfig,
    );

    // Both clients should have been created with different model names
    expect((planNodeClient as any).modelName).toBe('claude-opus-5');
    expect((executeNodeClient as any).modelName).toBe('claude-sonnet-5-alt');
  });

  it('G: Partial per-node override (only some nodes specified) falls back to default for unspecified nodes', () => {
    const config = {
      llmModels: {
        code: {
          default: 'default-model',
          decompose: 'opus-model',
          // plan and execute are NOT specified
        },
      },
    };

    const decomposeResolved = resolveModelForContext(
      { jobType: 'code', nodeType: 'decompose' },
      config,
    );
    const planResolved = resolveModelForContext(
      { jobType: 'code', nodeType: 'plan' },
      config,
    );
    const executeResolved = resolveModelForContext(
      { jobType: 'code', nodeType: 'execute' },
      config,
    );

    expect(decomposeResolved).toBe('opus-model'); // explicit
    expect(planResolved).toBe('default-model'); // falls through to default
    expect(executeResolved).toBe('default-model'); // falls through to default
  });
});
