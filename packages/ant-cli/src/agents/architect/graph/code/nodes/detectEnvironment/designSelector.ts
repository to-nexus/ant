/**
 * Design File Selection for DetectEnvironment Node
 * 
 * Supports both legacy single docs and multi-package (monorepo/MSA) patterns:
 * - fe-system-design.md (legacy single frontend)
 * - fe-system-design-{pkg}.md (multi-frontend)
 * - be-system-design.md (legacy single backend)
 * - be-system-design-{svc}.md (MSA)
 */

/**
 * Design Documents Type (extended for multi-package support)
 */
export interface DesignDocs {
  apiContract?: string;
  // Legacy single docs
  feDesign?: string;
  beDesign?: string;
  unifiedDesign?: string;
  // Multi-package docs (monorepo/MSA)
  feDesigns?: { [pkg: string]: string };
  beDesigns?: { [svc: string]: string };
}

/**
 * Select design files based on environment (for decompose phase - loads all relevant)
 * This is called ONCE in detectEnvironment to determine which docs to include in state
 */
export function selectDesignFiles(
  environment: string,
  designDocs?: DesignDocs
): string[] {
  const selectedFiles: string[] = [];
  
  if (!designDocs) {
    return selectedFiles;
  }
  
  // Always include API contract if available
  if (designDocs.apiContract) {
    selectedFiles.push('api-contract.md');
  }
  
  const shouldIncludeFe = environment === 'frontend' || environment === 'fullstack' || environment === 'unknown';
  const shouldIncludeBe = environment === 'backend' || environment === 'fullstack' || environment === 'unknown';
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Frontend docs (legacy + multi-package)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (shouldIncludeFe) {
    // Multi-package frontend (takes precedence)
    if (designDocs.feDesigns) {
      for (const pkg of Object.keys(designDocs.feDesigns)) {
        selectedFiles.push(`fe-system-design-${pkg}.md`);
      }
    }
    // Legacy single frontend (only if no multi-package)
    else if (designDocs.feDesign) {
      selectedFiles.push('fe-system-design.md');
    }
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Backend docs (legacy + MSA)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (shouldIncludeBe) {
    // MSA multi-service (takes precedence)
    if (designDocs.beDesigns) {
      for (const svc of Object.keys(designDocs.beDesigns)) {
        selectedFiles.push(`be-system-design-${svc}.md`);
      }
    }
    // Legacy single backend (only if no MSA)
    else if (designDocs.beDesign) {
      selectedFiles.push('be-system-design.md');
    }
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Fallback to unified design
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const hasAnyTierDoc = selectedFiles.some(f => 
    f.startsWith('fe-') || f.startsWith('be-')
  );
  
  if (!hasAnyTierDoc && designDocs.unifiedDesign) {
    selectedFiles.push('system-design.md');
  } else if (selectedFiles.length === 1 && selectedFiles[0] === 'api-contract.md' && designDocs.unifiedDesign) {
    // If only api-contract, add unified design
    selectedFiles.push('system-design.md');
  }
  
  return selectedFiles;
}

/**
 * Select design files based on task.packages (for split injection)
 * Called per-task to inject only the required design docs
 * 
 * @param packages - Task's packages array (e.g., ['fe', 'be-auth'])
 * @param designDocs - All loaded design docs
 * @returns Array of file names to inject
 */
export function selectDesignFilesByPackages(
  packages: string[] | undefined,
  designDocs?: DesignDocs
): string[] {
  if (!designDocs) return [];
  
  // If no packages specified, return empty (caller should use environment-based fallback)
  if (!packages || packages.length === 0) {
    return [];
  }
  
  const selectedFiles: string[] = [];
  
  // Always include API contract when packages are specified
  if (designDocs.apiContract) {
    selectedFiles.push('api-contract.md');
  }
  
  for (const pkg of packages) {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Frontend packages: fe, fe-{pkg}
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (pkg === 'fe') {
      // Legacy single frontend
      if (designDocs.feDesign) {
        selectedFiles.push('fe-system-design.md');
      }
    } else if (pkg.startsWith('fe-')) {
      // Multi-package frontend: fe-{pkg} → fe-system-design-{pkg}.md
      const pkgName = pkg.slice(3); // Remove 'fe-' prefix
      if (designDocs.feDesigns?.[pkgName]) {
        selectedFiles.push(`fe-system-design-${pkgName}.md`);
      }
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Backend packages: be, be-{svc}
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (pkg === 'be') {
      // Legacy single backend
      if (designDocs.beDesign) {
        selectedFiles.push('be-system-design.md');
      }
    } else if (pkg.startsWith('be-')) {
      // MSA backend: be-{svc} → be-system-design-{svc}.md
      const svcName = pkg.slice(3); // Remove 'be-' prefix
      if (designDocs.beDesigns?.[svcName]) {
        selectedFiles.push(`be-system-design-${svcName}.md`);
      }
    }
  }
  
  return [...new Set(selectedFiles)]; // Deduplicate
}

/**
 * Get design document content by package tag
 * Used in plan/codeGen for split injection
 * 
 * @param pkg - Package tag (e.g., 'fe', 'be-auth')
 * @param designDocs - All loaded design docs
 * @returns Document content or undefined
 */
export function getDesignDocByPackage(
  pkg: string,
  designDocs?: DesignDocs
): string | undefined {
  if (!designDocs) return undefined;
  
  if (pkg === 'fe') {
    return designDocs.feDesign;
  } else if (pkg.startsWith('fe-')) {
    const pkgName = pkg.slice(3);
    return designDocs.feDesigns?.[pkgName];
  } else if (pkg === 'be') {
    return designDocs.beDesign;
  } else if (pkg.startsWith('be-')) {
    const svcName = pkg.slice(3);
    return designDocs.beDesigns?.[svcName];
  }
  
  return undefined;
}

/**
 * Build combined design document for task based on packages
 * 
 * @param packages - Task's packages array
 * @param designDocs - All loaded design docs
 * @returns Combined design document string
 */
export function buildDesignDocForTask(
  packages: string[] | undefined,
  designDocs?: DesignDocs
): string {
  if (!designDocs) return '';
  
  const parts: string[] = [];
  
  // Always include API contract
  if (designDocs.apiContract) {
    parts.push('# API Contract\n\n' + designDocs.apiContract);
  }
  
  // If no packages specified, use legacy combined approach
  if (!packages || packages.length === 0) {
    if (designDocs.feDesign) {
      parts.push('# Frontend System Design\n\n' + designDocs.feDesign);
    }
    if (designDocs.beDesign) {
      parts.push('# Backend System Design\n\n' + designDocs.beDesign);
    }
    if (designDocs.unifiedDesign && parts.length <= 1) {
      parts.push('# System Design\n\n' + designDocs.unifiedDesign);
    }
    
    // Include all multi-package docs if no specific packages requested
    if (designDocs.feDesigns) {
      for (const [pkg, content] of Object.entries(designDocs.feDesigns)) {
        parts.push(`# Frontend: ${pkg}\n\n${content}`);
      }
    }
    if (designDocs.beDesigns) {
      for (const [svc, content] of Object.entries(designDocs.beDesigns)) {
        parts.push(`# Backend: ${svc} Service\n\n${content}`);
      }
    }
  } else {
    // Build based on specific packages
    for (const pkg of packages) {
      const content = getDesignDocByPackage(pkg, designDocs);
      if (content) {
        const header = pkg.startsWith('fe') 
          ? `# Frontend: ${pkg === 'fe' ? 'Main' : pkg.slice(3)}`
          : `# Backend: ${pkg === 'be' ? 'Main' : pkg.slice(3)} Service`;
        parts.push(`${header}\n\n${content}`);
      }
    }
  }
  
  return parts.join('\n\n────────────────────────────────────────\n\n');
}
