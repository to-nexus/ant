/**
 * ANTRULES Fix A + Fix D prompt regression guards.
 *
 * Fix A — setup variant base.md MUST instruct the LLM to create a
 * placeholder `codebase/ANTRULES.md` stub at setup time. The stub body is
 * the single placeholder line; enumeration / examples (framework /
 * test-runner / library / alias) are intentionally absent because the
 * recorded incident (drift via redundant restatement) is what motivated
 * the 3-condition filter in the first place.
 *
 * Fix A boost — `antrules.md` partial's `{{#if antrulesContent}}` branch
 * MUST teach the LLM that the placeholder line is a valid empty ledger,
 * not stale noise to ignore.
 *
 * Fix D — `<antrules-decision>` is a registered canonical tag with
 * `intent: 'control'` and `consumed-suppressed` processing (so raw XML
 * never leaks to chat surface).
 *
 * verification variant's rules.md teaches the mandatory emit shape.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { findTag } from '../../src/core/streaming/OutputTagRegistry';

const REPO_ROOT = path.resolve(__dirname, '../..');
const TEMPLATES = path.join(REPO_ROOT, 'src/core/prompt/templates');

function read(relPath: string): string {
  return fs.readFileSync(path.join(TEMPLATES, relPath), 'utf8');
}

describe('Fix A — setup variant base.md ANTRULES bootstrap stub', () => {
  const body = read('jobs/code/nodes/execute/variants/default/base.md');

  it('contains "Bootstrap action — new project" wording', () => {
    expect(body).toMatch(/Bootstrap action.*new project/);
  });

  it('mandates stub creation (MUST create) with a verbatim placeholder body', () => {
    expect(body).toMatch(/MUST create it now as part of setup/);
    expect(body).toContain(
      '(no project-local deviations recorded yet — sibling tasks will append as they emerge)',
    );
  });

  it('contains idempotency guard for existing ANTRULES.md', () => {
    expect(body).toMatch(/already exists.*do NOT overwrite/i);
  });

  it('FORBIDS enumeration / examples (no jsdom / shadcn / kebab-case / babel)', () => {
    const stubSection = body.slice(
      body.indexOf('Bootstrap action'),
      body.indexOf('Pre-`<done>` Discovery Check'),
    );
    // examples / jsdom / shadcn etc must be absent FROM the bootstrap stub
    // section specifically (other parts of base.md mention them legitimately).
    expect(stubSection).not.toMatch(/\bjsdom\b/i);
    expect(stubSection).not.toMatch(/\bshadcn\b/i);
    expect(stubSection).not.toMatch(/kebab-case/i);
    expect(stubSection).not.toMatch(/babel\.config/);
  });

  it('explicitly forbids seeding sections', () => {
    expect(body).toMatch(/Do NOT seed any section/);
    expect(body).toMatch(/no examples, no exceptions/i);
  });
});

describe('Fix A boost — antrules.md if-branch placeholder recognition', () => {
  const body = read('jobs/code/base/injections/antrules.md');

  it('teaches the LLM that placeholder-only content is a valid empty ledger', () => {
    expect(body).toMatch(/valid empty ledger/i);
    expect(body).toContain(
      '(no project-local deviations recorded yet — sibling tasks will append as they emerge)',
    );
    expect(body).toMatch(/NOT stale noise/i);
  });
});

describe('Fix D — <antrules-decision> canonical tag registration', () => {
  const entry = findTag('antrules-decision');

  it('is registered in OutputTagRegistry', () => {
    expect(entry).toBeDefined();
  });

  it('has axis intent="control" and consumed-suppressed processing (no chat leak)', () => {
    expect(entry!.axis.intent).toBe('control');
    expect(entry!.axis.processing).toContain('consumed-suppressed');
    expect(entry!.axis.processing).toContain('post-stream');
  });

  it('does not have a transform hook (consumed-suppressed silently drops)', () => {
    expect(entry!.transform).toBeUndefined();
  });

  it('has an extract hook for post-stream value extraction', () => {
    expect(typeof entry!.extract).toBe('function');
  });

  it('extract returns the body value for valid input', () => {
    const result = entry!.extract!(
      '<antrules-decision>update</antrules-decision>',
      { language: 'en' },
    );
    expect(result).toBe('update');
  });

  it('promptContract mentions the three valid values', () => {
    expect(entry!.promptContract).toMatch(/none/);
    expect(entry!.promptContract).toMatch(/write/);
    expect(entry!.promptContract).toMatch(/update/);
  });
});

describe('Fix D — verification rules.md mandatory emit teaching', () => {
  const body = read('jobs/code/nodes/execute/variants/verification/rules.md');

  it('contains the Mandatory decision emit section', () => {
    expect(body).toMatch(/Mandatory decision emit before `<done>true<\/done>`/);
  });

  it('teaches the three valid values', () => {
    expect(body).toContain('<antrules-decision>none</antrules-decision>');
    expect(body).toContain('<antrules-decision>write</antrules-decision>');
    expect(body).toContain('<antrules-decision>update</antrules-decision>');
  });

  it('mandates ≥10 char justification through <reply>', () => {
    expect(body).toMatch(/≥10\s*character/i);
  });

  it('warns that omission / short justification / out-of-range value fails the gate', () => {
    expect(body).toMatch(/fails the verification gate/i);
  });
});
