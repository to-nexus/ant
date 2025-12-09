import { ArchitectGraphState } from "../../state";

/**
 * Select design documents based on detected environment
 * 
 * ✅ SIMPLIFIED: detectEnvironment already filtered designDocs and updated design
 * Just use state.design directly (already filtered by environment)
 */
export function selectDesignDocuments(state: ArchitectGraphState): string {
  return state.design || '';
}

/**
 * Prepare design document for LLM prompt
 */
export function prepareDesignDocument(state: ArchitectGraphState): {
  designDoc: string;
  hasDesignDoc: boolean;
} {
  const designDoc = selectDesignDocuments(state);
  const hasDesignDoc = Boolean(designDoc && designDoc.trim().length > 0);
  
  if (hasDesignDoc) {
    const tokenEstimate = Math.ceil(designDoc.length / 4);
    console.log(`   📊 Design document: ${tokenEstimate.toLocaleString()} tokens`);
  }
  
  return { designDoc, hasDesignDoc };
}
