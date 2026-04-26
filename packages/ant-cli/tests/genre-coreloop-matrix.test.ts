/**
 * I9 — Genre × CoreLoop Matrix Gate (D31-revised v8)
 *
 * The matrix is the SOLE SSOT for "which coreLoops are reachable per genre".
 * Three guards land here:
 *
 *   1. `coreLoopCandidatesFor(genre)` returns exactly the matrix row for
 *      every registered genre (registry-disk 1:1 invariant for the matrix).
 *
 *   2. The DecisionTagRegistry parser drops a coreLoop value that the
 *      matrix does not admit for the resolved genre — this is the parse-
 *      time gate that catches LLM mismatches without requiring node-side
 *      branching.
 *
 *   3. Decompose's `gameCoreLoopCandidates` enrichedVar consults
 *      `coreLoopCandidatesFor` (verified by import — the symbol crosses
 *      the boundary). The actual narrowing is exercised by the parser
 *      gate above when a node feeds a state.basis.gameContentTier.genre.
 */

import { describe, it, expect } from 'vitest';
import {
  GAME_GENRE_VARIANTS,
  GAME_CORE_LOOP_VARIANTS,
  GENRE_CORELOOP_MATRIX,
  coreLoopCandidatesFor,
} from '@ant/shared';
import { parseDecisionTags } from '../src/core/llm-response/DecisionTagRegistry';

describe('I9 — Matrix definition (registry SSOT)', () => {
  it('GENRE_CORELOOP_MATRIX has a row for every registered genre', () => {
    for (const genre of GAME_GENRE_VARIANTS) {
      expect(GENRE_CORELOOP_MATRIX[genre]).toBeDefined();
    }
    expect(Object.keys(GENRE_CORELOOP_MATRIX).sort()).toEqual([...GAME_GENRE_VARIANTS].sort());
  });

  it('every coreLoop in every matrix row is a registered coreLoop variant', () => {
    for (const genre of GAME_GENRE_VARIANTS) {
      for (const loop of GENRE_CORELOOP_MATRIX[genre]) {
        expect(GAME_CORE_LOOP_VARIANTS).toContain(loop);
      }
    }
  });

  it('every matrix row is non-empty (no orphan genre)', () => {
    for (const genre of GAME_GENRE_VARIANTS) {
      expect(GENRE_CORELOOP_MATRIX[genre].length).toBeGreaterThan(0);
    }
  });
});

describe('I9 — coreLoopCandidatesFor (helper SSOT)', () => {
  it('returns the matrix row for a known genre', () => {
    expect(coreLoopCandidatesFor('match3')).toEqual(GENRE_CORELOOP_MATRIX.match3);
    expect(coreLoopCandidatesFor('slidingPuzzle')).toEqual(GENRE_CORELOOP_MATRIX.slidingPuzzle);
    expect(coreLoopCandidatesFor('cardSolitaire')).toEqual(GENRE_CORELOOP_MATRIX.cardSolitaire);
    expect(coreLoopCandidatesFor('arcadePaddle')).toEqual(GENRE_CORELOOP_MATRIX.arcadePaddle);
    expect(coreLoopCandidatesFor('arcadeSnake')).toEqual(GENRE_CORELOOP_MATRIX.arcadeSnake);
  });

  it('falls back to the universe (GAME_CORE_LOOP_VARIANTS) when genre is undefined', () => {
    expect(coreLoopCandidatesFor(undefined)).toEqual(GAME_CORE_LOOP_VARIANTS);
  });

  it('matrix narrows the candidate set strictly for slidingPuzzle (single-element)', () => {
    expect(coreLoopCandidatesFor('slidingPuzzle')).toEqual(['solve']);
    expect(coreLoopCandidatesFor('slidingPuzzle')).not.toContain('collect');
    expect(coreLoopCandidatesFor('slidingPuzzle')).not.toContain('survive');
  });

  it('matrix admits two loops for match3 / cardSolitaire / arcadePaddle / arcadeSnake', () => {
    expect(coreLoopCandidatesFor('match3').length).toBe(2);
    expect(coreLoopCandidatesFor('cardSolitaire').length).toBe(2);
    expect(coreLoopCandidatesFor('arcadePaddle').length).toBe(2);
    expect(coreLoopCandidatesFor('arcadeSnake').length).toBe(2);
  });
});

describe('I9 — DecisionTagRegistry parser gate', () => {
  // Parse-time matrix gate: a (genre, coreLoop) pair outside the matrix
  // results in coreLoop being dropped (the genre survives so the LLM can
  // be retried with a narrowed candidate set).

  it('drops slidingPuzzle × collect (matrix admits only [solve])', () => {
    const r = parseDecisionTags('<gameContentTier>genre=slidingPuzzle,coreLoop=collect</gameContentTier>');
    expect(r.parsed.gameContentTier).toEqual({ genre: 'slidingPuzzle' });
  });

  it('drops slidingPuzzle × survive (matrix admits only [solve])', () => {
    const r = parseDecisionTags('<gameContentTier>genre=slidingPuzzle,coreLoop=survive</gameContentTier>');
    expect(r.parsed.gameContentTier).toEqual({ genre: 'slidingPuzzle' });
  });

  it('drops cardSolitaire × survive (matrix admits [solve, collect])', () => {
    const r = parseDecisionTags('<gameContentTier>genre=cardSolitaire,coreLoop=survive</gameContentTier>');
    expect(r.parsed.gameContentTier).toEqual({ genre: 'cardSolitaire' });
  });

  it('drops match3 × survive (matrix admits [solve, collect])', () => {
    const r = parseDecisionTags('<gameContentTier>genre=match3,coreLoop=survive</gameContentTier>');
    expect(r.parsed.gameContentTier).toEqual({ genre: 'match3' });
  });

  it('drops arcadePaddle × solve (matrix admits [survive, collect])', () => {
    const r = parseDecisionTags('<gameContentTier>genre=arcadePaddle,coreLoop=solve</gameContentTier>');
    expect(r.parsed.gameContentTier).toEqual({ genre: 'arcadePaddle' });
  });

  it('drops arcadeSnake × solve (matrix admits [survive, collect])', () => {
    const r = parseDecisionTags('<gameContentTier>genre=arcadeSnake,coreLoop=solve</gameContentTier>');
    expect(r.parsed.gameContentTier).toEqual({ genre: 'arcadeSnake' });
  });
});

describe('I9 — DecisionTagRegistry parser admits matrix-allowed pairs', () => {
  it.each([
    ['match3', 'solve'],
    ['match3', 'collect'],
    ['slidingPuzzle', 'solve'],
    ['cardSolitaire', 'solve'],
    ['cardSolitaire', 'collect'],
    ['arcadePaddle', 'survive'],
    ['arcadePaddle', 'collect'],
    ['arcadeSnake', 'survive'],
    ['arcadeSnake', 'collect'],
  ] as const)('keeps %s × %s (matrix-admitted)', (genre, coreLoop) => {
    const r = parseDecisionTags(`<gameContentTier>genre=${genre},coreLoop=${coreLoop}</gameContentTier>`);
    expect(r.parsed.gameContentTier).toEqual({ genre, coreLoop });
  });
});

describe('I9 — Decompose enrichedVars consult coreLoopCandidatesFor (no node-side branch)', () => {
  it('decompose/index.ts imports coreLoopCandidatesFor from @ant/shared', async () => {
    // The enrichedVars serialization is wired in
    // `packages/ant-cli/src/agents/architect/graph/code/nodes/decompose/index.ts`.
    // The wiring is verified here by source-level import (the matrix
    // path through the system has no run-time branch on genre values).
    const fs = await import('node:fs');
    const path = await import('node:path');
    const decomposeIndex = path.resolve(__dirname, '../src/agents/architect/graph/code/nodes/decompose/index.ts');
    const src = fs.readFileSync(decomposeIndex, 'utf8');
    expect(src).toMatch(/coreLoopCandidatesFor/);
    // No raw genre branching in this file (avoid `if (genre === 'match3')`-style
    // conditionals — D6 / I1 Domain-Branching Locality).
    expect(src).not.toMatch(/if\s*\(.*genre\s*===\s*['"]match3['"]/);
    expect(src).not.toMatch(/if\s*\(.*genre\s*===\s*['"]slidingPuzzle['"]/);
  });
});
