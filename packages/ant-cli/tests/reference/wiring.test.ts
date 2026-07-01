/**
 * Reference-codebase tool wiring — the 4 tools are registered for code + design,
 * have handlers + schemas, and are read-only (no write side-effects wired).
 */
import { describe, it, expect } from 'vitest';
import {
  ToolName,
  JOB_TOOL_MATRIX,
  JobType,
  TOOL_HANDLERS,
  TOOL_SETS,
} from '../../src/agents/common/tool/toolCatalog';
import { ARCHITECT_TOOLS } from '../../src/agents/common/tool/toolSchemas';

const REF_TOOLS = [
  ToolName.REGISTER_REFERENCE,
  ToolName.READ_REFERENCE_FILE,
  ToolName.LIST_REFERENCE_FILES,
  ToolName.SEARCH_REFERENCE,
];

describe('reference tool wiring', () => {
  it('registers all 4 tools for CODE and DESIGN jobs', () => {
    for (const t of REF_TOOLS) {
      expect(JOB_TOOL_MATRIX[JobType.CODE]).toContain(t);
      expect(JOB_TOOL_MATRIX[JobType.DESIGN]).toContain(t);
    }
  });

  it('has a handler for each reference tool', () => {
    for (const t of REF_TOOLS) {
      expect(TOOL_HANDLERS.get(t)).toBeTypeOf('function');
    }
  });

  it('has an LLM-facing schema for each reference tool', () => {
    for (const t of REF_TOOLS) {
      expect(ARCHITECT_TOOLS[t as keyof typeof ARCHITECT_TOOLS]).toBeDefined();
    }
  });

  it('groups the 4 tools in TOOL_SETS.reference', () => {
    expect(TOOL_SETS.reference).toEqual(expect.arrayContaining(REF_TOOLS));
  });

  it('search_reference_code schema carries no vector-DB wording', () => {
    const schema = ARCHITECT_TOOLS['search_reference_code'];
    expect(schema.description.toLowerCase()).not.toContain('vector');
    expect(schema.description.toLowerCase()).not.toContain('semantic');
  });
});
