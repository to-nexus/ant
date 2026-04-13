import { ArchitectGraphState } from "../../state";
import type { ToolDefinition } from "../../../../../../core/ports/llm";
import { DECOMPOSE_SOURCE_THRESHOLD } from '../../../design/nodes/docGen/sourceSelector';
import type { ResolvedArtifact } from "@ant/shared";
import { ARTIFACT_PREFIX } from "@ant/shared";
import { ArtifactPoolView, flattenDesignArtifacts } from '../../../../../../core/prompt/builder/ArtifactPipeline';

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
 * Total character size of all system-design artifacts in the pool.
 */
export function getDesignDocsSize(state: ArchitectGraphState): number {
  return new ArtifactPoolView(state.artifacts || []).systemDesignSize();
}

/**
 * Build a compact index of design documents (name + size + preview).
 */
export function buildDesignDocIndex(state: ArchitectGraphState, previewLines: number = 6): string {
  const flat = flattenDesignArtifacts(state.artifacts || []);
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
 * Handle read_design_doc tool call from artifact pool.
 */
export function handleReadDesignDoc(
  name: string,
  state: ArchitectGraphState,
): string {
  const flat = flattenDesignArtifacts(state.artifacts || []);
  const content = flat[name];
  if (!content) {
    const available = Object.keys(flat).join(', ');
    return `Error: Document "${name}" not found. Available: ${available}`;
  }
  return content;
}

/**
 * Combine all system-design artifacts into a single string for the decompose prompt.
 */
export function selectDesignDocuments(state: ArchitectGraphState): string {
  const poolView = new ArtifactPoolView(state.artifacts || []);
  const systemDocs = poolView.systemDesigns.filter(a => a.content);

  if (systemDocs.length === 0) return '';

  return systemDocs.map(a => {
    const name = a.path.slice(ARTIFACT_PREFIX.SYSTEM_DESIGN.length).replace(/\.md$/, '');
    let prefix = 'Design';
    if (name.startsWith('fe-system-')) prefix = `Frontend: ${name.replace('fe-system-', '')}`;
    else if (name.startsWith('be-system-')) prefix = `Backend: ${name.replace('be-system-', '')}`;
    else if (name.startsWith('api-contract-')) prefix = `API Contract: ${name.replace('api-contract-', '')}`;
    else prefix = name;
    return `# ${prefix}\n\n${a.content}`;
  }).join('\n\n────────────────────────────────────────\n\n');
}

/**
 * Prepare design document for LLM prompt.
 * 
 * Hybrid strategy:
 *   - Small (< DECOMPOSE_SOURCE_THRESHOLD): return full designDoc inline
 *   - Large: return index only + set useToolMode flag
 */
export function prepareDesignDocument(state: ArchitectGraphState): {
  designDoc: string;
  hasDesignDoc: boolean;
  documents: ResolvedArtifact[];
  hasDocuments: boolean;
  useToolMode: boolean;
} {
  const totalSize = getDesignDocsSize(state);
  const useToolMode = totalSize > DECOMPOSE_SOURCE_THRESHOLD;

  if (useToolMode) {
    console.log(`📊 [DesignSelector] Tool-use mode: ${totalSize.toLocaleString()} chars > ${DECOMPOSE_SOURCE_THRESHOLD.toLocaleString()} threshold`);
    const docIndex = buildDesignDocIndex(state);
    const designDoc = `DESIGN DOCUMENTS (index only — use read_design_doc tool for full content):\n\n${docIndex}\n\n⚠️ Read selectively: only documents relevant to task decomposition decisions.`;
    const documents: ResolvedArtifact[] = [{ path: 'design-index', content: designDoc, role: 'ref', label: 'Design Documents (Index)' }];
    return { designDoc, hasDesignDoc: true, documents, hasDocuments: true, useToolMode };
  }

  const documents = selectDesignDocumentsAsResolved(state);
  const designDoc = selectDesignDocuments(state);
  const hasDesignDoc = Boolean(designDoc && designDoc.trim().length > 0);
  
  if (hasDesignDoc) {
    console.log(`📊 [DesignSelector] Inline mode: ${totalSize.toLocaleString()} chars <= ${DECOMPOSE_SOURCE_THRESHOLD.toLocaleString()} threshold`);
  }
  
  return { designDoc, hasDesignDoc, documents, hasDocuments: documents.length > 0, useToolMode };
}

/**
 * Build design documents as individual ResolvedArtifact entries.
 */
function selectDesignDocumentsAsResolved(state: ArchitectGraphState): ResolvedArtifact[] {
  const poolView = new ArtifactPoolView(state.artifacts || []);
  const systemDocs = poolView.systemDesigns.filter(a => a.content);

  if (systemDocs.length === 0) return [];

  return systemDocs.map(a => {
    const name = a.path.slice(ARTIFACT_PREFIX.SYSTEM_DESIGN.length).replace(/\.md$/, '');
    let label = name;
    if (name.startsWith('fe-system-')) label = `Frontend System Design: ${name.replace('fe-system-', '')}`;
    else if (name.startsWith('be-system-')) label = `Backend System Design: ${name.replace('be-system-', '')}`;
    else if (name.startsWith('api-contract-')) label = `API Contract: ${name.replace('api-contract-', '')}`;
    return { path: a.path, content: a.content!, role: 'ref' as const, label };
  });
}
