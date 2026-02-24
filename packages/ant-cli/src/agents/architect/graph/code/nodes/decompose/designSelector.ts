import { ArchitectGraphState } from "../../state";

/**
 * Combine all design documents into a single string for the decompose prompt.
 * 
 * Design documents are passed through unfiltered from resolve.
 * Decompose receives ALL documents and determines profile (tier, language, framework).
 */
export function selectDesignDocuments(state: ArchitectGraphState): string {
  const designDocs = state.designDocs;
  
  // If no structured designDocs, fall back to state.design (legacy single doc)
  if (!designDocs) {
    return state.design || '';
  }
  
  const parts: string[] = [];
  
  // API contract (always first if present)
  if (designDocs.apiContract) {
    parts.push('# API Contract\n\n' + designDocs.apiContract);
  }
  
  // Frontend: monolith (single)
  if (designDocs.feDesign) {
    parts.push('# Frontend System Design\n\n' + designDocs.feDesign);
  }
  
  // Frontend: monorepo (multi-package)
  if (designDocs.feDesigns) {
    for (const [pkg, content] of Object.entries(designDocs.feDesigns)) {
      parts.push(`# Frontend: ${pkg}\n\n${content}`);
    }
  }
  
  // Backend: monolith (single)
  if (designDocs.beDesign) {
    parts.push('# Backend System Design\n\n' + designDocs.beDesign);
  }
  
  // Backend: MSA (multi-service)
  if (designDocs.beDesigns) {
    for (const [svc, content] of Object.entries(designDocs.beDesigns)) {
      parts.push(`# Backend: ${svc} Service\n\n${content}`);
    }
  }
  
  // Unified design (only if no tier-specific docs exist)
  const hasTierDocs = designDocs.feDesign || designDocs.feDesigns || 
                      designDocs.beDesign || designDocs.beDesigns;
  if (!hasTierDocs && designDocs.unifiedDesign) {
    parts.push('# System Design\n\n' + designDocs.unifiedDesign);
  }
  
  if (parts.length === 0) {
    // Fall back to state.design if no structured docs found
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
