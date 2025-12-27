/**
 * Error parsing functions for different build tools
 */

/**
 * Parse TypeScript errors with better context and multi-line support
 */
export function parseTypeScriptErrors(output: string): string[] {
  // ✅ Special case: tsc not found
  if (output.includes('This is not the tsc command') || 
      output.includes('command not found: tsc') ||
      output.includes('tsc: command not found')) {
    return [
      '❌ CRITICAL: TypeScript compiler (tsc) is not installed or not in PATH',
      '',
      '🔍 This usually means devDependencies were not installed.',
      '   Possible causes:',
      '   1. NODE_ENV=production preventing devDependencies installation',
      '   2. npm install ran with --production flag',
      '   3. .npmrc has production=true setting',
      '',
      `   Current NODE_ENV: ${process.env.NODE_ENV || 'not set'}`,
      '',
      '✅ Solution: npm install --include=dev'
    ];
  }
  
  const lines = output.split('\n');
  const errors: string[] = [];
  let currentError = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // TypeScript error format: src/App.tsx(10,5): error TS2304: Cannot find name 'React'.
    if (line.match(/\(\d+,\d+\):\s*error\s+TS\d+:/)) {
      // Save previous error if exists
      if (currentError) {
        errors.push(currentError.trim());
      }
      currentError = line;
    }
    // Continuation line (usually indented or starts with spaces)
    else if (currentError && line.match(/^\s+/) && line.trim().length > 0) {
      currentError += '\n' + line;
    }
    // End of current error
    else if (currentError && line.trim().length === 0) {
      errors.push(currentError.trim());
      currentError = '';
    }
  }
  
  // Don't forget last error
  if (currentError) {
    errors.push(currentError.trim());
  }
  
  return errors.length > 0 ? errors : [output];
}

/**
 * Parse lint errors
 */
export function parseLintErrors(stdout: string): string[] {
  const lines = stdout.split('\n');
  const errors: string[] = [];
  
  for (const line of lines) {
    if (line.includes('error') || line.includes('✖')) {
      errors.push(line.trim());
    }
  }
  
  return errors.length > 0 ? errors : [stdout];
}

/**
 * Parse build errors with enhanced diagnostics for multiple build tools
 */
export function parseBuildErrors(output: string): string[] {
  const errors: string[] = [];
  
  // ✅ 1. Check for tsc not found (critical - should be caught by type check but defensive)
  if (output.includes('This is not the tsc command') || 
      output.includes('command not found: tsc') ||
      output.includes('tsc: command not found')) {
    errors.push('❌ CRITICAL: TypeScript compiler not found during build');
    errors.push('   See type check errors for full diagnosis and solution');
    return errors;
  }
  
  // ✅ 2. Check for missing entry module (common in Vite projects)
  const entryModuleMatch = output.match(/Could not resolve entry module ["'](.+?)["']/);
  if (entryModuleMatch) {
    const missingFile = entryModuleMatch[1];
    errors.push(`📄 MISSING ENTRY FILE: ${missingFile}`);
    errors.push('');
    if (missingFile.includes('index.html')) {
      errors.push('Vite projects REQUIRE index.html as the entry point.');
      errors.push('🔧 CREATE THIS FILE with content like:');
      errors.push('   <!DOCTYPE html>');
      errors.push('   <html><head><title>App</title></head>');
      errors.push('   <body><div id="root"></div>');
      errors.push('   <script type="module" src="/src/main.tsx"></script></body></html>');
    } else {
      errors.push(`🔧 CREATE THIS FILE: ${missingFile}`);
    }
    errors.push('');
  }
  
  // ✅ 3. Check for module/import errors
  const moduleErrors = output.match(/Cannot find module ["']([^"']+)["']/gi);
  if (moduleErrors && moduleErrors.length > 0) {
    errors.push(`📦 MISSING MODULES (${moduleErrors.length}):`);
    moduleErrors.slice(0, 3).forEach(err => {
      const module = err.match(/["']([^"']+)["']/)?.[1];
      errors.push(`   • ${module}`);
    });
    if (moduleErrors.length > 3) {
      errors.push(`   ... and ${moduleErrors.length - 3} more`);
    }
    errors.push('');
  }
  
  // ✅ 4. Check for Vite-specific errors
  const viteErrors = output.match(/\[vite\].*error.*/gi);
  if (viteErrors) {
    errors.push('🔴 Vite Errors:');
    viteErrors.slice(0, 3).forEach(err => errors.push(`   ${err.trim()}`));
    if (viteErrors.length > 3) {
      errors.push(`   ... and ${viteErrors.length - 3} more`);
    }
    errors.push('');
  }
  
  // ✅ 5. Check for import resolution errors
  const importErrors = output.match(/failed to resolve import ["']([^"']+)["']/gi);
  if (importErrors) {
    errors.push('🔗 Import Resolution Failures:');
    importErrors.slice(0, 3).forEach(err => errors.push(`   ${err.trim()}`));
    if (importErrors.length > 3) {
      errors.push(`   ... and ${importErrors.length - 3} more`);
    }
    errors.push('');
  }
  
  // ✅ 6. Fallback: extract context around error keywords
  if (errors.length === 0) {
    const lines = output.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      if (line.includes('error') || line.includes('failed') || line.includes('✖')) {
        // Add context: prev + current + next
        if (i > 0) errors.push(lines[i - 1].trim());
        errors.push(lines[i].trim());
        if (i < lines.length - 1) errors.push(lines[i + 1].trim());
        errors.push('');
        break; // Only first error for now
      }
    }
  }
  
  // ✅ 7. Last resort: filtered output
  if (errors.length === 0) {
    const filtered = output.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.toLowerCase().includes('deprecated'))
      .slice(0, 15);
    return filtered.length > 0 ? filtered : [output.slice(0, 500)];
  }
  
  return errors;
}

