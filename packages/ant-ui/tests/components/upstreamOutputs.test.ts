/**
 * upstreamOutputSuggestions — the context-pin suggestion source: upstream
 * steps' pinned-intent `hooks.stop` artifact globs, resolved account-scoped
 * from the discovery catalog. Table test over the closure/skip/dedupe rules.
 */
import { describe, it, expect } from 'vitest';
import type { PipelineDef } from '@ant/shared';
import { upstreamOutputSuggestions } from '../../src/presentation/components/Pipelines/upstreamOutputs';

const AGENTS = [
  {
    id: 'research',
    jobs: [
      {
        id: 'collect',
        intents: [
          { id: 'gather', hooks: { stop: [{ artifact: 'sources/**' }, { action: 'mcp__web__fetch' }] } },
          { id: 'summarize', hooks: { stop: [{ artifact: 'summaries/*.md' }] } },
        ],
      },
    ],
  },
  {
    id: 'writer',
    jobs: [
      { id: 'digest', intents: [{ id: 'draft', hooks: { stop: [{ artifact: 'drafts/*.md' }] } }] },
      { id: 'broken', intents: undefined }, // catalog failed to parse
    ],
  },
];

function def(steps: PipelineDef['steps']): PipelineDef {
  return { version: 2, name: 'p', on: { schedule: { cron: '0 9 * * 1' } }, steps };
}

describe('upstreamOutputSuggestions', () => {
  it('implicit-linear def: every prior step with a pinned intent contributes its artifact globs', () => {
    const d = def([
      { id: 'a', customJobRef: 'research/collect', intent: 'gather' },
      { id: 'b', customJobRef: 'writer/digest', intent: 'draft' },
      { id: 'c', customJobRef: 'writer/digest' },
    ]);
    expect(upstreamOutputSuggestions(d, 'c', AGENTS)).toEqual([
      { glob: 'sources/**', sourceStepId: 'a', intentId: 'gather' },
      { glob: 'drafts/*.md', sourceStepId: 'b', intentId: 'draft' },
    ]);
  });

  it('explicit needs DAG: only the transitive closure contributes (siblings excluded)', () => {
    const d = def([
      { id: 'a', customJobRef: 'research/collect', intent: 'gather' },
      { id: 'sibling', customJobRef: 'writer/digest', intent: 'draft', needs: ['a'] },
      { id: 'b', customJobRef: 'research/collect', intent: 'summarize', needs: ['a'] },
      { id: 'c', customJobRef: 'writer/digest', needs: ['b'] },
    ]);
    expect(upstreamOutputSuggestions(d, 'c', AGENTS)).toEqual([
      { glob: 'sources/**', sourceStepId: 'a', intentId: 'gather' },
      { glob: 'summaries/*.md', sourceStepId: 'b', intentId: 'summarize' },
    ]);
  });

  it('skips: approval gates, steps without a pinned intent, broken catalogs, action hooks', () => {
    const d = def([
      { id: 'no-intent', customJobRef: 'research/collect' },
      { id: 'gate', type: 'approval', prompt: 'ok?' },
      { id: 'broken', customJobRef: 'writer/broken', intent: 'ghost' },
      { id: 'me', customJobRef: 'writer/digest' },
    ]);
    expect(upstreamOutputSuggestions(d, 'me', AGENTS)).toEqual([]);
  });

  it('the entry step has no upstream', () => {
    const d = def([
      { id: 'a', customJobRef: 'research/collect', intent: 'gather' },
      { id: 'b', customJobRef: 'writer/digest' },
    ]);
    expect(upstreamOutputSuggestions(d, 'a', AGENTS)).toEqual([]);
  });

  it('dedupes repeated globs and honors the cap', () => {
    const d = def([
      { id: 'a', customJobRef: 'research/collect', intent: 'gather' },
      { id: 'b', customJobRef: 'research/collect', intent: 'gather' },
      { id: 'c', customJobRef: 'writer/digest' },
    ]);
    expect(upstreamOutputSuggestions(d, 'c', AGENTS)).toHaveLength(1);
    expect(upstreamOutputSuggestions(d, 'c', AGENTS, 0)).toEqual([]);
  });

  it('unknown step id → empty (no throw on a mid-edit draft)', () => {
    expect(upstreamOutputSuggestions(def([]), 'ghost', AGENTS)).toEqual([]);
  });
});
