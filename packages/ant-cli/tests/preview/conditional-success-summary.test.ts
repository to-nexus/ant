import { describe, expect, it } from 'vitest';

import { summarizePreviewSpawnOutcome } from '../../src/periphery/adapters/http/services/PreviewService/PreviewService';

// Mock just enough of `ChildProcess` for the helper. Only `exitCode` is read.
function child(exitCode: number | null): { exitCode: number | null } {
  return { exitCode };
}

describe('summarizePreviewSpawnOutcome', () => {
  it('all packages still running → success summary that the FE state machine matches', () => {
    const result = summarizePreviewSpawnOutcome([
      { name: 'apps/console', process: child(null) as any },
      { name: 'apps/hub', process: child(null) as any },
    ]);
    expect(result).toEqual({
      type: 'stdout',
      message: '✅ All preview servers started successfully!',
    });
    // The FE preview state machine at preview.ts:131 matches this exact substring.
    expect(result.message).toContain('All preview servers started');
  });

  it('one package crashed during settling → factual failure summary, NOT success', () => {
    const result = summarizePreviewSpawnOutcome([
      { name: 'apps/console', process: child(null) as any },
      { name: 'apps/hub', process: child(1) as any },
    ]);
    expect(result.type).toBe('stderr');
    expect(result.message).toBe(
      '❌ Preview started with 1 failed package(s): apps/hub',
    );
    // Crucially the success literal is NOT emitted, so the FE state machine
    // doesn't transition to 'running'.
    expect(result.message).not.toContain('All preview servers started');
    expect(result.message).not.toContain('successfully');
  });

  it('multiple packages crashed → all listed in failure summary', () => {
    const result = summarizePreviewSpawnOutcome([
      { name: 'apps/api', process: child(2) as any },
      { name: 'apps/console', process: child(null) as any },
      { name: 'apps/hub', process: child(1) as any },
    ]);
    expect(result.type).toBe('stderr');
    expect(result.message).toBe(
      '❌ Preview started with 2 failed package(s): apps/api, apps/hub',
    );
  });

  it('package with exitCode=0 (clean exit during settling) treated as healthy — only non-zero counts', () => {
    // Edge case: an exit-zero is "completed cleanly", not a crash. This should
    // still produce the success summary.
    const result = summarizePreviewSpawnOutcome([
      { name: 'apps/console', process: child(0) as any },
      { name: 'apps/hub', process: child(null) as any },
    ]);
    expect(result.type).toBe('stdout');
    expect(result.message).toContain('All preview servers started');
  });

  it('package with no process attached → ignored (not counted as crash)', () => {
    const result = summarizePreviewSpawnOutcome([
      { name: 'apps/console', process: child(null) as any },
      { name: 'apps/hub', process: null },
    ]);
    expect(result.type).toBe('stdout');
  });
});
