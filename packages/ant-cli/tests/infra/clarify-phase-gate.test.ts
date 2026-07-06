import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getClarifyPolicy,
  isClarifyActive,
  ExecutionTierId,
  type IntentId,
} from '@ant/shared';

// Mock the transport so the gate never touches ChatAPIClient.
const sendClarifyMock = vi.fn(async () => {});
vi.mock('../../src/agents/common/clarify/transport', () => ({
  sendClarify: (...args: unknown[]) => sendClarifyMock(...args),
}));

import { applyClarifyGate } from '../../src/agents/common/clarify/phaseGate';

const CLARIFY = '<clarify question="Which DB?"><option>a) Postgres</option><option>b) SQLite</option></clarify>';

describe('clarify policy matrix', () => {
  it('wired gen intents are enabled (plan/spec/code/system-design)', () => {
    for (const id of ['gen-plan', 'gen-spec', 'gen-code-sys', 'gen-code-spec', 'gen-code-directive', 'rev-code',
      'gen-sys-fe', 'gen-sys-be', 'gen-sys-full'] as IntentId[]) {
      expect(getClarifyPolicy(id).clarifyEnabled).toBe(true);
    }
  });

  it('system-design clarify fires at the decompose phase only (pre-fan-out seam)', () => {
    for (const id of ['gen-sys-fe', 'gen-sys-be', 'gen-sys-full'] as IntentId[]) {
      expect(getClarifyPolicy(id).clarifyPhases).toEqual(['decompose']);
      // Tierless-style: no minTier, so a clarify-only response (no tier tag) is not floored.
      expect(isClarifyActive(id, 'decompose')).toBe(true);
      expect(isClarifyActive(id, 'docgen')).toBe(false);
    }
  });

  it('deferred/disabled intents are off (visual, ui/game-art design, review/explain/ask/learn)', () => {
    for (const id of [
      'gen-visual-logo', 'gen-ui-desc', 'gen-game-art-desc',
      'explain-code', 'gen-ui-figma', 'ask-general', 'gen-learn', 'rev-plan',
      'rev-sys', 'explain-sys',
    ] as IntentId[]) {
      expect(getClarifyPolicy(id).clarifyEnabled).toBe(false);
    }
  });

  it('isClarifyActive gates on phase membership', () => {
    // gen-code-sys only allows decompose
    expect(isClarifyActive('gen-code-sys', 'decompose', ExecutionTierId.Task)).toBe(true);
    expect(isClarifyActive('gen-code-sys', 'detect', ExecutionTierId.Task)).toBe(false);
  });

  it('isClarifyActive suppresses below the tier floor', () => {
    // gen-code-sys minTier = Task(3)
    expect(isClarifyActive('gen-code-sys', 'decompose', ExecutionTierId.Exploratory)).toBe(false);
    expect(isClarifyActive('gen-code-sys', 'decompose', ExecutionTierId.Task)).toBe(true);
  });

  it('tierless jobs (plan) pass the tier check when tier omitted', () => {
    expect(isClarifyActive('gen-plan', 'generate')).toBe(true);
    // gen-spec (design docgen) is also tierless.
    expect(isClarifyActive('gen-spec', 'docgen')).toBe(true);
  });

  it('disabled intent is never active', () => {
    expect(isClarifyActive('explain-code', 'decompose', ExecutionTierId.Task)).toBe(false);
  });
});

describe('applyClarifyGate', () => {
  beforeEach(() => sendClarifyMock.mockClear());

  it('passes through untouched when no <clarify> present', async () => {
    const r = await applyClarifyGate({
      responseText: 'just prose',
      intent: 'gen-code-directive',
      phase: 'decompose',
      tier: ExecutionTierId.Task,
    });
    expect(r.paused).toBe(false);
    expect(r.blocks).toHaveLength(0);
    expect(sendClarifyMock).not.toHaveBeenCalled();
  });

  it('pauses and sends cards when active + budget available', async () => {
    const r = await applyClarifyGate({
      responseText: `intro\n${CLARIFY}`,
      intent: 'gen-code-directive',
      phase: 'decompose',
      tier: ExecutionTierId.Task,
      clarifyRoundsUsed: 0,
    });
    expect(r.paused).toBe(true);
    expect(r.stateUpdates.awaitingClarify).toBe(true);
    expect(r.stateUpdates.clarifyPhase).toBe('decompose');
    expect(r.stateUpdates.clarifyRoundsUsed).toBe(1);
    expect(r.cleanedText).toContain('intro');
    expect(r.cleanedText).not.toContain('<clarify');
    expect(sendClarifyMock).toHaveBeenCalledOnce();
  });

  it('does NOT pause when policy inactive here — strips + proceed note', async () => {
    // detect is not an allowed phase for gen-code-sys
    const r = await applyClarifyGate({
      responseText: CLARIFY,
      intent: 'gen-code-sys',
      phase: 'detect',
      tier: ExecutionTierId.Task,
    });
    expect(r.paused).toBe(false);
    expect(r.proceedNote).toBeTruthy();
    expect(sendClarifyMock).not.toHaveBeenCalled();
  });

  it('default-and-proceed when budget exhausted', async () => {
    // gen-code-sys budget = 1
    const r = await applyClarifyGate({
      responseText: CLARIFY,
      intent: 'gen-code-sys',
      phase: 'decompose',
      tier: ExecutionTierId.Task,
      clarifyRoundsUsed: 1,
    });
    expect(r.paused).toBe(false);
    expect(r.proceedNote).toBeTruthy();
    expect(sendClarifyMock).not.toHaveBeenCalled();
  });

  it('requireOptions drops option-less blocks (planner strict filter)', async () => {
    const bareBody = '<clarify>\n- open question with no options\n</clarify>';
    const r = await applyClarifyGate({
      responseText: bareBody,
      intent: 'gen-plan',
      phase: 'generate',
      requireOptions: true,
    });
    expect(r.paused).toBe(false);
    expect(sendClarifyMock).not.toHaveBeenCalled();
  });
});
