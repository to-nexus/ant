/**
 * Temperature SSOT policy locks.
 *
 * `core/ports/llmSampling.ts` LLM_TEMPERATURE is the single source of truth
 * for per-call sampling temperature. Three invariants:
 *
 *  1. NO DEAD KEYS — every table key has ≥1 call-site consumer. (The
 *     original table declared CODE_EXECUTE=0.2 that no site consumed for
 *     months; execute silently ran at the env default 0.7.)
 *  2. NO RAW LITERALS — call sites reference table keys, never numeric
 *     temperature literals (adapters and the table itself excepted).
 *  3. KEY SITES WIRED — the highest-volume loops (code execute, plan
 *     tool-loop callers, planner nodes) pass a table constant.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LLM_TEMPERATURE } from '../../src/core/ports/llmSampling';

const SRC = resolve(__dirname, '../../src');

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (p.endsWith('.ts')) acc.push(p);
  }
  return acc;
}

const allFiles = walk(SRC);
const allSources = new Map(allFiles.map(f => [f, readFileSync(f, 'utf8')]));

describe('LLM_TEMPERATURE — no dead keys', () => {
  for (const key of Object.keys(LLM_TEMPERATURE)) {
    it(`${key} has at least one consumer`, () => {
      const re = new RegExp(`LLM_TEMPERATURE\\.${key}\\b`);
      const consumers = allFiles.filter(f =>
        !f.includes('core/ports/llmSampling.ts') && re.test(allSources.get(f)!),
      );
      expect(consumers.length).toBeGreaterThanOrEqual(1);
    });
  }
});

describe('call sites — no raw temperature literals', () => {
  // Image-GENERATION calls (core/ports/imageGeneration → GeminiImageClient)
  // are a different sampling axis — creative variance for sketch/render
  // candidates is intentional and NOT governed by the text-gen table.
  const IMAGE_GEN_EXEMPT = [
    'agents/creator/graph/visual/nodes/sketch.ts',
    'agents/creator/graph/visual/nodes/render.ts',
  ];

  it('src/agents/** and src/core/context/** contain zero numeric temperature literals', () => {
    const offenders: string[] = [];
    for (const f of allFiles) {
      const isCallSiteScope = f.includes('/src/agents/') || f.includes('/src/core/context/');
      if (!isCallSiteScope) continue;
      if (IMAGE_GEN_EXEMPT.some(x => f.endsWith(x))) continue;
      const src = allSources.get(f)!;
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments may cite values
        if (/temperature:\s*0?\.\d/.test(line) || /temperature:\s*[01](\.\d+)?\s*[,}]/.test(line)) {
          offenders.push(`${f.slice(SRC.length + 1)}:${i + 1} :: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('key sites — table constants wired', () => {
  const KEY_SITES: Array<[string, RegExp]> = [
    ['agents/architect/graph/code/nodes/execute/index.ts', /temperature: LLM_TEMPERATURE\.CODE_EXECUTE/],
    ['agents/architect/graph/code/nodes/plan/llm/tools.ts', /temperature: LLM_TEMPERATURE\.PLAN_GENERATION/],
    ['agents/architect/graph/design/nodes/plan/index.ts', /temperature: LLM_TEMPERATURE\.PLAN_GENERATION/],
    ['agents/architect/graph/design/nodes/execute/index.ts', /temperature: LLM_TEMPERATURE\.DOC_GENERATION/],
    ['agents/planner/graph/plan/nodes/plan/index.ts', /temperature: LLM_TEMPERATURE\.PLAN_GENERATION/],
    ['agents/planner/graph/plan/nodes/execute/index.ts', /temperature: LLM_TEMPERATURE\.DOC_GENERATION/],
    ['agents/common/graph/nodes/triage/index.ts', /temperature: LLM_TEMPERATURE\.DETECT/],
    ['core/context/compactJob.ts', /temperature: LLM_TEMPERATURE\.SUMMARIZE/],
  ];

  for (const [rel, re] of KEY_SITES) {
    it(rel, () => {
      expect(allSources.get(join(SRC, rel))!).toMatch(re);
    });
  }
});
