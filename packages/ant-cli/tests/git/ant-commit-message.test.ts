/**
 * ant-authored commit message guards.
 *
 * Covers the two defects behind "the ant-commit still writes a timestamp /
 * mechanical message":
 *   1. `buildCommitPlan` must never commit a fence marker / raw JSON bracket as
 *      the message when the model's multi-commit JSON fails to parse.
 *   2. `loadWorkspaceConfigFromPath` (the env-free loader used by the API-server
 *      git-op path) must inject the auxiliary `commit` model default even when
 *      the user's config.json omits it — so model resolution never silently
 *      falls back to AI_MODEL_NAME/opus.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_MODELS } from '@ant/shared';
import { buildCommitPlan } from '../../src/core/context/commitMessage';
import {
  withAntCoAuthor,
  ANT_COAUTHOR_TRAILER,
} from '../../src/periphery/adapters/http/services/GitService/remote/operations/helpers/antAttribution';
import { loadWorkspaceConfigFromPath } from '../../src/periphery/adapters/config/FileConfigAdapter';
import type { LLMClient } from '../../src/core/ports/llm';
import type { PromptPort } from '../../src/core/ports/prompt';

function stubLlm(reply: string): LLMClient {
  return {
    provider: 'test',
    modelName: 'test-model',
    invoke: async () => reply,
  } as unknown as LLMClient;
}

const stubPrompt: PromptPort = { render: async () => 'SYSTEM' };

const FILES = ['src/a.ts', 'src/b.ts'];

describe('buildCommitPlan safe salvage', () => {
  it('never commits a fence marker when multi-commit JSON parse fails', async () => {
    // Truncated / malformed fenced block → parseGroups fails → first line is
    // a fence marker, which MUST be rejected in favour of the timestamp.
    const groups = await buildCommitPlan({
      status: 'M a', diff: 'diff', recentLog: 'log',
      allFiles: FILES, allowMultiple: true,
      llm: stubLlm('```json\n[{ "message": "feat: add thing"'),
      promptPort: stubPrompt,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].message).not.toMatch(/^(```|~~~|\[|\{|json\b)/i);
    expect(groups[0].message).toMatch(/^Update: /);
    expect(groups[0].files).toEqual(FILES);
  });

  it('returns parsed groups when the model emits valid multi-commit JSON', async () => {
    const groups = await buildCommitPlan({
      status: 'M a', diff: 'diff', recentLog: 'log',
      allFiles: FILES, allowMultiple: true,
      llm: stubLlm('```json\n[{"message":"feat: a","files":["src/a.ts"]},{"message":"fix: b","files":["src/b.ts"]}]\n```'),
      promptPort: stubPrompt,
    });
    expect(groups.map((g) => g.message)).toEqual(['feat: a', 'fix: b']);
  });

  it('falls back to a timestamp when no llm is supplied', async () => {
    const groups = await buildCommitPlan({
      status: '', diff: '', recentLog: '', allFiles: FILES, allowMultiple: true,
    });
    expect(groups[0].message).toMatch(/^Update: /);
  });
});

describe('withAntCoAuthor — ANT co-author attribution', () => {
  it('appends the ANT Co-authored-by trailer after a blank line', () => {
    const out = withAntCoAuthor('feat: add avatar upload endpoint');
    expect(out).toBe(`feat: add avatar upload endpoint\n\n${ANT_COAUTHOR_TRAILER}`);
    expect(ANT_COAUTHOR_TRAILER).toBe('Co-authored-by: ANT <ant@to.nexus>');
  });

  it('is idempotent — decorating twice adds only one trailer', () => {
    const once = withAntCoAuthor('fix: bug');
    const twice = withAntCoAuthor(once);
    expect(twice).toBe(once);
    expect(twice.match(/Co-authored-by:/g)).toHaveLength(1);
  });

  it('preserves a multi-paragraph body and appends exactly one trailer', () => {
    const msg = 'feat: x\n\nsome body paragraph explaining why';
    const out = withAntCoAuthor(msg);
    expect(out.startsWith(msg)).toBe(true);
    expect(out.endsWith(`\n\n${ANT_COAUTHOR_TRAILER}`)).toBe(true);
    expect(out.match(/Co-authored-by:/g)).toHaveLength(1);
  });
});

describe('loadWorkspaceConfigFromPath injects the aux commit default', () => {
  it('supplies commit.default even when config.json omits it', async () => {
    const prev = process.env.AI_MODEL_NAME;
    delete process.env.AI_MODEL_NAME;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-cfg-'));
    try {
      // User config with NO commit key (mirrors real pre-feature configs).
      fs.writeFileSync(
        path.join(dir, 'config.json'),
        JSON.stringify({ llmModels: { code: { default: 'claude-sonnet-5' } } }),
      );
      const config = await loadWorkspaceConfigFromPath(dir);
      expect(config.llmModels.commit?.default).toBe(DEFAULT_MODELS.sonnetTier);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      if (prev !== undefined) process.env.AI_MODEL_NAME = prev;
    }
  });
});
