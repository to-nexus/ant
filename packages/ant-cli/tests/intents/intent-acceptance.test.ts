import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';
import {
  resolveToRAC,
  getConfigSlots,
  deriveFromIntent,
  getPromptPolicies,
  POLICY_TEMPLATE_MAP,
} from '@ant/shared';
import type { IntentId, ResolvedArtifact, PolicyKey } from '@ant/shared';
import { PromptBuilder } from '../../src/core/prompt/builder/PromptBuilder';
import { deriveArtifactPolicies } from '../../src/core/prompt/builder/ArtifactRoleResolver';
import type { PromptBuildConfig } from '../../src/core/prompt/builder/PromptBuildConfig';
import { FIXTURES, IntentFixture } from './dataset';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');

let promptBuilder: PromptBuilder;

beforeAll(async () => {
  await initPartials(TEMPLATES_DIR);
  const adapter = new FilePromptAdapter(TEMPLATES_DIR);
  promptBuilder = new PromptBuilder(adapter);
});

function buildPromptArgs(fixture: IntentFixture) {
  const docs: ResolvedArtifact[] = Object.entries(fixture.documents).map(
    ([path, { content, role }]) => ({ path, content, role }),
  );
  const rac = resolveToRAC(
    fixture.metadata.intent as IntentId,
    { target: fixture.metadata.target, refs: fixture.metadata.refs, context: fixture.metadata.context },
    'explicit',
  );

  return { docs, rac };
}

function buildConfig(fixture: IntentFixture): PromptBuildConfig {
  const { docs, rac } = buildPromptArgs(fixture);
  const intent = fixture.metadata.intent as IntentId;
  const derived = deriveFromIntent(intent);

  const artifactPolicies: PolicyKey[] = docs.length
    ? deriveArtifactPolicies(intent, docs)
    : [];

  return {
    templates: {
      base: fixture.prompt.templateBase,
      rules: fixture.prompt.templateBase.replace(/\/base/, '/rules').replace(/base-/, 'rules-'),
      system: derived.jobType === 'code'
        ? 'code/base/system'
        : derived.jobType === 'design'
          ? 'design/base/system'
          : undefined,
    },
    intent,
    artifactPolicies,
    techContext: {
      taskType: 'feature',
      mode: rac.mode,
      resolvedAction: rac,
    },
    pipeline: {
      sanitizeInput: false,
      includeTechProfile: false,
      includeExamples: false,
      applyPolicyGuardrails: false,
    },
    vars: {
      directive: fixture.directive,
      resolvedAction: rac,
      ...(docs.length > 0 ? { documents: docs, hasDocuments: true } : {}),
      ...(fixture.targetFile ? { targetFile: fixture.targetFile } : {}),
    },
    artifacts: docs.length > 0 ? docs : undefined,
  };
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

      if (['code', 'design'].includes(fixture.routing.jobType)) {
        it('prompt build: required injections present', async () => {
          const config = buildConfig(fixture);
          const result = await promptBuilder.build(config);

          for (const required of fixture.prompt.requiredInjections) {
            expect(
              result.injections,
              `${label}: missing required injection "${required}"`,
            ).toContain(required);
          }
        });

        it('prompt build: forbidden injections absent', async () => {
          const config = buildConfig(fixture);
          const result = await promptBuilder.build(config);

          for (const forbidden of fixture.prompt.forbiddenInjections) {
            expect(
              result.injections,
              `${label}: should not contain forbidden injection "${forbidden}"`,
            ).not.toContain(forbidden);
          }
        });

        it('prompt build: injection list snapshot', async () => {
          const config = buildConfig(fixture);
          const result = await promptBuilder.build(config);
          expect(result.injections).toMatchSnapshot();
        });
      }
    });
  }
});
