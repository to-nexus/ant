import { ArchitectGraphState } from "../../state";
import type { ToolDefinition } from "../../../../../../core/ports/llm";
import { DECOMPOSE_SOURCE_THRESHOLD } from '../../../design/nodes/docGen/sourceSelector';

export const READ_DESIGN_DOC_TOOL: ToolDefinition = {
  name: 'read_design_doc',
  description: 'Read the full content of a design document by name. Use this to examine specific design documents when only the file index is provided.',
  input_schema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Document name from the design doc index (e.g., "api-contract-main", "fe-system-main")',
      },
    },
    required: ['name'],
  },
};

/**
 * Build a flat map of all design documents { displayName -> content }.
 */
function flattenDesignDocs(state: ArchitectGraphState): Record<string, string> {
  const designDocs = state.designDocs;
  if (!designDocs) return {};

  const flat: Record<string, string> = {};
  for (const [name, content] of Object.entries(designDocs.apiContracts)) {
    flat[`api-contract-${name}`] = content;
  }
  for (const [name, content] of Object.entries(designDocs.feDesigns)) {
    flat[`fe-system-${name}`] = content;
  }
  for (const [name, content] of Object.entries(designDocs.beDesigns)) {
    flat[`be-system-${name}`] = content;
  }
  return flat;
}

/**
 * Total character size of all design documents.
 */
export function getDesignDocsSize(state: ArchitectGraphState): number {
  const flat = flattenDesignDocs(state);
  return Object.values(flat).reduce((sum, c) => sum + c.length, 0);
}

/**
 * Build a compact index of design documents (name + size + preview).
 */
export function buildDesignDocIndex(state: ArchitectGraphState, previewLines: number = 6): string {
  const flat = flattenDesignDocs(state);
  if (Object.keys(flat).length === 0) return '';

  const names = Object.keys(flat).sort();
  const totalChars = Object.values(flat).reduce((s, c) => s + c.length, 0);

  const lines = [
    `**${names.length} design documents** (${totalChars.toLocaleString()} chars total)`,
    '',
    '| # | Document | Size | Preview |',
    '|---|----------|------|---------|',
  ];

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const content = flat[name];
    const preview = content
      .split('\n')
      .filter(l => l.trim().length > 0)
      .slice(0, previewLines)
      .join(' ')
      .slice(0, 200)
      .replace(/\|/g, '\\|');
    lines.push(`| ${i + 1} | \`${name}\` | ${content.length.toLocaleString()} chars | ${preview}... |`);
  }

  return lines.join('\n');
}

/**
 * Handle read_design_doc tool call from in-memory design documents.
 */
export function handleReadDesignDoc(
  name: string,
  state: ArchitectGraphState,
): string {
  const flat = flattenDesignDocs(state);
  const content = flat[name];
  if (!content) {
    const available = Object.keys(flat).join(', ');
    return `Error: Document "${name}" not found. Available: ${available}`;
  }
  return content;
}

/**
 * Combine all design documents into a single string for the decompose prompt.
 * Uses unified map-only DesignDocs structure.
 */
export function selectDesignDocuments(state: ArchitectGraphState): string {
  const designDocs = state.designDocs;

  if (!designDocs) {
    return state.design || '';
  }

  const parts: string[] = [];

  for (const [name, content] of Object.entries(designDocs.apiContracts)) {
    parts.push(`# API Contract: ${name}\n\n${content}`);
  }

  for (const [name, content] of Object.entries(designDocs.feDesigns)) {
    parts.push(`# Frontend: ${name}\n\n${content}`);
  }

  for (const [name, content] of Object.entries(designDocs.beDesigns)) {
    parts.push(`# Backend: ${name}\n\n${content}`);
  }

  if (parts.length === 0) {
    return state.design || '';
  }

  return parts.join('\n\n────────────────────────────────────────\n\n');
}

/**
 * Prepare design document for LLM prompt.
 * 
 * Hybrid strategy:
 *   - Small (< DECOMPOSE_SOURCE_THRESHOLD): return full designDoc inline
 *   - Large: return index only + set useToolMode flag
 *
 * When spec documents exist, designDoc is suppressed so that
 * design-doc-guide.md (which triggers full-project task generation)
 * does not render. The spec content is injected separately via specDoc.
 */
export function prepareDesignDocument(state: ArchitectGraphState): {
  designDoc: string;
  hasDesignDoc: boolean;
  useToolMode: boolean;
} {
  const hasSpec = state.specDocs && Object.keys(state.specDocs).length > 0;
  if (hasSpec) {
    console.log(`   📋 [DesignSelector] Spec docs detected — suppressing designDoc (spec-driven mode)`);
    return { designDoc: '', hasDesignDoc: false, useToolMode: false };
  }

  const totalSize = getDesignDocsSize(state);
  const useToolMode = totalSize > DECOMPOSE_SOURCE_THRESHOLD;

  if (useToolMode) {
    console.log(`📊 [DesignSelector] Tool-use mode: ${totalSize.toLocaleString()} chars > ${DECOMPOSE_SOURCE_THRESHOLD.toLocaleString()} threshold`);
    const docIndex = buildDesignDocIndex(state);
    const designDoc = `DESIGN DOCUMENTS (index only — use read_design_doc tool for full content):\n\n${docIndex}\n\n⚠️ Read selectively: only documents relevant to task decomposition decisions.`;
    return { designDoc, hasDesignDoc: true, useToolMode };
  }

  const designDoc = selectDesignDocuments(state);
  const hasDesignDoc = Boolean(designDoc && designDoc.trim().length > 0);
  
  if (hasDesignDoc) {
    console.log(`📊 [DesignSelector] Inline mode: ${totalSize.toLocaleString()} chars <= ${DECOMPOSE_SOURCE_THRESHOLD.toLocaleString()} threshold`);
  }
  
  return { designDoc, hasDesignDoc, useToolMode };
}
