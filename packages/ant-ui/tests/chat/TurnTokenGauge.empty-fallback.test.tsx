/**
 * TurnTokenGauge always-visible invariant — regression guard.
 *
 * The gauge MUST NEVER render `null` even when both `livePhases` and
 * `baselinePhase` are absent. Previously the component returned `null`
 * in that state, which made the chat-input gauge disappear during
 * idle / fetch-fail / job-end transitions. The fix synthesizes a
 * 0-token placeholder ring with a sticky `contextWindow`.
 *
 * Three cases lock the contract:
 *  - C1: both empty → placeholder renders, contextWindow = DEFAULT_FALLBACK_CONTEXT_WINDOW
 *  - C2: live arrives (contextWindow=200K Haiku) → both clear → placeholder inherits 200K (sticky, NOT the default 1M)
 *  - C3: live + baseline both present → live wins (unchanged behaviour)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { PhaseTokenUsage } from '@ant/shared';
import { DEFAULT_FALLBACK_CONTEXT_WINDOW } from '@ant/shared';

// ─────────────────────────────────────────────────────────────────────
// Mocks — keep the gauge isolated from real store / Tooltip / i18n.
// ─────────────────────────────────────────────────────────────────────

let mockKanban: {
  currentPhaseTokenUsages?: PhaseTokenUsage[];
  baselinePhaseTokenUsage?: PhaseTokenUsage;
} = {};

vi.mock('@/domain/store', () => ({
  useStore: (selector: (s: any) => any) => selector({ kanban: mockKanban }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/presentation/components/common/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));

// Capture the phase prop every TokenRing receives so we can assert the
// placeholder shape without depending on TurnTokenRing internals.
const capturedPhases: PhaseTokenUsage[] = [];
vi.mock('../../src/presentation/components/chat/TurnTokenRing', () => ({
  TokenRing: ({ phase }: { phase: PhaseTokenUsage }) => {
    capturedPhases.push(phase);
    return null;
  },
  summarizeRing: () => ({ title: '', percent: '' }),
}));

import { TurnTokenGauge } from '../../src/presentation/components/chat/TurnTokenGauge';

beforeEach(() => {
  mockKanban = {};
  capturedPhases.length = 0;
});

function liveSnapshot(contextWindow: number, tokens = 1234): PhaseTokenUsage {
  return {
    phase: 'decompose',
    label: 'decompose',
    mode: 'live',
    contextWindow,
    tokenUsage: { inputTokens: tokens, outputTokens: 0, totalTokens: tokens },
  };
}

function baselineSnapshot(contextWindow: number, tokens = 5678): PhaseTokenUsage {
  return {
    phase: 'baseline-decompose',
    label: 'code/decompose',
    mode: 'baseline',
    contextWindow,
    tokenUsage: { inputTokens: tokens, outputTokens: 0, totalTokens: tokens },
  };
}

function lastPlaceholder(): PhaseTokenUsage | undefined {
  return capturedPhases[capturedPhases.length - 1];
}

describe('TurnTokenGauge — empty fallback (always visible)', () => {
  it('C1: empty live + empty baseline → renders placeholder ring with DEFAULT contextWindow', () => {
    mockKanban = {};
    let tree: ReactTestRenderer | undefined;
    act(() => {
      tree = create(<TurnTokenGauge />);
    });

    // Must NOT collapse to null.
    expect(tree!.toJSON()).not.toBeNull();
    // Exactly one ring (the placeholder).
    expect(capturedPhases).toHaveLength(1);
    const ph = lastPlaceholder()!;
    expect(ph.mode).toBe('baseline');
    expect(ph.tokenUsage.inputTokens).toBe(0);
    expect(ph.tokenUsage.totalTokens).toBe(0);
    expect(ph.contextWindow).toBe(DEFAULT_FALLBACK_CONTEXT_WINDOW);
  });

  it('C2: live arrives (200K Haiku) then both clear → placeholder inherits the 200K contextWindow (sticky, NOT default 1M)', () => {
    // Frame 1: live phase with Haiku 4.5's 200K context window (non-default
    // — the gauge's DEFAULT_FALLBACK is 1M, matching Opus 4.8 / Sonnet 4.6).
    mockKanban = { currentPhaseTokenUsages: [liveSnapshot(200_000)] };
    let tree: ReactTestRenderer | undefined;
    act(() => {
      tree = create(<TurnTokenGauge />);
    });
    expect(capturedPhases).toHaveLength(1);
    expect(capturedPhases[0].contextWindow).toBe(200_000);
    expect(capturedPhases[0].mode).toBe('live');

    // Frame 2: both cleared. Force a re-render of the SAME instance so
    // the internal useRef survives — that's the sticky cache under test.
    mockKanban = {};
    act(() => {
      tree!.update(<TurnTokenGauge />);
    });
    // Two renders => two TokenRing prop captures.
    expect(capturedPhases.length).toBeGreaterThanOrEqual(2);
    const placeholder = lastPlaceholder()!;
    expect(placeholder.mode).toBe('baseline');
    expect(placeholder.tokenUsage.totalTokens).toBe(0);
    // Sticky: NOT the default 1M — the last-known 200K is preserved.
    expect(placeholder.contextWindow).toBe(200_000);
  });

  it('C3: live + baseline both present → live wins (unchanged behaviour)', () => {
    mockKanban = {
      currentPhaseTokenUsages: [liveSnapshot(200_000, 4321)],
      baselinePhaseTokenUsage: baselineSnapshot(200_000, 9999),
    };
    let tree: ReactTestRenderer | undefined;
    act(() => {
      tree = create(<TurnTokenGauge />);
    });
    expect(tree!.toJSON()).not.toBeNull();
    expect(capturedPhases).toHaveLength(1);
    expect(capturedPhases[0].mode).toBe('live');
    expect(capturedPhases[0].tokenUsage.totalTokens).toBe(4321);
  });
});
