import { describe, expect, it } from 'vitest';
import {
  extractDesignDecisions,
  extractDesignLessons,
} from '../../src/agents/architect/graph/design/nodes/learn/lessonExtractor';

function makeState(files: Array<{ path: string; content: string }>) {
  return {
    context: {
      project: 'probe',
      featureFolder: 'gamehub-fe',
    },
    files,
    artifacts: [],
  } as any;
}

describe('lessonExtractor primary design detection', () => {
  it('uses architecture/spec markdown when fe/be-system docs are absent', () => {
    const state = makeState([
      {
        path: 'architecture/spec/spec-hub-blank-screen-debug-spec.md',
        content: '# Blank Screen Spec\n\nTechnology: React\nArchitecture: Layered',
      },
    ]);

    const decisions = extractDesignDecisions(state);
    expect(decisions).toContain('Technology');
    expect(decisions).not.toBe('- No design document available for analysis');

    const lessons = extractDesignLessons(state);
    expect(lessons).toContain('architecture/spec/spec-hub-blank-screen-debug-spec.md');
  });

  it('still prefers canonical fe-system/be-system docs over other markdown', () => {
    const state = makeState([
      {
        path: 'architecture/spec/spec-hub-blank-screen-debug-spec.md',
        content: '# Spec Doc',
      },
      {
        path: 'architecture/system/fe-system-main.md',
        content: '# FE System\n\nTechnology: Next.js',
      },
    ]);

    const lessons = extractDesignLessons(state);
    expect(lessons).toContain('architecture/system/fe-system-main.md');
  });

  it('falls back to visual/ui/ant json artifacts when markdown docs are missing', () => {
    const state = makeState([
      {
        path: 'visual/ui/ant/ui-spec.json',
        content: '{"screen":"hub","components":["header","list"]}',
      },
    ]);

    const decisions = extractDesignDecisions(state);
    expect(decisions).toContain('Design approach documented in');
    expect(decisions).not.toBe('- No design document available for analysis');
  });
});
