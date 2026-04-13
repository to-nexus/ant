/**
 * ArtifactRoleResolver
 *
 * Derives conditional policies from action-config-matrix — no document-peeking required.
 *
 * Role resolution is upstream (FE slot assignment or loadResolvedArtifacts),
 * NOT determined here. See design principle: "Role은 upstream 결정이다".
 *
 * deriveArtifactPolicies(): config-matrix slots × policy-matrix conditionals → PolicyKey[]
 */

import type { IntentId, PolicyKey, ResolvedArtifact } from '@ant/shared';
import { getConfigSlots } from '@ant/shared';
import { getPromptPolicies } from '@ant/shared';

/**
 * Derive Tier N (artifact-conditional) policies by cross-referencing
 * the assembled artifacts with config-matrix slots and the policy matrix's
 * conditionalPolicies.
 *
 * Only policies whose `slotPath` matches a slot with at least one
 * materialized artifact are included.
 *
 * @param intent   - Current intent
 * @param artifacts - Actually assembled artifacts (with feature-relative paths)
 * @returns Deduplicated PolicyKey[] to inject
 */
export function deriveArtifactPolicies(
  intent: IntentId,
  artifacts: ResolvedArtifact[],
): PolicyKey[] {
  const promptPolicy = getPromptPolicies(intent);
  if (!promptPolicy.conditionalPolicies?.length) return [];

  const slots = getConfigSlots(intent);
  if (!slots) return [];

  const allSlots = [...slots.refs, ...slots.context];

  const derived = promptPolicy.conditionalPolicies
    .filter(cp => {
      const slot = allSlots.find(s => s.path === cp.slotPath);
      return slot && artifacts.some(a => a.path.startsWith(slot.path));
    })
    .map(cp => cp.policy);

  return [...new Set(derived)];
}
