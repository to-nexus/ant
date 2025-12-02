import { ArchitectGraphState } from "../../state";

/**
 * Select design documents based on detected environment
 */
export function selectDesignDocuments(state: ArchitectGraphState): string {
  // ✅ NEW: Use selectedDesignFiles from detectEnvironment node
  if (state.selectedDesignFiles && state.selectedDesignFiles.length > 0 && state.designDocs) {
    const parts: string[] = [];
    
    console.log(`📄 [Decompose] Using environment-specific design files:`);
    console.log(`   Environment: ${state.detectedEnvironment || 'unknown'}`);
    console.log(`   Selected files: ${state.selectedDesignFiles.join(', ')}`);
    
    for (const fileName of state.selectedDesignFiles) {
      if (fileName === 'api-contract.md' && state.designDocs.apiContract) {
        parts.push('# API Contract\n\n' + state.designDocs.apiContract);
        console.log(`   ✅ Loaded api-contract.md`);
      } else if (fileName === 'fe-system-design.md' && state.designDocs.feDesign) {
        parts.push('# Frontend System Design\n\n' + state.designDocs.feDesign);
        console.log(`   ✅ Loaded fe-system-design.md`);
      } else if (fileName === 'be-system-design.md' && state.designDocs.beDesign) {
        parts.push('# Backend System Design\n\n' + state.designDocs.beDesign);
        console.log(`   ✅ Loaded be-system-design.md`);
      } else if (fileName === 'system-design.md' && state.designDocs.unifiedDesign) {
        parts.push('# System Design\n\n' + state.designDocs.unifiedDesign);
        console.log(`   ✅ Loaded system-design.md`);
      }
    }
    
    if (parts.length > 0) {
      return parts.join('\n\n────────────────────────────────────────\n\n');
    }
  }
  
  // Fallback: use original design field
  console.log(`📄 [Decompose] Using fallback design (no environment detection)`);
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

