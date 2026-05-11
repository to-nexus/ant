/**
 * Directive propagation contract.
 *
 * The user's original directive (`state.directive` — single channel on
 * `TriageableState`) MUST reach every per-task plan prompt and every
 * execute call so a task can see the original user intent regardless
 * of its position in the queue (Tier 2 single task, Tier 3 N tasks,
 * or batch-split sub-tasks).
 *
 * This test locks:
 * - plan/base.md gates `{{directive}}` inside an `## Original Directive`
 *   block (the default plan template — applies when no variant matches).
 * - All four plan variants (error / verification / test-code, plus the
 *   default base) include `{{directive}}` so feature, error, verification,
 *   test-code, and ui tasks all see it.
 * - plan/llm/prompt.ts forwards `state.directive` into the promptBuilder
 *   call (the single wire that turns the channel into a template var).
 * - execute/buildMessages.ts forwards `state.directive` into the execute
 *   prompt vars (sanitizable via hook). Execute templates may or may not
 *   render it, but the channel reaches the prompt-build seam — preserves
 *   the contract for future template work.
 * - decompose's default variant base also injects the raw directive
 *   (`{{{directive}}}`) — the chain originates at decompose, propagates
 *   through plan per task, and arrives at execute via vars.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { readFileSync } from 'node:fs';

const ROOT = join(__dirname, '../..');
const TEMPLATES_DIR = join(ROOT, 'src/core/prompt/templates');
const SRC_DIR = join(ROOT, 'src');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('directive propagation — user message → every task', () => {
  describe('plan templates carry {{directive}}', () => {
    it('default plan/base.md surfaces directive as Ground Truth', () => {
      const body = read(join(TEMPLATES_DIR, 'jobs/code/nodes/plan/base.md'));
      expect(body).toMatch(/\{\{#if directive\}\}/);
      expect(body).toMatch(/## Original Directive[^\n]*Ground Truth/);
      expect(body).toMatch(/\{\{directive\}\}/);
    });

    it('error plan variant includes directive', () => {
      const body = read(
        join(TEMPLATES_DIR, 'jobs/code/nodes/plan/variants/error/base.md'),
      );
      expect(body).toMatch(/\{\{directive\}\}/);
    });

    it('verification plan variant includes directive', () => {
      const body = read(
        join(
          TEMPLATES_DIR,
          'jobs/code/nodes/plan/variants/verification/base.md',
        ),
      );
      expect(body).toMatch(/\{\{directive\}\}/);
    });

    it('test-code plan variant includes directive', () => {
      const body = read(
        join(TEMPLATES_DIR, 'jobs/code/nodes/plan/variants/test-code/base.md'),
      );
      expect(body).toMatch(/\{\{#if directive\}\}/);
      expect(body).toMatch(/\{\{directive\}\}/);
    });
  });

  describe('decompose seeds the channel', () => {
    it('decompose default base injects raw directive', () => {
      const body = read(
        join(
          TEMPLATES_DIR,
          'jobs/code/nodes/decompose/variants/default/base.md',
        ),
      );
      expect(body).toMatch(/\{\{\{directive\}\}\}/);
    });
  });

  describe('node code forwards state.directive into prompt vars', () => {
    it('plan/llm/prompt.ts passes state.directive into promptBuilder vars', () => {
      const body = read(
        join(SRC_DIR, 'agents/architect/graph/code/nodes/plan/llm/prompt.ts'),
      );
      expect(body).toMatch(/directive:\s*state\.directive\s*\|\|\s*['"]['"]/);
    });

    it('execute/buildMessages.ts passes state.directive into execute prompt vars (with optional sanitization hook)', () => {
      const body = read(
        join(
          SRC_DIR,
          'agents/architect/graph/code/nodes/execute/buildMessages.ts',
        ),
      );
      // The wire: directive var is fed from state.directive, with an
      // optional sanitizeDirective hook. Whether the execute template
      // currently renders it is a separate concern — the channel must
      // reach the seam.
      expect(body).toMatch(/sanitizeDirective/);
      expect(body).toMatch(/state\.directive\s*\|\|\s*['"]['"]/);
    });
  });
});
