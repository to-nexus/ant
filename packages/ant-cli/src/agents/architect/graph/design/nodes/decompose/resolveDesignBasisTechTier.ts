/**
 * Single owner for design-side techTier resolution.
 *
 * Design doc jobs (spec / system-design / their revise variants) ground on an
 * existing codebase to write the plan a code job will execute. The stack must
 * reflect that codebase — NOT a hardcoded `'frontend'` default, and NOT a guess
 * from the directive wording. This helper anchors `basis.techTier` to the real
 * codebase via the analyzer PORT (hexagonal: no adapter import), gated on
 * `hasCodebase`. Greenfield / undetectable → `undefined` (no fabrication), so
 * the chat techTier section and the basis renderer stay silent rather than
 * asserting a stack we did not observe.
 */

import { buildTechTier, type TechTierConfig } from "@ant/shared";
import type { DesignGraphState } from "../../state";

export async function resolveDesignBasisTechTier(
  state: DesignGraphState,
): Promise<TechTierConfig | undefined> {
  if (!state.workspaceState?.hasCodebase) return undefined;

  const analyzer = state.deps?.analyzer;
  if (!analyzer?.detectStack) return undefined;

  const featurePath = state.context?.featurePath;
  if (!featurePath) return undefined;
  const codebasePath = process.env.ANT_CODEBASE_PATH || `${featurePath}/codebase`;

  const detected = await analyzer.detectStack(codebasePath);
  if (!detected?.stack) return undefined;

  const { stack, language, framework } = detected;

  if (stack === 'fullstack') {
    return {
      stack: 'fullstack',
      frontend: { ...buildTechTier({ language }, 'frontend'), stack: 'frontend' },
      backend: { ...buildTechTier({ language, framework }, 'backend'), stack: 'backend' },
    };
  }

  const key = stack as 'frontend' | 'backend';
  const config: TechTierConfig = { stack: key };
  config[key] = { ...buildTechTier({ language, framework }, key), stack: key };
  return config;
}
