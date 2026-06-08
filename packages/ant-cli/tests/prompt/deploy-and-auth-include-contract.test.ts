/**
 * Prompt-token locks for two RCA fixes (coral-logging-scout code-job).
 *
 *  - Defect 2 — monorepo deployment story: the root setup must author a single
 *    root-level build / dev / production-serve orchestration and prefer source
 *    consumption for shared packages; the doc (README) task must document the
 *    unified root build→dev→production→deploy workflow.
 *  - Defect 3 — a task authoring an auth / API surface must `include` the
 *    api-contract even on a single-stack job (decompose include authoring).
 *
 * These are PROMPT-TEXT contracts (LLM-authored behavior, deliberately NOT
 * runtime-enforced — see the `task.include` SSOT), so the guard locks the
 * presence of the steering language, not a runtime output.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TEMPLATES = path.resolve(__dirname, '../../src/core/prompt/templates');
const TS_SETUP_CONFIG = path.join(
  TEMPLATES,
  'jobs/code/nodes/execute/basis/techTier/typescript/setup/config.md',
);
const DOCGEN_BASE = path.join(TEMPLATES, 'jobs/code/nodes/execute/variants/docgen/base.md');
const DECOMPOSE_RULES = path.join(TEMPLATES, 'jobs/code/nodes/decompose/variants/default/rules.md');

const read = (p: string): string => fs.readFileSync(p, 'utf-8');

describe('Defect 2 — monorepo root orchestration (typescript setup config)', () => {
  it('requires a root-level build / dev / production-serve orchestration', () => {
    const src = read(TS_SETUP_CONFIG);
    expect(src).toMatch(/Root orchestration/i);
    expect(src).toMatch(/dependsOn.*\^build|topolog/i); // dependency-ordered whole-repo build
    expect(src).toMatch(/production run|production-serve|serve/i); // dev↔production distinction
  });

  it('prefers shared-package source consumption over a manual pre-build step', () => {
    const src = read(TS_SETUP_CONFIG);
    expect(src).toMatch(/source consumption|the library's SOURCE|transpilePackages/i);
  });
});

describe('Defect 2 — README documents the unified root workflow (docgen)', () => {
  it('requires a production run/serve command in the README contents', () => {
    const src = read(DOCGEN_BASE);
    expect(src).toMatch(/Production run \/ serve|production run\/serve/i);
  });

  it('requires the root README to document whole-project (single root) commands', () => {
    const src = read(DOCGEN_BASE);
    expect(src).toMatch(/root-level commands that operate the ENTIRE project|whole-project lifecycle/i);
  });

  it('requires deployment notes when the project is deployable', () => {
    const src = read(DOCGEN_BASE);
    expect(src).toMatch(/Deployment notes|deployment/i);
  });
});

describe('Defect 3 — auth/API surface task includes api-contract (decompose include authoring)', () => {
  it('requires the api-contract include for auth/API-surface tasks even single-stack', () => {
    const src = read(DECOMPOSE_RULES);
    expect(src).toMatch(/auth or API surface/i);
    expect(src).toMatch(/single-stack/i);
    expect(src).toMatch(/api-contract/i);
  });
});
