/**
 * promptLogger fidelity (zero-hunting-label follow-up).
 *
 * `debug/prompts/` is forensics-only — no FE reader, no test parser, no billing
 * reader. Its entire value is that it is how bugs get diagnosed, so a record
 * that silently lies is worse than a missing one. One real session produced 21
 * `execute-spec` sections that ALL reported `Call Index: 0` and an identical
 * `Prompt Length: 91,009` while the real prompt grew past 300K chars:
 *
 *   - `callIndex` is caller-supplied, and the logger defaulted it to `0`, so an
 *     omitted value was indistinguishable from a genuine first call.
 *   - the builders measured their pre-composition `initialBlocks`, which are
 *     invariant for a task, instead of the composed `messages`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logPrompt, clearPromptLogger, measurePromptChars } from '../../src/core/utils/promptLogger';

let featurePath: string;
const JOB = 'job-fidelity';

beforeEach(() => {
  featurePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-prompt-log-'));
});

afterEach(() => {
  clearPromptLogger('design', JOB);
  fs.rmSync(featurePath, { recursive: true, force: true });
});

function logFile(): string {
  const dir = path.join(featurePath, 'sessions', 'architect', 'debug', 'prompts');
  const found = fs.readdirSync(dir).find((f) => f.includes(JOB));
  if (!found) throw new Error(`no prompt log written in ${dir}`);
  return fs.readFileSync(path.join(dir, found), 'utf-8');
}

describe('measurePromptChars', () => {
  it('measures the composed array, including block content', () => {
    expect(
      measurePromptChars([
        { content: 'abcde' },
        { content: [{ type: 'text', text: '12345' }, { type: 'image' }] },
      ]),
    ).toBe(5 + 5 + 200);
  });

  it('grows with conversation history — the signal the old metric could not show', () => {
    const initial = [{ content: 'x'.repeat(1000) }];
    const grown = [...initial, { content: 'y'.repeat(4000) }];
    expect(measurePromptChars(grown)).toBeGreaterThan(measurePromptChars(initial));
  });
});

describe('logPrompt record fidelity', () => {
  it('renders distinct Call Index and Prompt Length across rounds', async () => {
    for (const [round, chars] of [[0, 91_009], [1, 117_107], [2, 303_193]] as const) {
      await logPrompt(featurePath, JOB, 'design', 'execute-spec', chars, {
        taskId: 't1',
        taskName: 'Spec',
        callIndex: round,
      });
    }

    const content = logFile();
    const callIndexes = [...content.matchAll(/\*\*Call Index\*\*: (\d+)/g)].map((m) => m[1]);
    const lengths = [...content.matchAll(/\*\*Prompt Length\*\*: ([\d,]+)/g)].map((m) => m[1]);

    expect(callIndexes).toEqual(['0', '1', '2']);
    expect(new Set(lengths).size).toBe(3);
  });

  it('omits Call Index when the caller did not supply one, rather than forging 0', async () => {
    await logPrompt(featurePath, JOB, 'design', 'design-plan', 1234, {
      taskId: 't1',
      taskName: 'Spec',
    });
    // A forged `0` reads as "first call" and silently invites the exact
    // misreading this record exists to prevent.
    expect(logFile()).not.toMatch(/\*\*Call Index\*\*/);
  });
});
