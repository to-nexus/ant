/**
 * getConfiguredProviders — the /models endpoint's per-request "which providers
 * have an API key on this server" report, computed from the PROVIDER_API_KEY_ENV
 * SSOT. Drives the picker's unconfigured-provider warning.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConfiguredProviders } from '../../src/periphery/adapters/http/routes/models.routes';

const KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'GLM_API_KEY'] as const;

describe('getConfiguredProviders', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('returns only providers whose key env var is set to a non-empty value', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-real';
    process.env.DEEPSEEK_API_KEY = '  '; // blank → not configured
    // OPENAI/GEMINI unset
    process.env.GLM_API_KEY = 'sk-glm';
    const configured = getConfiguredProviders();
    expect(configured).toContain('anthropic');
    expect(configured).toContain('glm');
    expect(configured).not.toContain('deepseek');
    expect(configured).not.toContain('openai');
    expect(configured).not.toContain('google');
  });

  it('returns all providers when every key is set', () => {
    for (const k of KEYS) process.env[k] = 'x';
    expect(getConfiguredProviders().sort()).toEqual(['anthropic', 'deepseek', 'glm', 'google', 'openai']);
  });

  it('returns empty when no keys are set', () => {
    expect(getConfiguredProviders()).toEqual([]);
  });
});
