/**
 * ant-authored commit message guards.
 *
 * Covers the defects behind "the ant-commit writes a meaningless timestamp":
 *   1. `buildCommitPlan` must never commit a fence marker / raw JSON bracket as
 *      the message when the model's multi-commit JSON fails to parse.
 *   2. No failure path may EVER return a bare `Update: <ISO timestamp>` — the
 *      last-resort message is content-derived from the changed files.
 *   3. A commit issued while a job runs shares the provider account and gets
 *      429'd; `buildCommitPlan` must RETRY across the rate window (not guillotine
 *      the first attempt) so it still receives an LLM-authored message. A true
 *      balance depletion still fast-fails.
 *   4. `loadWorkspaceConfigFromPath` (the env-free loader used by the API-server
 *      git-op path) must inject the auxiliary `commit` model default even when
 *      the user's config.json omits it — so model resolution never silently
 *      falls back to AI_MODEL_NAME/opus.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_MODELS } from '@ant/shared';
import {
  buildCommitPlan,
  deriveFallbackCommitMessage,
  COMMIT_MESSAGE_ATTEMPT_TIMEOUT_MS,
  COMMIT_MESSAGE_MAX_ATTEMPTS,
} from '../../src/core/context/commitMessage';

/** Bare ISO-timestamp commit message — the regression we must never re-emit. */
const ISO_TIMESTAMP = /\d{4}-\d\d-\d\dT\d\d:\d\d/;
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
    // a fence marker, which MUST be rejected in favour of a content-derived
    // message (never a fence, never a timestamp).
    const groups = await buildCommitPlan({
      status: 'M a', diff: 'diff', recentLog: 'log',
      allFiles: FILES, allowMultiple: true,
      llm: stubLlm('```json\n[{ "message": "feat: add thing"'),
      promptPort: stubPrompt,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].message).not.toMatch(/^(```|~~~|\[|\{|json\b)/i);
    expect(groups[0].message).toMatch(/^Update /);
    expect(groups[0].message).not.toMatch(ISO_TIMESTAMP);
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

  it('falls back to a content-derived message (never a timestamp) when no llm is supplied', async () => {
    const groups = await buildCommitPlan({
      status: '', diff: '', recentLog: '', allFiles: FILES, allowMultiple: true,
    });
    expect(groups[0].message).toMatch(/^Update /);
    expect(groups[0].message).not.toMatch(ISO_TIMESTAMP);
    expect(groups[0].files).toEqual(FILES);
  });
});

describe('deriveFallbackCommitMessage — content-derived, never a timestamp', () => {
  it('never produces an ISO timestamp for any input', () => {
    for (const files of [[], ['a.ts'], ['src/a.ts', 'src/b.ts'], Array.from({ length: 40 }, (_, i) => `pkg/mod${i}/x.ts`)]) {
      expect(deriveFallbackCommitMessage(files)).not.toMatch(ISO_TIMESTAMP);
    }
  });

  it('anchors the scope to the shared directory prefix', () => {
    expect(deriveFallbackCommitMessage(['src/auth/login.ts', 'src/auth/session.ts']))
      .toBe('Update src/auth: login.ts, session.ts');
  });

  it('keeps the subject within 72 chars for large change sets', () => {
    const files = Array.from({ length: 40 }, (_, i) => `src/feature/really-long-module-name-${i}.ts`);
    const msg = deriveFallbackCommitMessage(files);
    expect(msg.length).toBeLessThanOrEqual(72);
    expect(msg).toContain('40 files');
  });
});

/** LLM stub whose `invokeWithUsage` throws `attempts-1` times, then succeeds. */
function flakyUsageLlm(failures: number, error: unknown, reply: string): LLMClient {
  let calls = 0;
  return {
    provider: 'test',
    modelName: 'test-model',
    invoke: async () => { throw new Error('unexpected invoke()'); },
    invokeWithUsage: async () => {
      calls++;
      if (calls <= failures) throw error;
      return { content: reply, usage: { inputTokens: 1, outputTokens: 1 } };
    },
  } as unknown as LLMClient;
}

describe('buildCommitPlan resilience under provider rate contention', () => {
  it('retries a 429 and still returns the LLM-authored message', async () => {
    const rate429: any = Object.assign(new Error('rate limited'), { status: 429 });
    const groups = await buildCommitPlan({
      status: 'M a', diff: 'diff', recentLog: 'log',
      allFiles: FILES, allowMultiple: true,
      llm: flakyUsageLlm(1, rate429, '```json\n[{"message":"feat: real message","files":["src/a.ts","src/b.ts"]}]\n```'),
      promptPort: stubPrompt,
    });
    expect(groups[0].message).toBe('feat: real message');
    expect(groups[0].message).not.toMatch(ISO_TIMESTAMP);
  }, 15000);

  it('fast-fails a true balance depletion to a content-derived message (no hang)', async () => {
    const balance: any = Object.assign(new Error('Insufficient balance, please recharge'), { status: 429 });
    const started = Date.now();
    const groups = await buildCommitPlan({
      status: 'M a', diff: 'diff', recentLog: 'log',
      allFiles: FILES, allowMultiple: true,
      llm: flakyUsageLlm(99, balance, 'never reached'),
      promptPort: stubPrompt,
    });
    // Balance depletion is non-retryable → returns immediately (no backoff wait).
    expect(Date.now() - started).toBeLessThan(2000);
    expect(groups[0].message).toMatch(/^Update /);
    expect(groups[0].message).not.toMatch(ISO_TIMESTAMP);
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

describe('commit timing invariant — BE worst case < lock TTL ≤ FE window', () => {
  it('keeps the worst-case LLM budget under the 60s commit lock / FE race window', () => {
    // Backoff sleeps: initial 2s doubling, capped at 4s (maxDelayMs) —
    // mirrors the withRetry options in buildCommitPlan.
    let backoffTotal = 0;
    let delay = 2000;
    for (let attempt = 1; attempt < COMMIT_MESSAGE_MAX_ATTEMPTS; attempt++) {
      backoffTotal += Math.min(delay, 4000);
      delay *= 2;
    }
    const worstCase =
      COMMIT_MESSAGE_MAX_ATTEMPTS * COMMIT_MESSAGE_ATTEMPT_TIMEOUT_MS + backoffTotal;
    // 60_000 = LOCK_TTL_COMMIT_SEC (GitService/remote/index.ts) = FE
    // OP_TIMEOUTS.commit (ant-ui git-world/state.ts). If this fails, a commit
    // can succeed on the BE after the FE already reported failure, and the
    // immediate retry 409s against the still-held lock (the 226ddda28
    // regression).
    expect(worstCase).toBeLessThan(60_000);
  });
});
