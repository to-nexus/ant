/**
 * design diagram-contract regression guard.
 *
 * Locks the diagram-injection sweep that fixed the "diagram never appears
 * in design artifacts" drift. The sweep had five axes (system role
 * SSOT / docGen syntax-fence vs diagram-block split / DO-NOT prose-vs-
 * diagram axis / plan-outline diagram responsibility / api-contract
 * over-generalization narrowing). This test asserts every axis is still
 * present in the rendered template tree, and that the legacy magic-
 * number cap (`Maximum 3 code blocks ... each ≤8 lines`) has not
 * regressed via DRY-duplication.
 *
 * Scope: text-only lint over `templates/**\/*.md`. No PromptBuilder
 * runtime — funnel-level wiring is covered by sibling prompt-build
 * integration tests.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const TEMPLATE_ROOT = path.join(
  REPO_ROOT,
  'packages/ant-cli/src/core/prompt/templates',
);

function read(rel: string): string {
  return fs.readFileSync(path.join(TEMPLATE_ROOT, rel), 'utf8');
}

describe('design diagram-contract — SSOT body', () => {
  const partial = read('jobs/shared/injections/diagram-contract.md');

  it('uses Observable phrasing (multi-axis) rather than subjective "improves clarity"', () => {
    expect(partial).toMatch(/multi-axis/);
    expect(partial).toMatch(/prose bullets lose information/);
    expect(partial).not.toMatch(/Use diagrams when they improve structural clarity/);
  });

  it('keeps the three allowed diagram intents', () => {
    expect(partial).toMatch(/Flow-oriented process steps \(flowchart\)/);
    expect(partial).toMatch(/Component\/service relationships \(architecture map\)/);
    expect(partial).toMatch(/Time-ordered interactions \(sequence\)/);
  });

  it('warns that prose-only default itself needs justification', () => {
    expect(partial).toMatch(/omission of a diagram as a decision/);
  });
});

describe('design diagram-contract — design/base/system.md', () => {
  const file = read('jobs/design/base/system.md');

  it('renamed Minimal Code → Minimal Syntax (separates syntax fences from diagrams)', () => {
    expect(file).toMatch(/\*\*Minimal Syntax\*\*/);
    expect(file).not.toMatch(/\*\*Minimal Code\*\*/);
  });

  it('cross-references diagram-contract instead of restating diagram policy in body', () => {
    expect(file).toMatch(/Architecture diagrams when relationships are multi-axis \(governed by diagram-contract below/);
  });

  it('still includes the diagram-contract partial', () => {
    expect(file).toMatch(/\{\{>\s*jobs\/shared\/injections\/diagram-contract\s*\}\}/);
  });
});

describe('design diagram-contract — execute/variants/system-design/base.md', () => {
  const file = read('jobs/design/nodes/execute/variants/system-design/base.md');

  it('splits SYNTAX FENCES vs DIAGRAM BLOCKS in the body rule', () => {
    expect(file).toMatch(/SYNTAX FENCES \(interface \/ DTO \/ type \/ config\):/);
    expect(file).toMatch(/DIAGRAM BLOCKS \(mermaid \/ ASCII\):/);
    expect(file).toMatch(/Diagram blocks are NOT counted as syntax fences/);
  });

  it('replaces the magic-number cap (Maximum 3 / ≤8 lines) with a Principle', () => {
    expect(file).not.toMatch(/Maximum 3 code blocks in ENTIRE document/);
    expect(file).not.toMatch(/Code blocks: Max 3 total/);
    expect(file).not.toMatch(/Code blocks ≤3 total, each ≤8 lines/);
    expect(file).toMatch(/bounded by how many cross-boundary contracts the document actually carries/);
  });

  it('keeps the 5+ syntax fence blind-spot reminder', () => {
    expect(file).toMatch(/⚠️ Blind spot:.*5\+ syntax fences/);
  });

  it('FINAL CHECKLIST item 7 is rewritten + item 15 (DIAGRAM DECISION) added', () => {
    expect(file).toMatch(/7\. ✅ \*\*Syntax fences\*\* justified per SYNTAX FENCES rule/);
    expect(file).toMatch(/15\. ✅ \*\*DIAGRAM DECISION\*\*/);
    expect(file).toMatch(/Decorative diagrams added "to look complete" are FORBIDDEN/);
  });
});

describe('design diagram-contract — execute/variants/system-design/rules.md', () => {
  const file = read('jobs/design/nodes/execute/variants/system-design/rules.md');

  it('component-hierarchies DO-NOT entry is scoped to PROSE', () => {
    expect(file).toMatch(/Component hierarchies and relationships in PROSE/);
    expect(file).toMatch(/depicted via mermaid or ASCII diagram blocks are governed by diagram-contract/);
  });

  it('step-by-step DO-NOT entry is scoped to PROSE', () => {
    expect(file).toMatch(/Step-by-step procedural flows in PROSE/);
    expect(file).toMatch(/sequence diagram block are governed by diagram-contract/);
  });

  it('Pre-Output Checklist carries a Diagram Decision section', () => {
    expect(file).toMatch(/\*\*Diagram Decision \(per diagram-contract\):\*\*/);
    expect(file).toMatch(/multi-axis \(≥2 of: boundaries, directions, time-ordering\)/);
  });
});

describe('design diagram-contract — plan/variants/system-design/rules.md', () => {
  const file = read('jobs/design/nodes/plan/variants/system-design/rules.md');

  it('plan owns the diagram-need decision in documentOutline', () => {
    expect(file).toMatch(/\*\*Diagram observation in outline\*\*/);
    expect(file).toMatch(/should note whether the section benefits from a diagram/i);
    expect(file).toMatch(/decision lives in plan, not docGen/);
  });
});

describe('design diagram-contract — execute/variants/spec/rules.md', () => {
  const file = read('jobs/design/nodes/execute/variants/spec/rules.md');

  it('spec rules expose a diagram decision item aligned with diagram-contract', () => {
    expect(file).toMatch(/\*\*Diagram decision \(per diagram-contract\)\*\*/);
    expect(file).toMatch(/Decorative diagrams are FORBIDDEN/);
  });
});

describe('design diagram-contract — api-contract-guide.md', () => {
  const file = read('jobs/design/base/injections/api-contract-guide.md');

  it('Forbidden Topic narrows to INTERNAL flow diagrams (not all architecture diagrams)', () => {
    expect(file).toMatch(/Backend INTERNAL flow diagrams/);
    expect(file).not.toMatch(/Backend internal architecture diagrams or data flows/);
  });

  it('endpoint-surface diagrams are explicitly allowed under diagram-contract', () => {
    expect(file).toMatch(
      /Endpoint-surface diagrams that depict the API boundary itself.*ARE allowed in this document under diagram-contract/s,
    );
  });
});

describe('design diagram-contract — DRY guard for the legacy code-block cap', () => {
  it('no template under jobs/design still mentions the magic-number cap', () => {
    const designRoot = path.join(TEMPLATE_ROOT, 'jobs/design');
    const offenders: Array<{ file: string; line: number; text: string }> = [];

    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const lines = fs.readFileSync(full, 'utf8').split('\n');
          lines.forEach((text, idx) => {
            if (
              /Maximum 3 code blocks/.test(text) ||
              /Code blocks:\s*Max 3 total/.test(text) ||
              /Code blocks\s*≤3 total,\s*each\s*≤8 lines/.test(text)
            ) {
              offenders.push({
                file: path.relative(TEMPLATE_ROOT, full),
                line: idx + 1,
                text: text.trim(),
              });
            }
          });
        }
      }
    }
    walk(designRoot);

    if (offenders.length > 0) {
      const detail = offenders
        .map((o) => `  - ${o.file}:${o.line} → ${o.text}`)
        .join('\n');
      throw new Error(
        `Legacy magic-number code-block cap reintroduced in design templates:\n${detail}\n` +
          `Use the SYNTAX FENCES (Principle-form) rule in execute/variants/system-design/base.md instead.`,
      );
    }
    expect(offenders).toHaveLength(0);
  });
});
