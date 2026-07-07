/**
 * Regression pin — `assignedSections` × `targetFile`-catalog matching in
 * `validateAssignedSectionsAgainstCatalogs`.
 *
 * Background:
 *   Decompose emits one task per chapter with `targetFile` (e.g.
 *   `api-contract-main.md`) plus `assignedSections` drawn from a section
 *   catalog. The catalog is selected by the `targetFile` prefix:
 *
 *     - `api-contract-*` → `api-contract-catalog-names.md`
 *     - `fe-system-*`    → `frontend-catalog-names.md`
 *     - `be-system-*`    → `backend-catalog-names.md`
 *
 *   A historical decompose-LLM bug attached frontend-catalog sections
 *   (e.g. `§ Architecture Boundaries`, `§ State Management & Data Flow`)
 *   to an `api-contract-main.md` task. Execute then received a prompt
 *   where `ASSIGNED`, `FORBIDDEN`, and `filteredCatalog` all disagreed,
 *   producing a hallucinated output filename and silently dropping the
 *   real api-contract document. This validator exists to throw before
 *   that situation reaches execute, with a precise, repair-call-friendly
 *   error message.
 *
 * Invariants verified:
 *   1. api-contract task with FE catalog sections → violation
 *   2. fe-system task with api-contract catalog sections → violation
 *   3. be-system task with api-contract catalog sections → violation
 *   4. api-contract task with the canonical api-contract sections → no violation
 *   5. fe-system task with the canonical FE sections → no violation
 *   6. Tasks without `assignedSections` are skipped (legacy responses)
 *   7. Tasks with unknown `targetFile` prefix are skipped (no catalog to compare)
 *   8. The error message includes both task id and the offending section names
 *      so the repair-call feedback can name them precisely.
 */

import { describe, it, expect } from 'vitest';
import {
  validateAssignedSectionsAgainstCatalogs,
  formatAssignedSectionsViolations,
  type SystemDesignResponse,
} from '../../src/agents/architect/graph/design/nodes/decompose/systemDesignDecompose.js';

function makeTask(
  targetFile: string,
  assignedSections: string[] | undefined,
  idx = 0,
): SystemDesignResponse['tasks'][number] {
  return {
    id: `task-${targetFile.replace(/\.md$/, '')}-${idx}`,
    name: `Task ${idx} for ${targetFile}`,
    targetFile,
    description: `Generate sections for ${targetFile}.`,
    priority: 200 + idx * 20,
    ...(assignedSections ? { assignedSections } : {}),
  };
}

function makeResponse(tasks: SystemDesignResponse['tasks']): SystemDesignResponse {
  return {
    documentType: 'unified',
    targetFiles: [...new Set(tasks.map(t => t.targetFile))],
    tasks,
  };
}

describe('validateAssignedSectionsAgainstCatalogs', () => {
  it('1) api-contract task with FE catalog sections is a violation', async () => {
    // The exact regression seen in the gamehub-fe / tall-piling-basin job:
    // FE-catalog sections wired to an api-contract target file.
    const response = makeResponse([
      makeTask('api-contract-main.md', [
        '§ Overview',
        '§ Architecture Boundaries',
        '§ API Integration & Error Strategy',
        '§ State Management & Data Flow',
        '§ Domain Rules',
        '§ External Integrations',
        '§ Directory Structure & Boundary Mapping',
      ]),
    ]);

    const violations = await validateAssignedSectionsAgainstCatalogs(response);
    expect(violations).toHaveLength(1);
    expect(violations[0].targetFile).toBe('api-contract-main.md');

    // § Overview is shared across catalogs — only the others are mismatched.
    const mismatched = new Set(violations[0].mismatched);
    expect(mismatched.has('§ Architecture Boundaries')).toBe(true);
    expect(mismatched.has('§ State Management & Data Flow')).toBe(true);
    expect(mismatched.has('§ Directory Structure & Boundary Mapping')).toBe(true);
    expect(mismatched.has('§ Overview')).toBe(false);
  });

  it('2) fe-system task with api-contract catalog sections is a violation', async () => {
    const response = makeResponse([
      makeTask('fe-system-main.md', [
        '§ Overview',
        '§ API Endpoints',
        '§ Shared Type Definitions',
        '§ Error Handling Conventions',
      ]),
    ]);

    const violations = await validateAssignedSectionsAgainstCatalogs(response);
    expect(violations).toHaveLength(1);
    expect(violations[0].targetFile).toBe('fe-system-main.md');
    const mismatched = new Set(violations[0].mismatched);
    expect(mismatched.has('§ API Endpoints')).toBe(true);
    expect(mismatched.has('§ Shared Type Definitions')).toBe(true);
    expect(mismatched.has('§ Error Handling Conventions')).toBe(true);
    expect(mismatched.has('§ Overview')).toBe(false);
  });

  it('3) be-system task with api-contract catalog sections is a violation', async () => {
    const response = makeResponse([
      makeTask('be-system-main.md', [
        '§ Overview',
        '§ API Endpoints',
        '§ Shared Type Definitions',
      ]),
    ]);

    const violations = await validateAssignedSectionsAgainstCatalogs(response);
    expect(violations).toHaveLength(1);
    expect(violations[0].targetFile).toBe('be-system-main.md');
    expect(violations[0].mismatched).toContain('§ API Endpoints');
    expect(violations[0].mismatched).toContain('§ Shared Type Definitions');
  });

  it('4) api-contract task with the canonical api-contract sections is valid', async () => {
    const response = makeResponse([
      makeTask('api-contract-main.md', [
        '§ Overview',
        '§ Authentication & Authorization',
        '§ API Endpoints',
        '§ Real-time Communication',
        '§ Shared Type Definitions',
        '§ Error Handling Conventions',
      ]),
    ]);

    const violations = await validateAssignedSectionsAgainstCatalogs(response);
    expect(violations).toEqual([]);
  });

  it('5) fe-system task with the canonical FE sections is valid', async () => {
    const response = makeResponse([
      makeTask('fe-system-main.md', [
        '§ Overview',
        '§ Architecture Boundaries',
        '§ API Integration & Error Strategy',
        '§ State Management & Data Flow',
        '§ Domain Rules',
        '§ External Integrations',
        '§ Directory Structure & Boundary Mapping',
      ]),
    ]);

    const violations = await validateAssignedSectionsAgainstCatalogs(response);
    expect(violations).toEqual([]);
  });

  it('6) tasks without assignedSections are skipped (legacy responses)', async () => {
    const response = makeResponse([
      makeTask('api-contract-main.md', undefined),
      makeTask('fe-system-main.md', undefined),
    ]);

    const violations = await validateAssignedSectionsAgainstCatalogs(response);
    expect(violations).toEqual([]);
  });

  it('7) tasks whose targetFile prefix has no catalog are skipped', async () => {
    // `spec-feature.md` (spec-driven docs) doesn't have a section catalog
    // wired into CATALOG_MAP — validation must not produce false positives
    // for those targets.
    const response = makeResponse([
      makeTask('spec-feature.md', ['§ Some Random Section']),
      makeTask('readme.md', ['§ Another Section']),
    ]);

    const violations = await validateAssignedSectionsAgainstCatalogs(response);
    expect(violations).toEqual([]);
  });

  it('8) error message includes task id and offending section names', async () => {
    const response = makeResponse([
      makeTask('api-contract-main.md', ['§ Architecture Boundaries']),
      makeTask('fe-system-hub.md', ['§ API Endpoints']),
    ]);

    const violations = await validateAssignedSectionsAgainstCatalogs(response);
    expect(violations).toHaveLength(2);

    const message = formatAssignedSectionsViolations(violations);
    // Each task id appears so the LLM repair call can address them by name.
    expect(message).toContain('task-api-contract-main-0');
    expect(message).toContain('task-fe-system-hub-0');
    // Offending section names are quoted verbatim.
    expect(message).toContain('§ Architecture Boundaries');
    expect(message).toContain('§ API Endpoints');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Game-Activation T2-a — domain × stack catalog dispatch. A game fe-system doc
// validates against the game FE catalog (scene / entity / loop), NOT the
// service frontend catalog; be-system / api-contract fall back to the service
// catalogs (T3-a2 graceful fallback) for game until a game-server catalog lands.
// ════════════════════════════════════════════════════════════════════════════

describe('validateAssignedSectionsAgainstCatalogs — game FE catalog dispatch (T2-a)', () => {
  it('game fe-system task with a game FE catalog section is NOT a violation', async () => {
    const response = makeResponse([
      makeTask('fe-system-main.md', ['§ Scene Graph & Boundaries', '§ Game Loop & Timestep']),
    ]);
    const violations = await validateAssignedSectionsAgainstCatalogs(response, 'game');
    expect(violations).toEqual([]);
  });

  it('game fe-system task with a service-only FE section IS a violation', async () => {
    // `§ API Integration & Error Strategy` exists only in the service frontend
    // catalog — under the game catalog it is out-of-scope.
    const response = makeResponse([
      makeTask('fe-system-main.md', ['§ API Integration & Error Strategy']),
    ]);
    const violations = await validateAssignedSectionsAgainstCatalogs(response, 'game');
    expect(violations).toHaveLength(1);
    expect(violations[0].mismatched).toContain('§ API Integration & Error Strategy');
  });

  it('service fe-system task keeps the service FE catalog (no game leakage)', async () => {
    const response = makeResponse([
      makeTask('fe-system-main.md', ['§ API Integration & Error Strategy']),
    ]);
    // Default (service) domain — the section is canonical, no violation.
    const violations = await validateAssignedSectionsAgainstCatalogs(response, 'service');
    expect(violations).toEqual([]);
    // A game FE section is NOT in the service catalog → violation.
    const gameSection = await validateAssignedSectionsAgainstCatalogs(
      makeResponse([makeTask('fe-system-main.md', ['§ Scene Graph & Boundaries'])]),
      'service',
    );
    expect(gameSection).toHaveLength(1);
  });

  it('game be-system task falls back to the service backend catalog (T3-a2)', async () => {
    // No dedicated game-server catalog yet → the service backend catalog is
    // the graceful fallback, so its canonical sections do not violate.
    const response = makeResponse([
      makeTask('be-system-main.md', ['§ Business Logic Placement']),
    ]);
    const violations = await validateAssignedSectionsAgainstCatalogs(response, 'game');
    expect(violations).toEqual([]);
  });
});
