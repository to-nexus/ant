/**
 * WorkspaceService identifier validation.
 *
 * Regression: cloud `userId` is the full lowercased email (org-model commit
 * 5212554d), so the workspace tenant is `org:email` (e.g. `individual:probe@to.nexus`).
 * The identifier validator's allowed-character set must accept `@` (and `+`
 * plus-addressing) — the email is the identity SSOT and flows unsanitized through
 * every other surface (Redis keys, deploy keys, preview urlKeys). Path-traversal
 * guards (`..` / `/` / `\`) remain the security boundary.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceService } from '../../src/infrastructure/workspace/WorkspaceService';

describe('WorkspaceService.validateIdentifier (via createWorkspace)', () => {
  let basePath: string;
  let service: WorkspaceService;

  beforeEach(() => {
    basePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-ws-id-'));
    service = new WorkspaceService(basePath);
  });

  afterEach(() => {
    fs.rmSync(basePath, { recursive: true, force: true });
  });

  it('accepts an email-based tenantId (the exact failing input)', async () => {
    const handle = await service.createWorkspace('individual:probe@to.nexus', 'proj1');

    // colon → slash: org/user/project
    expect(fs.existsSync(path.join(basePath, 'individual', 'probe@to.nexus', 'proj1'))).toBe(true);
    expect(handle.tenantId).toBe('individual:probe@to.nexus');
    expect(handle.storagePath).toBe(path.join(basePath, 'individual', 'probe@to.nexus', 'proj1'));
  });

  it('accepts a plus-addressed tenantId', async () => {
    await service.createWorkspace('individual:probe+tag@to.nexus', 'proj1');
    expect(fs.existsSync(path.join(basePath, 'individual', 'probe+tag@to.nexus', 'proj1'))).toBe(true);
  });

  it('still rejects path traversal and separators (security boundary intact)', async () => {
    await expect(service.createWorkspace('individual:../etc', 'proj1')).rejects.toThrow(/invalid characters/);
    await expect(service.createWorkspace('a/b', 'proj1')).rejects.toThrow(/invalid characters/);
    await expect(service.createWorkspace('a\\b', 'proj1')).rejects.toThrow(/invalid characters/);
  });

  it('rejects characters outside the allowed set', async () => {
    await expect(service.createWorkspace('individual:probe$<to>', 'proj1')).rejects.toThrow(
      /must contain only/,
    );
  });

  it('rejects empty identifiers', async () => {
    await expect(service.createWorkspace('', 'proj1')).rejects.toThrow(/cannot be empty/);
  });
});
