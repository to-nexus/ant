/**
 * Universal tool policy — reconciles the core-side allowlist SSOT
 * (`UNIVERSAL_BUILTIN_TOOLS`) with the tool layer (JOB_TOOL_MATRIX /
 * TOOL_HANDLERS / toolSchemas), and pins the approval-default table.
 *
 * The schema check matters most: `getToolsByNames` silently drops names
 * without an ARCHITECT_TOOLS entry, so a missing schema means a tool that
 * is registered and dispatchable but invisible to the LLM.
 */

import { describe, it, expect } from 'vitest';
import {
  UNIVERSAL_BUILTIN_TOOLS,
  MUTATING_BUILTIN_TOOLS,
  ARTIFACT_WRITE_TOOLS,
  planTurnViolation,
  requiresApproval,
  isMcpToolName,
} from '../../src/core/customAgents/universalToolPolicy';
import {
  JOB_TOOL_MATRIX,
  JobType,
  TOOL_HANDLERS,
  TOOL_SETS,
  TOOL_DISPLAY_NAMES,
  ToolName,
} from '../../src/agents/common/tool/toolCatalog';
import { getToolsByNames } from '../../src/agents/common/tool/toolSchemas';
import { createUniversalToolRegistry } from '../../src/agents/common/tool/presets';

describe('UNIVERSAL_BUILTIN_TOOLS ↔ tool layer reconciliation', () => {
  it('equals JOB_TOOL_MATRIX[UNIVERSAL] as a set', () => {
    const policy = [...UNIVERSAL_BUILTIN_TOOLS].sort();
    const matrix = [...JOB_TOOL_MATRIX[JobType.UNIVERSAL]].map(String).sort();
    expect(policy).toEqual(matrix);
  });

  it('every tool has a schema entry (getToolsByNames drops missing ones silently)', () => {
    const names = JOB_TOOL_MATRIX[JobType.UNIVERSAL] as ToolName[];
    const defs = getToolsByNames([...names]);
    const defNames = new Set(defs.map((d) => d.name));
    for (const name of names) {
      expect(defNames.has(name), `tool "${name}" has no toolSchemas entry — the LLM never sees it`).toBe(true);
    }
  });

  it('every tool has a catalog handler (registry covers the full preset)', () => {
    const registry = createUniversalToolRegistry();
    for (const name of UNIVERSAL_BUILTIN_TOOLS) {
      expect(registry.has(name), `tool "${name}" has no TOOL_HANDLERS entry`).toBe(true);
    }
  });

  it('every tool has a display name', () => {
    for (const name of JOB_TOOL_MATRIX[JobType.UNIVERSAL]) {
      expect(TOOL_DISPLAY_NAMES[name], `tool "${name}" has no display name`).toBeTruthy();
    }
  });

  it('domain-bound tools stay excluded (search_code, workspace/reference/ant-source, assets, figma)', () => {
    const forbidden = [
      'search_code', 'read_workspace_file', 'list_workspace_files', 'read_reference_file',
      'list_reference_files', 'search_reference_code', 'register_reference', 'read_ant_source',
      'list_ant_files', 'search_ant_code', 'read_source_doc', 'list_assets', 'download_asset',
      'figma_get_design_context', 'figma_get_screenshot', 'figma_get_metadata', 'figma_get_variable_defs',
    ];
    for (const name of forbidden) {
      expect((UNIVERSAL_BUILTIN_TOOLS as readonly string[]).includes(name), `"${name}" must NOT be in the universal preset`).toBe(false);
    }
  });

  it('subagentUniversal is read-only and never contains explore (depth-1)', () => {
    const readOnly = new Set([ToolName.READ_FILE, ToolName.LIST_FILES, ToolName.SEARCH_FILES]);
    for (const t of TOOL_SETS.subagentUniversal) {
      expect(readOnly.has(t), `subagentUniversal contains non-read-only tool "${t}"`).toBe(true);
    }
    expect(TOOL_SETS.subagentUniversal).not.toContain(ToolName.EXPLORE);
  });

  it('ARTIFACT_WRITE_TOOLS and MUTATING_BUILTIN_TOOLS are subsets of the preset', () => {
    for (const t of [...ARTIFACT_WRITE_TOOLS, ...MUTATING_BUILTIN_TOOLS]) {
      expect(UNIVERSAL_BUILTIN_TOOLS).toContain(t);
    }
  });
});

describe('planTurnViolation — @plan write confinement table', () => {
  it.each([
    // [label, tool, args, violates]
    ['create_file outside plan/', 'create_file', { path: 'reports/w.md' }, true],
    ['edit_file outside plan/', 'edit_file', { path: 'notes.md' }, true],
    ['append_file outside plan/', 'append_file', { path: 'log.txt' }, true],
    ['delete_file outside plan/', 'delete_file', { path: 'old.md' }, true],
    ['mkdir outside plan/', 'mkdir', { path: 'reports' }, true],
    ['copy_file dest outside plan/', 'copy_file', { src: 'plan/a.md', dest: 'reports/a.md' }, true],
    ['create_file under plan/', 'create_file', { path: 'plan/ops/weekly/plan.md' }, false],
    ['copy_file dest under plan/', 'copy_file', { src: 'notes.md', dest: 'plan/copy.md' }, false],
    ['./ prefix normalizes', 'create_file', { path: './plan/x.md' }, false],
    ['backslash separators normalize', 'create_file', { path: 'plan\\x.md' }, false],
    ['plan-prefixed sibling dir is NOT plan/', 'create_file', { path: 'planning/x.md' }, true],
    ['read tools never violate', 'read_file', { path: 'reports/w.md' }, false],
    ['search tools never violate', 'search_files', { query: 'x' }, false],
  ] as const)('%s', (_label, tool, args, violates) => {
    const result = planTurnViolation(tool, args as Record<string, unknown>);
    if (violates) {
      expect(result).toMatch(/PLAN turn/);
    } else {
      expect(result).toBeNull();
    }
  });
});

describe('requiresApproval — default table', () => {
  it.each([
    // [label, tool, declared, opts, expected]
    ['run_command defaults to always', 'run_command', {}, undefined, true],
    ['http_request defaults to always', 'http_request', {}, undefined, true],
    ['read_file defaults to no gate', 'read_file', {}, undefined, false],
    ['create_file (sandbox write) defaults to no gate', 'create_file', {}, undefined, false],
    ['explicit never relaxes a mutating builtin', 'run_command', { run_command: 'never' as const }, undefined, false],
    ['explicit always gates a read tool', 'read_file', { read_file: 'always' as const }, undefined, true],
    ['mcp tool defaults to always', 'mcp__db__push', {}, undefined, true],
    ['mcp read-only hint lifts the default', 'mcp__db__list', {}, { mcpReadOnlyHint: true }, false],
    ['explicit always wins over read-only hint', 'mcp__db__list', { mcp__db__list: 'always' as const }, { mcpReadOnlyHint: true }, true],
    ['explicit never wins for mcp', 'mcp__db__push', { mcp__db__push: 'never' as const }, undefined, false],
  ])('%s', (_label, tool, declared, opts, expected) => {
    expect(requiresApproval(tool, declared as Record<string, 'always' | 'never'>, opts)).toBe(expected);
  });

  it('isMcpToolName recognizes the prefix', () => {
    expect(isMcpToolName('mcp__db__push')).toBe(true);
    expect(isMcpToolName('read_file')).toBe(false);
  });
});
