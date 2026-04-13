/**
 * ArtifactRoleResolver
 *
 * Programmatically derives artifact roles and conditional policies
 * from action-config-matrix — no document-peeking required.
 *
 * resolveArtifactRole():   config-matrix slots → 'ref' | 'context'
 * deriveArtifactPolicies(): config-matrix slots × policy-matrix conditionals → PolicyKey[]
 */

import type { IntentId, PolicyKey, ResolvedArtifact } from '@ant/shared';
import { getConfigSlots } from '@ant/shared';
import { getPromptPolicies } from '@ant/shared';

/**
 * Determine an artifact's role by checking whether its path falls
 * under a refs slot or a context slot in the config matrix.
 *
 * @param intent  - Current intent (determines which matrix entry to use)
 * @param artifactPath - Feature-relative path (e.g. 'outputs/design/ui/ui-spec.json')
 * @returns 'ref' if path matches a refs slot, 'context' otherwise
 */
export function resolveArtifactRole(
  intent: IntentId,
  artifactPath: string,
): 'ref' | 'context' {
  const slots = getConfigSlots(intent);
  if (!slots) return 'context';

  const isRef = slots.refs.some(
    slot => slot.path !== '' && artifactPath.startsWith(slot.path),
  );
  return isRef ? 'ref' : 'context';
}

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
