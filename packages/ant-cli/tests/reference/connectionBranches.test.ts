/**
 * buildConnectionBranchMap — extracts sibling project → feature from the
 * current codebase's `@connection ant-project:{p}:{f}[:svc]` annotations.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildConnectionBranchMap } from '../../src/agents/common/tool/reference/connectionBranches';

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'conn-branches-'));
  fs.writeFileSync(
    path.join(root, '.env.example'),
    [
      '# @connection business backend ant-project:be:base:api',
      'BACKEND_URL=',
      '# @connection business payments ant-project:pay:staging',
      'PAYMENTS_URL=',
      '# @connection infrastructure database self',
      'DATABASE_URL=',
      '# @connection business cache redis://localhost:6379',
      'CACHE_URL=',
    ].join('\n'),
  );
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('buildConnectionBranchMap', () => {
  it('maps ant-project links to their feature (service suffix ignored)', async () => {
    const map = await buildConnectionBranchMap(root);
    expect(map.get('be')).toBe('base');
    expect(map.get('pay')).toBe('staging');
  });

  it('skips self links and non-ant-project modifiers', async () => {
    const map = await buildConnectionBranchMap(root);
    expect(map.has('self')).toBe(false);
    // The url-modifier `cache` connection has no ant-project mapping.
    expect([...map.keys()].sort()).toEqual(['be', 'pay']);
  });

  it('returns an empty map when no annotations exist', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'conn-empty-'));
    expect((await buildConnectionBranchMap(empty)).size).toBe(0);
    fs.rmSync(empty, { recursive: true, force: true });
  });
});
