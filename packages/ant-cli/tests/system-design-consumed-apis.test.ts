/**
 * Regression pin — `consumedApis` (consumer-perspective) field semantics
 * in `validateAndFixTargetFiles` + `action-config-matrix` outputs.
 *
 * Background:
 *   `services` (provider) and `consumedApis` (consumer) are orthogonal
 *   fields in the system-design decompose response.
 *   - `services` produces `be-system-{s}.md` + `api-contract-{s}.md`
 *     pairs and is meaningful for `gen-sys-be` / `gen-sys-full` only.
 *   - `consumedApis` produces `api-contract-{c}.md` ONLY and is meaningful
 *     in any system-design intent — including `gen-sys-fe` where the
 *     project consumes external APIs.
 *
 * Invariants verified:
 *   1. FE intent + consumedApis seeds an api-contract placeholder into
 *      the FE-only matrix default (`['fe-system-main.md']`) and expands
 *      per consumer. `be-system-*` never produced.
 *   2. FE intent ignores `services` (provider semantic does not apply).
 *   3. Mixed `services` + `consumedApis` (BE/Full) expands both axes.
 *   4. Provider/consumer name conflict drops consumer entries with
 *      precedence to provider authorship.
 *   5. `consumerApis`-derived task `targetFile` survives Step 2 filter.
 *   6. `FULLSTACK_OUTPUTS` from `action-config-matrix` does NOT
 *      duplicate `api-contract-*.md` even though both `BE_OUTPUTS` and
 *      the new `FE_OUTPUTS` contain it.
 *   7. FE intent emitting an erroneous `be-system-*` task is dropped
 *      (Step 1d strip + Step 2 task filter).
 *   8. `gen-sys-be` standard path (services only) is unchanged from the
 *      pre-`consumedApis` behavior.
 */

import { describe, it, expect } from 'vitest';
import {
  validateAndFixTargetFiles,
  type SystemDesignResponse,
} from '../src/agents/architect/graph/design/nodes/decompose/systemDesignDecompose.js';
import { getConfigSlots } from '@ant/shared';

function makeTask(targetFile: string, idx: number): SystemDesignResponse['tasks'][number] {
  return {
    id: `design-${targetFile.replace(/\.md$/, '')}`,
    name: `Design Document: ${targetFile}`,
    targetFile,
    description: `Generate ${targetFile} based on requirements.`,
    priority: 200 + idx * 20,
  };
}

function baseResponse(overrides: Partial<SystemDesignResponse> = {}): SystemDesignResponse {
  return {
    documentType: 'unified',
    targetFiles: [],
    tasks: [],
    ...overrides,
  };
}

describe('validateAndFixTargetFiles — consumedApis (consumer perspective)', () => {
  it('1) FE intent + 1 consumedApi seeds api-contract slot and expands', () => {
    const response = baseResponse({
      consumedApis: ['payments'],
      tasks: [
        makeTask('fe-system-main.md', 0),
        makeTask('api-contract-payments.md', 1),
      ],
    });

    const result = validateAndFixTargetFiles(
      response,
      ['fe-system-main.md'],
      undefined,
      'generate',
      'gen-sys-fe',
    );

    expect(result.targetFiles).toEqual([
      'fe-system-main.md',
      'api-contract-payments.md',
    ]);
    expect(result.tasks.map(t => t.targetFile).sort()).toEqual([
      'api-contract-payments.md',
      'fe-system-main.md',
    ]);
    expect(result.targetFiles.some(f => f.startsWith('be-system-'))).toBe(false);
    expect(result.documentType).toBe('contract-first');
  });

  it('2) FE intent + N consumedApis produces one api-contract per host', () => {
    const response = baseResponse({
      consumedApis: ['payments', 'orders', 'inventory'],
      tasks: [
        makeTask('fe-system-main.md', 0),
        makeTask('api-contract-payments.md', 1),
        makeTask('api-contract-orders.md', 2),
        makeTask('api-contract-inventory.md', 3),
      ],
    });

    const result = validateAndFixTargetFiles(
      response,
      ['fe-system-main.md'],
      undefined,
      'generate',
      'gen-sys-fe',
    );

    expect(result.targetFiles).toEqual([
      'fe-system-main.md',
      'api-contract-payments.md',
      'api-contract-orders.md',
      'api-contract-inventory.md',
    ]);
    expect(result.tasks).toHaveLength(4);
  });

  it('3) FE intent + empty consumedApis returns matrix default unchanged', () => {
    const response = baseResponse({
      tasks: [makeTask('fe-system-main.md', 0)],
    });

    const result = validateAndFixTargetFiles(
      response,
      ['fe-system-main.md'],
      undefined,
      'generate',
      'gen-sys-fe',
    );

    expect(result.targetFiles).toEqual(['fe-system-main.md']);
    expect(result.documentType).toBe('unified');
  });

  it('4) FE intent ignores `services` (provider semantic does not apply)', () => {
    const response = baseResponse({
      services: ['payments'],
      tasks: [makeTask('fe-system-main.md', 0)],
    });

    const result = validateAndFixTargetFiles(
      response,
      ['fe-system-main.md'],
      undefined,
      'generate',
      'gen-sys-fe',
    );

    // services is silently ignored — no api-contract / be-system files
    expect(result.targetFiles).toEqual(['fe-system-main.md']);
    expect(result.targetFiles.some(f => f.startsWith('be-system-'))).toBe(false);
    expect(result.targetFiles.some(f => f.startsWith('api-contract-'))).toBe(false);
  });

  it('5) FE intent strips erroneous be-system task emissions', () => {
    const response = baseResponse({
      consumedApis: ['payments'],
      tasks: [
        makeTask('fe-system-main.md', 0),
        makeTask('api-contract-payments.md', 1),
        // LLM mistake — should be dropped under FE intent
        makeTask('be-system-foo.md', 2),
      ],
    });

    const result = validateAndFixTargetFiles(
      response,
      ['fe-system-main.md'],
      undefined,
      'generate',
      'gen-sys-fe',
    );

    expect(result.targetFiles.some(f => f.startsWith('be-system-'))).toBe(false);
    expect(result.tasks.some(t => t.targetFile.startsWith('be-system-'))).toBe(false);
  });

  it('6) BE intent + services only — pre-consumedApis behavior preserved', () => {
    const response = baseResponse({
      services: ['auth', 'order'],
      tasks: [
        makeTask('be-system-auth.md', 0),
        makeTask('be-system-order.md', 1),
        makeTask('api-contract-auth.md', 2),
        makeTask('api-contract-order.md', 3),
      ],
    });

    const result = validateAndFixTargetFiles(
      response,
      ['be-system-*.md', 'api-contract-*.md'],
      undefined,
      'generate',
      'gen-sys-be',
    );

    expect(result.targetFiles).toEqual([
      'be-system-auth.md',
      'be-system-order.md',
      'api-contract-auth.md',
      'api-contract-order.md',
    ]);
    expect(result.documentType).toBe('msa-contract-first');
  });

  it('7) BE intent + services + consumedApis produces all three families', () => {
    const response = baseResponse({
      services: ['auth'],
      consumedApis: ['stripe'],
      tasks: [
        makeTask('be-system-auth.md', 0),
        makeTask('api-contract-auth.md', 1),
        makeTask('api-contract-stripe.md', 2),
      ],
    });

    const result = validateAndFixTargetFiles(
      response,
      ['be-system-*.md', 'api-contract-*.md'],
      undefined,
      'generate',
      'gen-sys-be',
    );

    expect(new Set(result.targetFiles)).toEqual(new Set([
      'be-system-auth.md',
      'api-contract-auth.md',
      'api-contract-stripe.md',
    ]));
    // be-system-stripe.md NEVER created (consumer is api-contract only)
    expect(result.targetFiles.some(f => f === 'be-system-stripe.md')).toBe(false);
  });

  it('8) Fullstack + services + consumedApis produces fe + be + provider api + consumer api', () => {
    const response = baseResponse({
      services: ['auth'],
      consumedApis: ['stripe'],
      tasks: [
        makeTask('fe-system-main.md', 0),
        makeTask('be-system-auth.md', 1),
        makeTask('api-contract-auth.md', 2),
        makeTask('api-contract-stripe.md', 3),
      ],
    });

    const result = validateAndFixTargetFiles(
      response,
      ['fe-system-main.md', 'be-system-*.md', 'api-contract-*.md'],
      undefined,
      'generate',
      'gen-sys-full',
    );

    expect(new Set(result.targetFiles)).toEqual(new Set([
      'fe-system-main.md',
      'be-system-auth.md',
      'api-contract-auth.md',
      'api-contract-stripe.md',
    ]));
    // No duplicate api-contract-main.md from FULLSTACK_OUTPUTS composition.
    expect(result.targetFiles.filter(f => f.startsWith('api-contract-'))).toHaveLength(2);
  });

  it('9) services ∩ consumedApis conflict — provider wins, consumer dropped + warning', () => {
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (msg: string) => warns.push(msg);

    try {
      const response = baseResponse({
        services: ['payments'],
        consumedApis: ['payments', 'stripe'],
        tasks: [
          makeTask('be-system-payments.md', 0),
          makeTask('api-contract-payments.md', 1),
          makeTask('api-contract-stripe.md', 2),
        ],
      });

      const result = validateAndFixTargetFiles(
        response,
        ['be-system-*.md', 'api-contract-*.md'],
        undefined,
        'generate',
        'gen-sys-be',
      );

      // payments comes from services (provider authorship); stripe only from consumer
      expect(new Set(result.targetFiles)).toEqual(new Set([
        'be-system-payments.md',
        'api-contract-payments.md',
        'api-contract-stripe.md',
      ]));
      expect(response.consumedApis).toEqual(['stripe']);
      expect(warns.some(w => w.includes('services ∩ consumedApis'))).toBe(true);
    } finally {
      console.warn = orig;
    }
  });
});

describe('Matrix outputs — api-contract surface (provider/consumer separation)', () => {
  function getOutputPrefixes(intent: string): string[] {
    const slots = getConfigSlots(intent as any);
    const target = slots.target;
    if (target.kind !== 'generate') throw new Error(`Expected generate target for ${intent}, got ${target.kind}`);
    return target.outputs.map(o => o.prefix);
  }

  it('gen-sys-fe matrix-default target is fe-system only — api-contract is validator-seeded for consumer cases', () => {
    // Consumer api-contract MUST NOT appear in the matrix default,
    // otherwise getDefaultTargetPaths would inject an empty
    // api-contract-main.md fallback for every FE explicit submit
    // without a consumedApis hint.
    const prefixes = getOutputPrefixes('gen-sys-fe');
    expect(prefixes).toEqual(['fe-system-']);
  });

  it('gen-sys-be matrix-default target includes be-system + api-contract (provider)', () => {
    const prefixes = getOutputPrefixes('gen-sys-be').sort();
    expect(prefixes).toEqual(['api-contract-', 'be-system-']);
  });

  it('gen-sys-full matrix-default target is exactly fe + be + api-contract — NO duplicate api-contract', () => {
    const prefixes = getOutputPrefixes('gen-sys-full');
    expect(prefixes.filter(p => p === 'api-contract-')).toHaveLength(1);
    expect(new Set(prefixes)).toEqual(new Set([
      'fe-system-',
      'be-system-',
      'api-contract-',
    ]));
  });
});
