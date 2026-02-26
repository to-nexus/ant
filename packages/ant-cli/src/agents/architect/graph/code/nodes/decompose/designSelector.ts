import { ArchitectGraphState } from "../../state";

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
 * When spec documents exist, designDoc is suppressed so that
 * design-doc-guide.md (which triggers full-project task generation)
 * does not render. The spec content is injected separately via specDoc.
 */
export function prepareDesignDocument(state: ArchitectGraphState): {
  designDoc: string;
  hasDesignDoc: boolean;
} {
  const hasSpec = state.specDocs && Object.keys(state.specDocs).length > 0;
  if (hasSpec) {
    console.log(`   📋 [DesignSelector] Spec docs detected — suppressing designDoc (spec-driven mode)`);
    return { designDoc: '', hasDesignDoc: false };
  }

  const designDoc = selectDesignDocuments(state);
  const hasDesignDoc = Boolean(designDoc && designDoc.trim().length > 0);
  
  if (hasDesignDoc) {
    const tokenEstimate = Math.ceil(designDoc.length / 4);
    console.log(`   📊 Design document: ${tokenEstimate.toLocaleString()} tokens`);
  }
  
  return { designDoc, hasDesignDoc };
}
