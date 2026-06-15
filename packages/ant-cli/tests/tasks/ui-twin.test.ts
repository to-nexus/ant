/**
 * ui twin derivation (item 5) — a ui task surfaces its paired feature twin
 * (full desc + files) via the shared `parallelGroup`, so the visual pass builds
 * on the materialized skeleton and inherits its content authority.
 */
import { describe, it, expect } from 'vitest';
import {
  findPairedFeature,
  uiTwinVars,
} from '../../src/agents/architect/graph/code/tasks/ui/twin';

const state = (completed: any[]): any => ({ completedTasksDetails: completed });
const uiTask = (group?: string, id = 'app-home-ui'): any => ({ id, type: 'ui', parallelGroup: group });

const featureTwin = {
  id: 'app-home',
  name: '앱 — 홈 (헤드리스)',
  type: 'feature',
  parallelGroup: 'app-home',
  description: 'role-based home, full scope (PRD §4.2, §21.6.4)',
  touchedFiles: ['codebase/apps/end-user/src/presentation/home/home-screen.tsx'],
};

describe('ui twin derivation', () => {
  it('finds the completed feature sharing the ui task parallelGroup, with FULL desc + files', () => {
    const r = findPairedFeature(state([featureTwin]), uiTask('app-home'));
    expect(r).not.toBeNull();
    expect(r!.name).toBe('앱 — 홈 (헤드리스)');
    // full (untruncated) — carries the PRD § content authority
    expect(r!.description).toBe('role-based home, full scope (PRD §4.2, §21.6.4)');
    expect(r!.files).toEqual([
      'codebase/apps/end-user/src/presentation/home/home-screen.tsx',
    ]);
  });

  it('returns null when the ui task has no parallelGroup (graceful)', () => {
    expect(findPairedFeature(state([featureTwin]), uiTask(undefined))).toBeNull();
  });

  it('returns null when no completed feature matches the group (twin not done yet)', () => {
    expect(findPairedFeature(state([featureTwin]), uiTask('app-feed'))).toBeNull();
  });

  it('ignores non-feature tasks sharing the group (only the feature twin qualifies)', () => {
    const dsSameGroup = {
      id: 'ds-x',
      name: 'ds',
      type: 'design-system',
      parallelGroup: 'app-home',
      description: 'd',
      touchedFiles: ['codebase/x'],
    };
    expect(findPairedFeature(state([dsSameGroup]), uiTask('app-home'))).toBeNull();
  });

  it('never matches itself by id', () => {
    const selfAsFeature = { ...featureTwin, id: 'app-home-ui' };
    expect(
      findPairedFeature(state([selfAsFeature]), uiTask('app-home', 'app-home-ui')),
    ).toBeNull();
  });

  it('uiTwinVars spreads { pairedFeature } when found, {} when absent', () => {
    expect(uiTwinVars(state([featureTwin]), uiTask('app-home'))).toHaveProperty('pairedFeature');
    expect(uiTwinVars(state([featureTwin]), uiTask('app-feed'))).toEqual({});
  });
});
