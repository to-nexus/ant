/**
 * P1 — "Recent Conversation" rich-tail render locks (e2-humming-spindle).
 *
 * Two conversational-rim consumers render the chat tail:
 *  - ask agent base (jobs/ask/nodes/agent/variants/default/base.md)
 *  - Tier 0/1 direct base (jobs/code/nodes/direct/variants/default/base.md)
 *
 * The direct template supersedes its legacy "Recent User Turns" list when a
 * tail is present (same user text would otherwise inject twice).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_DIR = path.join(__dirname, '../../src/core/prompt/templates');

const TAIL = {
  exchanges: [
    {
      turnId: 't1', jobType: 'design', ts: '2026-07-21T00:00:01Z',
      userText: 'pick between option A and option B',
      assistantText: 'I recommend option B — it matches the existing spec.',
    },
    {
      turnId: 't2', jobType: 'code', ts: '2026-07-21T00:00:02Z',
      userText: 'go with the second one',
    },
  ],
};

describe('recent conversation injection (P1)', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
    await initPartials(TEMPLATES_DIR);
  });

  it('ask agent base renders the exchanges with assistant utterances', async () => {
    const output = await adapter.render('jobs/ask/nodes/agent/variants/default/base', {
      question: 'what did you just change?',
      currentJob: 'design',
      currentAgent: 'architect',
      jobKnowledge: '',
      recentConversation: TAIL,
    });

    expect(output).toContain('Recent Conversation');
    expect(output).toContain('pick between option A and option B');
    expect(output).toContain('I recommend option B');
    expect(output).toContain('what did you just change?');
  });

  it('ask agent base omits the section without a tail', async () => {
    const output = await adapter.render('jobs/ask/nodes/agent/variants/default/base', {
      question: 'q',
      currentJob: 'design',
      currentAgent: 'architect',
      jobKnowledge: '',
    });

    expect(output).not.toContain('Recent Conversation');
  });

  it('direct base renders exchanges and supersedes the user-turns list', async () => {
    const output = await adapter.render('jobs/code/nodes/direct/variants/default/base', {
      directive: 'do it',
      featureContext: {
        userTurns: [{ turnId: 't-x', text: 'LEGACY-TURN-LIST-ENTRY' }],
        breadcrumbs: [],
      },
      recentConversation: TAIL,
      userLanguage: 'en',
    });

    expect(output).toContain('Recent Conversation');
    expect(output).toContain('I recommend option B');
    // The legacy list is replaced, not duplicated.
    expect(output).not.toContain('LEGACY-TURN-LIST-ENTRY');
  });

  it('direct base falls back to the user-turns list without a tail', async () => {
    const output = await adapter.render('jobs/code/nodes/direct/variants/default/base', {
      directive: 'do it',
      featureContext: {
        userTurns: [{ turnId: 't-x', text: 'LEGACY-TURN-LIST-ENTRY' }],
        breadcrumbs: [],
      },
      userLanguage: 'en',
    });

    expect(output).toContain('LEGACY-TURN-LIST-ENTRY');
    expect(output).not.toContain('Recent Conversation');
  });
});
