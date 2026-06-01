import { describe, it, expect } from 'vitest';
import { createTaskQueue } from '../../src/agents/architect/graph/code/nodes/decompose/responseParser';
import { ARTIFACT_PREFIX } from '@ant/shared';

// ---------------------------------------------------------------------------
// Per-task injection narrowing via the single `include` SSOT. Locks:
//   1. Explicit per-task narrowing — an app task sees ONLY its own include,
//      never a sibling (admin) task's design doc.
//   2. RAC validation — out-of-RAC include paths are dropped in explicit mode.
// ---------------------------------------------------------------------------

const FE_APP = `${ARTIFACT_PREFIX.FE_SYSTEM}app.md`;
const FE_ADMIN = `${ARTIFACT_PREFIX.FE_SYSTEM}admin.md`;
const API = `${ARTIFACT_PREFIX.API_CONTRACT}main.md`;

function tier3(tasks: any[]) {
  return [
    ...tasks,
    { id: 'final-verification', name: 'Final Verification', type: 'verification' as const, priority: 1000, description: 'Verify' },
  ] as any;
}

describe('explicit per-task narrowing (app task does not receive admin doc)', () => {
  const racScope = { refs: [FE_APP, FE_ADMIN, API], context: [] };

  it('app task include = [fe-system-app, api-contract]; admin doc absent', () => {
    const { taskQueue } = createTaskQueue(
      tier3([
        { id: 'app', name: 'App', type: 'feature', priority: 300, stack: 'frontend', include: [FE_APP, API] },
        { id: 'admin', name: 'Admin', type: 'feature', priority: 301, stack: 'frontend', include: [FE_ADMIN, API] },
      ]),
      null, undefined, 3, racScope,
    );
    const app = taskQueue.getAll().find(t => t.id === 'app')!;
    const admin = taskQueue.getAll().find(t => t.id === 'admin')!;
    expect(app.include).toEqual([FE_APP, API]);
    expect(app.include).not.toContain(FE_ADMIN);
    expect(admin.include).toEqual([FE_ADMIN, API]);
    expect(admin.include).not.toContain(FE_APP);
  });

  it('out-of-RAC include path is dropped (RAC validation)', () => {
    const { taskQueue } = createTaskQueue(
      tier3([
        { id: 'app', name: 'App', type: 'feature', priority: 300, stack: 'frontend', include: [FE_APP, FE_ADMIN] },
      ]),
      null, undefined, 3,
      { refs: [FE_APP], context: [] }, // admin NOT in RAC
    );
    const app = taskQueue.getAll().find(t => t.id === 'app')!;
    expect(app.include).toEqual([FE_APP]);
  });

  it('retired carriers (artifactPolicy / packages / uiSections) are not set', () => {
    const { taskQueue } = createTaskQueue(
      tier3([{ id: 'app', name: 'App', type: 'feature', priority: 300, stack: 'frontend', include: [FE_APP] }]),
      null, undefined, 3, racScope,
    );
    const app = taskQueue.getAll().find(t => t.id === 'app')! as any;
    expect(app.artifactPolicy).toBeUndefined();
    expect(app.packages).toBeUndefined();
    expect(app.uiSections).toBeUndefined();
  });
});
