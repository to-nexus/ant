/**
 * Unit tests for the tool-dispatch SSOT (`core/llm-response/toolDispatch.ts`).
 *
 * This module is consumed by live LLMEventHandler(s) and by the
 * trace-replay adapter; the tests lock the mapping contract down so
 * drift between call sites is caught immediately.
 */

import { describe, it, expect } from 'vitest';
import {
  TOOLS_WITH_DEDICATED_STATUS,
  dispatchToolCallToContent,
} from '../src/core/llm-response/toolDispatch';

describe('toolDispatch — TOOLS_WITH_DEDICATED_STATUS', () => {
  it('covers every tool whose handler owns a dedicated status pair', () => {
    expect(TOOLS_WITH_DEDICATED_STATUS.has('read_file')).toBe(true);
    expect(TOOLS_WITH_DEDICATED_STATUS.has('list_files')).toBe(true);
    expect(TOOLS_WITH_DEDICATED_STATUS.has('search_code')).toBe(true);
    expect(TOOLS_WITH_DEDICATED_STATUS.has('search_reference_code')).toBe(true);
    expect(TOOLS_WITH_DEDICATED_STATUS.has('run_command')).toBe(true);
  });
});

describe('toolDispatch — dispatchToolCallToContent', () => {
  it('skips file-mutating tool_calls when no error (file_write owns the card)', () => {
    for (const tool of ['edit_file', 'delete_file', 'file', 'write_file', 'create_file']) {
      expect(dispatchToolCallToContent(tool, { path: 'x.ts' })).toBeNull();
    }
  });

  it('renders failure FileCard for file-mutating tool_calls with an error', () => {
    const out = dispatchToolCallToContent('edit_file', { path: 'x.ts' }, 'boom');
    expect(out?.type).toBe('file_edit_failed');
    expect(out?.metadata?.filePath).toBe('x.ts');
    expect(out?.metadata?.reason).toBe('boom');

    const del = dispatchToolCallToContent('delete_file', { path: 'x.ts' }, 'nope');
    expect(del?.type).toBe('file_delete_failed');

    const crt = dispatchToolCallToContent('write_file', { path: 'x.ts' }, 'nope');
    expect(crt?.type).toBe('file_create_failed');
  });

  it('skips tool_call(run_command) without error (run_command line owns the card)', () => {
    expect(dispatchToolCallToContent('run_command', { command: 'ls' })).toBeNull();
  });

  it('emits a dedicated-status result card for read_file', () => {
    const out = dispatchToolCallToContent('read_file', { path: 'src/auth.ts' });
    expect(out?.type).toBe('read');
    expect(out?.metadata?.filePath).toBe('src/auth.ts');
  });

  it('emits a dedicated-status result card for list_files with pattern', () => {
    const out = dispatchToolCallToContent('list_files', {
      directory: 'src',
      pattern: '*.ts',
    });
    expect(out?.type).toBe('listed_files');
    expect(out?.metadata?.directory).toBe('src');
    expect(out?.metadata?.pattern).toBe('*.ts');
  });

  it('emits a dedicated-status result card for search_code', () => {
    const out = dispatchToolCallToContent('search_code', {
      pattern: 'TODO',
      file_pattern: '*.ts',
    });
    expect(out?.type).toBe('searched_code');
    expect(out?.metadata?.pattern).toBe('TODO');
    expect(out?.metadata?.file_pattern).toBe('*.ts');
  });

  it('emits a dedicated-status result card for search_reference_code', () => {
    const out = dispatchToolCallToContent('search_reference_code', {
      project: 'libx',
      query: 'parseJSON',
    });
    expect(out?.type).toBe('searched_reference');
    expect(out?.metadata?.project).toBe('libx');
    expect(out?.metadata?.query).toBe('parseJSON');
  });

  it('renders mkdir with a folder icon in tool_action', () => {
    const out = dispatchToolCallToContent('mkdir', { path: 'src/foo' });
    expect(out?.type).toBe('tool_action');
    expect(out?.metadata?.actionIcon).toBe('📁');
    expect(out?.metadata?.filePath).toBe('src/foo');
  });

  it('falls back to generic tool_action for unknown tools with compacted args', () => {
    const longArg = 'x'.repeat(500);
    const out = dispatchToolCallToContent('search_web', { query: longArg });
    expect(out?.type).toBe('tool_action');
    expect(out?.metadata?.toolName).toBe('search_web');
    // long string values are compacted to `(n chars)` so the card does
    // not balloon on reload.
    expect(typeof out?.content).toBe('string');
    expect(out?.content as string).toContain('(500 chars)');
  });
});
