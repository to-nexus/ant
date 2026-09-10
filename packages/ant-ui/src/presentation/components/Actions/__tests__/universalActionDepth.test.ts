/**
 * The universal card surface's two structural rules.
 *
 * 1. Level resolution is ONE function over the shared `actionsStep` channel, so
 *    the actions panel and the chat action area — the only two places the
 *    agent/job/intent cards are exposed — cannot show different depths.
 * 2. Agents are partitioned by scope in one order everywhere they are listed.
 */

import { describe, it, expect } from 'vitest';
import type { CustomAgentScope } from '@ant/shared';
import { groupAgentsByScope, universalCardLevel } from '../universalSurfaceRules';

describe('universalCardLevel — one level per step, both surfaces', () => {
  it.each([
    ['pick-agent', 'agent'],
    ['pick-action', 'job'],
    ['pick-intent', 'intent'],
    // Panel-only steps: the chat clamps to the level above rather than blanking.
    ['intent-detail', 'job'],
    // Canonical-only steps never reach a universal project; they must still
    // resolve to a drawable level rather than throwing.
    ['config', 'job'],
    ['basis-edit', 'job'],
  ] as const)('%s → %s', (step, level) => {
    expect(universalCardLevel(step)).toBe(level);
  });
});

describe('groupAgentsByScope', () => {
  const agent = (id: string, scope: CustomAgentScope) => ({ id, scope });

  it('orders personal → organization → built-in', () => {
    const groups = groupAgentsByScope([
      agent('b', 'builtin'),
      agent('o', 'org'),
      agent('u', 'user'),
    ]);
    expect(groups.map((g) => g.scope)).toEqual(['user', 'org', 'builtin']);
    expect(groups.map((g) => g.agents.map((a) => a.id))).toEqual([['u'], ['o'], ['b']]);
  });

  it('drops empty groups — a picker has no reader for an empty header', () => {
    expect(groupAgentsByScope([agent('u', 'user')]).map((g) => g.scope)).toEqual(['user']);
    expect(groupAgentsByScope([])).toEqual([]);
  });

  it('keeps every agent of a group, in the order given', () => {
    const groups = groupAgentsByScope([agent('u2', 'user'), agent('b', 'builtin'), agent('u1', 'user')]);
    expect(groups[0].agents.map((a) => a.id)).toEqual(['u2', 'u1']);
  });
});
