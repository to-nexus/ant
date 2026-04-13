// TODO: Rewrite PromptEngine-dependent tests for PromptBuilder pipeline
import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';
import {
  resolveToRAC,
  getConfigSlots,
  deriveFromIntent,
} from '@ant/shared';
import type { IntentId } from '@ant/shared';
import type { ResolvedArtifact } from '@ant/shared';
import { FIXTURES, IntentFixture } from './dataset';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');

beforeAll(async () => {
  await initPartials(TEMPLATES_DIR);
});

function buildPromptArgs(fixture: IntentFixture, label: string) {
  const docs: ResolvedArtifact[] = Object.entries(fixture.documents).map(
    ([path, { content, role }]) => ({ path, content, role }),
  );
  const rac = resolveToRAC(
    fixture.metadata.intent as IntentId,
    { target: fixture.metadata.target, refs: fixture.metadata.refs, context: fixture.metadata.context },
    'explicit',
  );
  if (docs.length) rac.documents = docs;

  const ctx = {
    project: 'test',
    featurePath: '/tmp/test',
    featureFolder: 'test',
  } as any;

  const currentTask = {
    name: label,
    type: 'feature',
    priority: 200,
    description: fixture.directive,
    ...(fixture.targetFile ? { targetFile: fixture.targetFile } : {}),
  } as any;

  return { docs, rac, ctx, currentTask };
}

describe('Intent Acceptance', () => {
  for (const fixture of FIXTURES) {
    const label = fixture.intent;

    describe(label, () => {

      // ── Stage 1: Config Matrix ──

      it('config matrix has valid slots', () => {
        const slots = getConfigSlots(fixture.intent as IntentId);
        expect(slots).not.toBeNull();
      });

      // ── Stage 2: RAC Routing ──

      it('RAC routing matches expected', () => {
        const rac = resolveToRAC(
          fixture.intent as IntentId,
          { target: fixture.metadata.target, refs: fixture.metadata.refs, context: fixture.metadata.context },
          'explicit',
        );
        const derived = deriveFromIntent(fixture.intent as IntentId);

        expect(derived.agent).toBe(fixture.routing.agent);
        expect(derived.jobType).toBe(fixture.routing.jobType);
        expect(rac.mode).toBe(fixture.routing.mode);

        if (fixture.routing.intentGroup) {
          expect(rac.intentGroup).toBe(fixture.routing.intentGroup);
        }

        if (fixture.metadata.refs?.length) {
          expect(rac.refs).toEqual(fixture.metadata.refs);
        }
        if (fixture.metadata.context?.length) {
          expect(rac.context).toEqual(fixture.metadata.context);
        }
      });

      // ── Stage 3: Prompt Build (code/design only) ──

      // TODO: Rewrite this test for PromptBuilder pipeline
      if (['code', 'design'].includes(fixture.routing.jobType)) {
        it.skip('prompt build: injections match', async () => {
          // Requires PromptBuilder rewrite
        });

        it.skip('prompt text snapshot', async () => {
          // Requires PromptBuilder rewrite
        });
      }
    });
  }
});
