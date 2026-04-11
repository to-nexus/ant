/**
 * Design File Selection
 * 
 * Unified naming: all design docs use `{type}-{name}.md` pattern.
 *   - api-contract-{name}.md
 *   - fe-system-{name}.md
 *   - be-system-{name}.md
 * Single-service uses suffix "main"; MSA uses service/package names.
 */

/**
 * Design Documents — unified map-only type.
 * Empty map `{}` means no documents for that tier.
 */
export interface DesignDocs {
  apiContracts: { [name: string]: string };
  feDesigns: { [name: string]: string };
  beDesigns: { [name: string]: string };
}

export function emptyDesignDocs(): DesignDocs {
  return { apiContracts: {}, feDesigns: {}, beDesigns: {} };
}

/**
 * Select design files based on environment (for decompose phase - loads all relevant)
 */
export function selectDesignFiles(
  environment: string,
  designDocs?: DesignDocs
): string[] {
  if (!designDocs) return [];

  const selectedFiles: string[] = [];

  for (const name of Object.keys(designDocs.apiContracts)) {
    selectedFiles.push(`api-contract-${name}.md`);
  }

  const shouldIncludeFe = environment === 'frontend' || environment === 'fullstack' || environment === 'unknown';
  const shouldIncludeBe = environment === 'backend' || environment === 'fullstack' || environment === 'unknown';

  if (shouldIncludeFe) {
    for (const name of Object.keys(designDocs.feDesigns)) {
      selectedFiles.push(`fe-system-${name}.md`);
    }
  }

  if (shouldIncludeBe) {
    for (const name of Object.keys(designDocs.beDesigns)) {
      selectedFiles.push(`be-system-${name}.md`);
    }
  }

  return selectedFiles;
}

/**
 * Select design files based on task.packages (for split injection).
 * All api-contracts are always injected (Strategy A: full injection).
 */
export function selectDesignFilesByPackages(
  packages: string[] | undefined,
  designDocs?: DesignDocs
): string[] {
  if (!designDocs) return [];
  if (!packages || packages.length === 0) return [];

  const selectedFiles: string[] = [];

  // Always inject ALL api-contracts
  for (const name of Object.keys(designDocs.apiContracts)) {
    selectedFiles.push(`api-contract-${name}.md`);
  }

  for (const pkg of packages) {
    if (pkg.startsWith('fe-')) {
      const name = pkg.slice(3);
      if (designDocs.feDesigns[name]) {
        selectedFiles.push(`fe-system-${name}.md`);
      }
    } else if (pkg.startsWith('be-')) {
      const name = pkg.slice(3);
      if (designDocs.beDesigns[name]) {
        selectedFiles.push(`be-system-${name}.md`);
      }
    }
  }

  return [...new Set(selectedFiles)];
}

/**
 * Get design document content by package tag.
 * Package tag format: "fe-{name}" or "be-{name}".
 * "shared" returns undefined (api-contract only, handled by caller).
 */
export function getDesignDocByPackage(
  pkg: string,
  designDocs?: DesignDocs
): string | undefined {
  if (!designDocs) return undefined;

  if (pkg.startsWith('fe-')) {
    return designDocs.feDesigns[pkg.slice(3)];
  } else if (pkg.startsWith('be-')) {
    return designDocs.beDesigns[pkg.slice(3)];
  }

  return undefined;
}

/**
 * Build combined design document for task based on packages.
 */
export function buildDesignDocForTask(
  packages: string[] | undefined,
  designDocs?: DesignDocs
): string {
  if (!designDocs) return '';

  const parts: string[] = [];

  // Always include all API contracts
  for (const [name, content] of Object.entries(designDocs.apiContracts)) {
    parts.push(`# API Contract: ${name}\n\n${content}`);
  }

  if (!packages || packages.length === 0) {
    // No packages: include everything
    for (const [name, content] of Object.entries(designDocs.feDesigns)) {
      parts.push(`# Frontend: ${name}\n\n${content}`);
    }
    for (const [name, content] of Object.entries(designDocs.beDesigns)) {
      parts.push(`# Backend: ${name}\n\n${content}`);
    }
  } else {
    for (const pkg of packages) {
      const content = getDesignDocByPackage(pkg, designDocs);
      if (content) {
        const header = pkg.startsWith('fe')
          ? `# Frontend: ${pkg.slice(3)}`
          : `# Backend: ${pkg.slice(3)}`;
        parts.push(`${header}\n\n${content}`);
      }
    }
  }

  return parts.join('\n\n────────────────────────────────────────\n\n');
}
