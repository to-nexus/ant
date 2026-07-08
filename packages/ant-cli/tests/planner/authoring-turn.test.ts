/**
 * Regression — plan-job-valiant-pebble: gen-plan on an EXISTING codebase spilled
 * the PRD as prose instead of a `<file>` tag, so nothing was saved.
 *
 * Root cause: the planner's `generate` node conflates research (a long ReAct
 * codebase-inspection loop, driven by the codebase-channel "MUST inspect"
 * mandate) with authoring. After the loop the model (an OpenAI-compatible weak
 * instruction-follower) continued in free-text mode. A greenfield job — no
 * inspection loop, clean context — emits `<file>` fine.
 *
 * Fix: when a generate-mode research loop concludes with no `<file>`, re-enter
 * `generate` ONCE for a tool-free authoring turn over a clean draft-only
 * context (reproducing the greenfield condition). `<file>` stays the sole write
 * channel. These pin the routing signal + the clean-context builder.
 */

import { describe, it, expect } from 'vitest';
import { routeAfterGenerate } from '../../src/agents/planner/graph/plan/nodes/generate';
import { buildAuthoringUserMessage } from '../../src/agents/planner/graph/plan/nodes/generate/authoringContext';
import type { PlanGraphState } from '../../src/agents/planner/graph/plan/state';

const base = (over: Partial<PlanGraphState>): PlanGraphState =>
  ({ pendingToolCalls: [], ...over } as any);

describe('routeAfterGenerate — authoring self-loop', () => {
  it('pending tool calls → tool (research loop unchanged)', () => {
    expect(routeAfterGenerate(base({ pendingToolCalls: [{ id: '1', name: 'read_workspace_file', args: {} }] }))).toBe('tool');
  });

  it('research concluded with no <file> (flag set) → generate (authoring turn)', () => {
    expect(routeAfterGenerate(base({ _planAuthoringPhase: true }))).toBe('generate');
  });

  it('normal terminal (flag cleared) → __end__', () => {
    expect(routeAfterGenerate(base({ _planAuthoringPhase: false }))).toBe('__end__');
  });

  it('flag absent → __end__ (no spurious loop for greenfield/Claude success)', () => {
    expect(routeAfterGenerate(base({}))).toBe('__end__');
  });
});

describe('buildAuthoringUserMessage — clean draft context', () => {
  const draft = '# jhcompany.co.kr 리디자인 기획서\n\n## 1. 현황 진단\n...';
  const nodeGenerate = [
    { role: 'user', content: 'directive' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'read_workspace_file', input: { path: 'codebase/src/app/page.tsx' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'import ...' }] },
    { role: 'assistant', content: draft }, // the model's prose draft (the failed research-concluding turn)
  ] as any;

  it('carries the model draft and forces the <file> channel at the target path', () => {
    const msg = buildAuthoringUserMessage(nodeGenerate, 'plan/prd.md', false);
    expect(msg).toContain(draft);
    expect(msg).toContain('<file path="plan/prd.md">');
    expect(msg.toLowerCase()).toContain('do not emit the document as prose');
  });

  it('does NOT carry the raw tool transcript (clean context — no habituation)', () => {
    const msg = buildAuthoringUserMessage(nodeGenerate, 'plan/prd.md', false);
    expect(msg).not.toContain('read_workspace_file');
    expect(msg).not.toContain('import ...');
  });

  it('Korean locale renders Korean instruction', () => {
    const msg = buildAuthoringUserMessage(nodeGenerate, 'plan/prd.md', true);
    expect(msg).toContain('<file path="plan/prd.md">');
    expect(msg).toContain('산문으로 출력하지 마세요');
  });

  it('thin/empty draft still yields a valid author instruction (no crash)', () => {
    const msg = buildAuthoringUserMessage([{ role: 'user', content: 'directive' }] as any, 'plan/prd.md', false);
    expect(msg).toContain('<file path="plan/prd.md">');
  });
});
