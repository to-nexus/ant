/**
 * Design File Selection for DetectEnvironment Node
 */

export function selectDesignFiles(
  environment: string,
  designDocs?: {
    apiContract?: string;
    feDesign?: string;
    beDesign?: string;
    unifiedDesign?: string;
  }
): string[] {
  const selectedFiles: string[] = [];
  
  if (!designDocs) {
    return selectedFiles;
  }
  
  // Always include API contract if available
  if (designDocs.apiContract) {
    selectedFiles.push('api-contract.md');
  }
  
  // Environment-specific design docs
  if (environment === 'frontend' && designDocs.feDesign) {
    selectedFiles.push('fe-system-design.md');
  } else if (environment === 'backend' && designDocs.beDesign) {
    selectedFiles.push('be-system-design.md');
  } else if (environment === 'fullstack') {
    if (designDocs.feDesign) selectedFiles.push('fe-system-design.md');
    if (designDocs.beDesign) selectedFiles.push('be-system-design.md');
  }
  
  // Fallback to unified design if no environment-specific doc
  if (selectedFiles.length === 0 && designDocs.unifiedDesign) {
    selectedFiles.push('system-design.md');
  } else if (selectedFiles.length === 1 && designDocs.unifiedDesign) {
    // If only api-contract, add unified design
    selectedFiles.push('system-design.md');
  }
  
  return selectedFiles;
}
