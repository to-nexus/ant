/**
 * Revision-preservation gate — routing + wiring regression.
 *
 * Serial router is unit-tested directly; the worker mirror (module-private
 * in workerGraph.ts) and both gate call sites are locked with static source
 * assertions (same pattern as the pat-auth-routing static guard) so the gate
 * cannot silently disappear from one of the two completion nodes.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { routeAfterCheckTaskStatus } from '../../src/agents/architect/graph/design/routing';
import type { DesignGraphState } from '../../src/agents/architect/graph/design/state';

const SRC = path.join(__dirname, '../../src/agents/architect/graph/design');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf-8');

describe('routeAfterCheckTaskStatus — revision gate', () => {
  const base = {
    taskQueue: { isEmpty: () => true },
  } as unknown as DesignGraphState;

  it('_specRevisionFailed routes back to execute', () => {
    expect(routeAfterCheckTaskStatus({ ...base, _specRevisionFailed: true } as any)).toBe('execute');
  });

  it('clean completion routes to learn', () => {
    expect(routeAfterCheckTaskStatus(base)).toBe('learn');
  });
});

describe('gate wiring — both completion nodes call the one reconcile owner', () => {
  const serial = read('graph.ts');
  const worker = read('parallel/workerGraph.ts');

  it('serial + worker call reconcileSpecDoc and honor violation.isRetryable', () => {
    for (const body of [serial, worker]) {
      expect(body).toContain('reconcileSpecDoc(');
      expect(body).toContain('reconcile.violation?.isRetryable === true');
      expect(body).toContain('buildSpecRevisionRetryMessage(');
      expect(body).toContain('_specRevisionRetried');
    }
  });

  it('worker router mirrors the serial _specRevisionFailed branch', () => {
    expect(worker).toMatch(
      /_assetValidationFailed \|\| state\._specRevisionFailed \|\| state\._bundleCoherenceFailed \? 'execute' : 'learn'/,
    );
  });

  it('completion returns reset both revision-gate flags (serial + worker)', () => {
    for (const body of [serial, worker]) {
      expect(body).toContain('_specRevisionFailed: false');
      expect(body).toContain('_specRevisionRetried: 0');
    }
  });

  it('channels declare the revision-gate flags (worker subgraph spreads them)', () => {
    expect(serial).toContain('_specRevisionFailed: Annotation<any>');
    expect(serial).toContain('_specRevisionRetried: Annotation<any>');
  });

  it('legacy enforceSpecDocIntegrity call sites are gone', () => {
    expect(serial).not.toContain('enforceSpecDocIntegrity');
    expect(worker).not.toContain('enforceSpecDocIntegrity');
  });
});

/**
 * Same dual-node hazard for the bundle name-binding gate. `assetValidation.ts`'s
 * header records the incident where a gate lived in the serial node only and
 * therefore never ran under the default `ANT_TASK_CONCURRENCY > 1`.
 */
describe('bundle coherence gate wiring — both completion nodes', () => {
  const serial = read('graph.ts');
  const worker = read('parallel/workerGraph.ts');

  it('serial + worker call the one coherence owner with the shared retry builder', () => {
    for (const body of [serial, worker]) {
      expect(body).toContain('validateTaskBundleCoherence(');
      expect(body).toContain('buildBundleCoherenceRetryMessage(');
      expect(body).toContain('isHandoffBundleTask(');
      expect(body).toContain('_bundleCoherenceRetried');
    }
  });

  it('both nodes gate on generate mode only', () => {
    for (const body of [serial, worker]) {
      expect(body).toMatch(/state\.resolvedAction\?\.mode \|\| 'generate'\) === 'generate'/);
    }
  });

  it('completion returns reset both coherence flags (serial + worker)', () => {
    for (const body of [serial, worker]) {
      expect(body).toContain('_bundleCoherenceFailed: false');
      expect(body).toContain('_bundleCoherenceRetried: 0');
    }
  });

  it('channels declare the coherence flags (worker subgraph spreads them)', () => {
    expect(serial).toContain('_bundleCoherenceFailed: Annotation<any>');
    expect(serial).toContain('_bundleCoherenceRetried: Annotation<any>');
  });

  it('serial router routes _bundleCoherenceFailed back to execute', () => {
    const base = { taskQueue: { isEmpty: () => true } } as unknown as DesignGraphState;
    expect(routeAfterCheckTaskStatus({ ...base, _bundleCoherenceFailed: true } as any)).toBe('execute');
  });

  it('the gate sits AFTER the zero-output guard in both nodes', () => {
    // A task that wrote nothing must raise design_no_output, not a coherence miss.
    for (const body of [serial, worker]) {
      expect(body.indexOf('validateTaskBundleCoherence(')).toBeGreaterThan(
        body.indexOf('isNoOutputCompletion('),
      );
    }
  });
});
