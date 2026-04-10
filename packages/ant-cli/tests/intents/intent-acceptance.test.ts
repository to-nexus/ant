import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';
import { PromptEngine } from '../../src/core/prompt/engine/PromptEngine';
import '../../src/core/prompt/engine/TemplateComposer';
import {
  resolveFromExplicit,
  getConfigSlots,
  getAvailableBases,
  deriveFromIntent,
} from '@ant/shared';
import type { ResolvedDocument } from '@ant/shared';
import { FIXTURES, IntentFixture } from './dataset';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');
let engine: PromptEngine;

beforeAll(async () => {
  const adapter = new FilePromptAdapter(TEMPLATES_DIR);
  await initPartials(TEMPLATES_DIR);
  engine = new PromptEngine({ promptPort: adapter, contextLoader: async () => ({}) });
});

function buildPromptArgs(fixture: IntentFixture, label: string) {
  const docs: ResolvedDocument[] = Object.entries(fixture.documents).map(
    ([path, { content, role }]) => ({ path, content, role }),
  );
  const rac = resolveFromExplicit(fixture.metadata);
  if (docs.length) rac.documents = docs;

  const ctx = {
    project: 'test',
    featurePath: '/tmp/test',
    featureFolder: 'test',
  } as any;

  const currentTask: Record<string, any> = {
    name: label,
    type: 'feature',
    priority: 200,
    description: fixture.directive,
  };
  if (fixture.targetFile) {
    currentTask.targetFile = fixture.targetFile;
  }

  return { docs, rac, ctx, currentTask };
}

describe('Intent Acceptance', () => {
  for (const fixture of FIXTURES) {
    const label = `${fixture.intent}${fixture.metadata.basis ? ':' + fixture.metadata.basis : ''}`;

    describe(label, () => {

      // ── Stage 1: Config Matrix ──

      it('config matrix has valid slots', () => {
        const basis = fixture.metadata.basis!;
        expect(getAvailableBases(fixture.intent)).toContain(basis);
        const slots = getConfigSlots(fixture.intent, basis);
        expect(slots).not.toBeNull();
      });

      // ── Stage 2: RAC Routing ──

      it('RAC routing matches expected', () => {
        const rac = resolveFromExplicit(fixture.metadata);
        const derived = deriveFromIntent(fixture.intent);

        expect(derived.agent).toBe(fixture.routing.agent);
        expect(derived.jobType).toBe(fixture.routing.jobType);
        expect(rac.jobMode).toBe(fixture.routing.jobMode);

        if (fixture.routing.workType) {
          expect(rac.workType).toBe(fixture.routing.workType);
        }
        if (fixture.routing.environment) {
          expect(rac.tech.environment).toBe(fixture.routing.environment);
        }

        if (fixture.metadata.refs?.length) {
          expect(rac.refs).toEqual(fixture.metadata.refs);
        }
        if (fixture.metadata.context?.length) {
          expect(rac.context).toEqual(fixture.metadata.context);
        }
        if (fixture.metadata.basis) {
          expect(rac.basis).toBe(fixture.metadata.basis);
        }
      });

      // ── Stage 3: Prompt Build (code/design only) ──

      if (['code', 'design'].includes(fixture.routing.jobType)) {
        it('prompt build: injections match', async () => {
          const { docs, rac, ctx, currentTask } = buildPromptArgs(fixture, label);

          const result = await engine.buildExecutePrompt(
            fixture.routing.jobType as any,
            ctx,
            {
              directive: fixture.directive,
              documents: docs.length ? docs : undefined,
              resolvedAction: rac,
              currentTask,
            },
            undefined,
            fixture.routing.jobType === 'design' ? undefined : 'feature',
          );

          const inj = result.modeConfig.templates.injections;

          for (const req of fixture.prompt.requiredInjections) {
            expect(
              inj.some(i => i.includes(req)),
              `Expected injection containing "${req}" but got: [${inj.join(', ')}]`,
            ).toBe(true);
          }
          for (const forbidden of fixture.prompt.forbiddenInjections) {
            expect(
              inj.some(i => i.includes(forbidden)),
              `Forbidden injection "${forbidden}" found in: [${inj.join(', ')}]`,
            ).toBe(false);
          }
        });

        it('prompt text snapshot', async () => {
          const { docs, rac, ctx, currentTask } = buildPromptArgs(fixture, label);

          const result = await engine.buildExecutePrompt(
            fixture.routing.jobType as any,
            ctx,
            {
              directive: fixture.directive,
              documents: docs.length ? docs : undefined,
              resolvedAction: rac,
              currentTask,
            },
            undefined,
            fixture.routing.jobType === 'design' ? undefined : 'feature',
          );

          const text = engine.extractPromptText(result);
          for (const keyword of fixture.prompt.mustContain) {
            expect(text).toContain(keyword);
          }
          expect(result.modeConfig.templates.injections).toMatchSnapshot();
        });
      }
    });
  }
});
