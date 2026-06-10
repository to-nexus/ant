/**
 * Kind-dispatch policy guard.
 *
 * Per the Unified Distributed System Principle, the member / transfer
 * BUSINESS dispatch must branch on org `kind` (data), NOT on server mode.
 * `org.routes.ts` and `transfer.routes.ts` must therefore NOT import or call
 * `isLocalServerMode` — the kind axis (individual / team / local) drives the
 * divergence instead. (Infra-level mode gates live in `userContext.ts`.)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..', '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf-8');
}

describe('kind-dispatch (not mode) policy', () => {
  it('org.routes does not gate business logic on isLocalServerMode', () => {
    const src = read('src/periphery/adapters/http/routes/org.routes.ts');
    expect(src).not.toMatch(/isLocalServerMode/);
    // It DOES dispatch on organizationKind.
    expect(src).toMatch(/organizationKind/);
  });

  it('transfer.routes does not gate business logic on isLocalServerMode', () => {
    const src = read('src/periphery/adapters/http/routes/transfer.routes.ts');
    expect(src).not.toMatch(/isLocalServerMode/);
    expect(src).toMatch(/organizationKind/);
  });

  it('the individual members browse is self-only (no shared-org enumeration leak)', () => {
    const src = read('src/periphery/adapters/http/routes/org.routes.ts');
    // The members route returns self-only for any non-team kind; enumeration
    // is reserved for the `team` branch.
    expect(src).toMatch(/kind !== 'team'/);
    expect(src).toMatch(/members\/lookup/);
  });
});
