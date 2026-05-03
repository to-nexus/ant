/**
 * Regression: design-spec docGen → codebase mutate (total-drying-apron, 2026-05-03).
 *
 * Reproduces the post-mortem scenario captured in
 * `log-total-drying-apron.json` where a sealed plan (`Candidate A:
 * application 레이어 통합 우선`) led the docGen LLM to attempt:
 *   1. delete_file codebase/apps/hub/.../identity-session-utils.ts
 *   2. edit_file  codebase/apps/hub/.../webshop-client-wrapper.tsx
 *
 * After the codebase mutation gate, both calls MUST be rejected at the
 * handler level, the codebase fixture MUST stay byte-identical, and
 * the rejection message MUST guide the LLM toward writing a spec
 * artifact instead.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { handleEditFile } from '../../src/agents/common/tool/handlers/editFile';
import { handleDeleteFile } from '../../src/agents/common/tool/handlers/deleteFile';
import { FileSystemAdapter } from '../../src/periphery/adapters/filesystem/FileSystemAdapter';
import type { ToolExecutionContext } from '../../src/agents/common/tool/types';

const HUB_BASE = 'codebase/apps/hub/app/[projectSlug]/_components';
const IDENTITY_UTILS = `${HUB_BASE}/identity-session-utils.ts`;
const WEBSHOP_WRAPPER = `${HUB_BASE}/webshop-client-wrapper.tsx`;

const IDENTITY_UTILS_BODY = `
export function loadIdentitySessionClient() { /* ... */ }
export function saveIdentitySessionClient() { /* ... */ }
export function clearIdentitySessionClient() { /* ... */ }
`;

const WEBSHOP_WRAPPER_BODY = `import {
  clearIdentitySessionClient,
  loadIdentitySessionClient,
  saveIdentitySessionClient,
} from './identity-session-utils';
`;

function silentChatStatus(): ToolExecutionContext['chatStatus'] {
  const noop = async () => undefined as any;
  return new Proxy({}, { get: () => noop }) as ToolExecutionContext['chatStatus'];
}

function makeDesignDocGenCtx(workspacePath: string): ToolExecutionContext {
  // Mirrors `architect/graph/design/nodes/tool/index.ts` buildContext —
  // design job's tool node closes the gate so any `codebase/` mutate
  // gets rejected.
  return {
    fileSystem: new FileSystemAdapter(workspacePath),
    chatStatus: silentChatStatus(),
    workingDir: workspacePath,
    allowMutateInCodebase: false,
  };
}

let workspacePath: string;

beforeEach(() => {
  workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-tda-regression-'));
  fs.mkdirSync(path.join(workspacePath, HUB_BASE), { recursive: true });
  fs.writeFileSync(path.join(workspacePath, IDENTITY_UTILS), IDENTITY_UTILS_BODY);
  fs.writeFileSync(path.join(workspacePath, WEBSHOP_WRAPPER), WEBSHOP_WRAPPER_BODY);
});

afterEach(() => {
  if (workspacePath) fs.rmSync(workspacePath, { recursive: true, force: true });
});

describe('regression — total-drying-apron docGen → codebase mutate', () => {
  it('delete_file codebase/.../identity-session-utils.ts is rejected; file remains', async () => {
    const ctx = makeDesignDocGenCtx(workspacePath);
    const result = await handleDeleteFile(ctx, { path: IDENTITY_UTILS });

    expect(result.error).toBeDefined();
    expect(result.content).toMatch(/codebase\//);
    expect(result.content).toMatch(/read-only/);
    // Critical: the file must still be on disk byte-identical.
    expect(fs.existsSync(path.join(workspacePath, IDENTITY_UTILS))).toBe(true);
    expect(fs.readFileSync(path.join(workspacePath, IDENTITY_UTILS), 'utf-8'))
      .toBe(IDENTITY_UTILS_BODY);
  });

  it('edit_file codebase/.../webshop-client-wrapper.tsx is rejected; file remains', async () => {
    const ctx = makeDesignDocGenCtx(workspacePath);
    const result = await handleEditFile(ctx, {
      path: WEBSHOP_WRAPPER,
      old_str:
        "import {\n  clearIdentitySessionClient,\n  loadIdentitySessionClient,\n  saveIdentitySessionClient,\n} from './identity-session-utils';",
      new_str: "import { useIdentitySession } from '@/application/identity';",
    });

    expect(result.error).toBeDefined();
    expect(result.content).toMatch(/codebase\//);
    expect(fs.readFileSync(path.join(workspacePath, WEBSHOP_WRAPPER), 'utf-8'))
      .toBe(WEBSHOP_WRAPPER_BODY);
  });

  it('rejection message guides the LLM toward an artifact-path mutation (recovery hint)', async () => {
    const ctx = makeDesignDocGenCtx(workspacePath);
    const result = await handleEditFile(ctx, {
      path: WEBSHOP_WRAPPER,
      old_str: "from './identity-session-utils';",
      new_str: "from '@/application/identity';",
    });

    // Soft-reject: message must describe the next move, not threaten.
    expect(result.content).toMatch(/architecture\//);
    expect(result.content).toMatch(/spec|plan/);
    expect(result.content).toMatch(/code job's execute phase/);
    // FPOP: not a "You MUST" tirade, no tool-name lists.
    expect(result.content).not.toMatch(/You MUST|MUST NOT/);
  });

  it('artifact-path edits succeed even with the gate closed (refactor parity)', async () => {
    const ctx = makeDesignDocGenCtx(workspacePath);
    fs.mkdirSync(path.join(workspacePath, 'architecture/spec'), { recursive: true });
    fs.writeFileSync(
      path.join(workspacePath, 'architecture/spec/spec.md'),
      '# Spec\nold body\n',
    );

    const result = await handleEditFile(ctx, {
      path: 'architecture/spec/spec.md',
      old_str: 'old body',
      new_str: 'new body',
    });

    expect(result.error).toBeUndefined();
    expect(fs.readFileSync(path.join(workspacePath, 'architecture/spec/spec.md'), 'utf-8'))
      .toContain('new body');
  });
});
