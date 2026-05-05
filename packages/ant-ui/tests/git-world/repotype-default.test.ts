/**
 * `repoType` default SSOT — FE side guard (Phase 3.4).
 *
 * The legacy auto-mapping pattern (`mode='local' → repoType:'local'+localPath`)
 * caused worktree path-collision because base and every feature shared the
 * same codebase without explicit user opt-in. Both the BE
 * (`ProjectCrudService.createProject`) and the FE (`createProjectConfig`)
 * MUST default to `repoType:'cloud'`. Users who want the external `localPath`
 * mode set it explicitly via the wizard's advanced step.
 *
 * The BE-side guard lives in
 * `packages/ant-cli/tests/policy/git-bootstrap-ssot-regression.test.ts`.
 *
 * This file is the FE-side mirror — it stays in `ant-ui/tests/` so the
 * assertion never crosses a package boundary (which would break BE-only
 * Docker builds that don't ship FE source).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const FE_CONFIG_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'src',
  'infrastructure',
  'http',
  'api',
  'config.ts',
);

describe("FE repoType default SSOT (mode auto-mapping ban)", () => {
  it("config.ts 의 mode 자동 매핑 (mode='local' → repoType:'local') 이 제거되어 있다", () => {
    const content = readFileSync(FE_CONFIG_PATH, 'utf-8');
    expect(content).not.toMatch(
      /repoType:\s*mode\s*===\s*['"]cloud['"]\s*\?\s*['"]cloud['"]\s*:\s*['"]local['"]/,
    );
    expect(content).not.toMatch(/mode\s*!==\s*['"]cloud['"]\s*\?\s*\{\s*localPath:/);
  });

  it("createProjectConfig 의 default 가 repoType:'cloud' 다", () => {
    const content = readFileSync(FE_CONFIG_PATH, 'utf-8');
    expect(content).toMatch(/repoType:\s*['"]cloud['"]/);
  });
});
