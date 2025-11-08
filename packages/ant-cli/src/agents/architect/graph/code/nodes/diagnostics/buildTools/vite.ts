/**
 * Vite 빌드 도구 특화 에러 패턴
 */

import { ErrorPattern, ErrorLayer } from '../types';

export const VITE_PATTERNS: ErrorPattern[] = [
  // ========================================
  // ENVIRONMENT LAYER - Native Module Corruption
  // ========================================
  {
    layer: ErrorLayer.ENVIRONMENT,
    patterns: [
      /Cannot find module @rollup\/rollup-darwin-arm64/,
      /Cannot find module @rollup\/rollup-linux-x64/,
      /Cannot find module @rollup\/rollup-win32-x64/,
      /segment '__TEXT' load command content extends beyond end of file/,
      /ERR_DLOPEN_FAILED/,
      /npm has a bug related to optional dependencies/
    ],
    severity: 'critical',
    canLLMFix: true, // ✅ Changed: Agent CAN fix this by running terminal commands
    diagnosis: (match) => {
      const errorText = match[0] || '';
      const isCorrupted = errorText.includes('segment') || errorText.includes('DLOPEN');
      
      return {
        type: 'environment_issue',
        layer: ErrorLayer.ENVIRONMENT,
        message: 'Rollup native binary module is corrupted - requires clean dependency reinstall',
        rootCause: isCorrupted 
          ? 'Native binary file (@rollup/rollup-*) is corrupted. This happens when npm install is interrupted or encounters disk errors.'
          : 'Rollup optional dependency failed to install due to npm bug',
        suggestedActions: [
          '⚠️  CORRUPTED DEPENDENCY DETECTED - AUTO-FIX AVAILABLE',
          '',
          '🔧 EXECUTE THESE COMMANDS IN SEQUENCE:',
          '',
          '1. Navigate to project root (where package.json is located)',
          '',
          '2. Remove corrupted files:',
          '   rm -rf node_modules package-lock.json',
          '',
          '3. Clear npm cache:',
          '   npm cache clean --force',
          '',
          '4. Reinstall all dependencies:',
          '   npm install',
          '',
          '5. Verify build:',
          '   npm run build',
          '',
          '✅ This will reinstall all dependencies and fix the corrupted binary.',
          '⏱️  Expected time: 1-2 minutes',
          '',
          '🚫 DO NOT modify any source code - this is purely a dependency issue.',
          '🚫 DO NOT try to fix imports or create missing files.',
          '',
          '📌 After successful reinstall, continue with the original task.'
        ],
        isRetryable: true, // ✅ Can retry after fix
        canLLMFix: true, // ✅ Agent can execute terminal commands
        severity: 'critical'
      };
    }
  },
  
  // ========================================
  // BUILD LAYER
  // ========================================
  {
    layer: ErrorLayer.BUILD,
    patterns: [
      /\[vite\].*error/gi,
      /Could not resolve entry module ['"]([^'"]+)['"]/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match) => {
      const file = match[1] || 'unknown';
      const isIndexHtml = file.includes('index.html');
      
      return {
        type: 'build_error',
        layer: ErrorLayer.BUILD,
        message: `Vite build error: Cannot resolve entry ${file}`,
        rootCause: isIndexHtml 
          ? 'Vite requires index.html as the entry point in project root'
          : `Required file "${file}" does not exist`,
        suggestedActions: isIndexHtml ? [
          'CREATE index.html in project root',
          'Must include: <div id="root"></div>',
          'Must include: <script type="module" src="/src/main.tsx"></script>',
          'Example: <!DOCTYPE html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'
        ] : [
          `Create the missing file: ${file}`,
          'Verify vite.config.ts entry point configuration',
          'Check file path spelling and location'
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'major'
      };
    }
  },

  {
    layer: ErrorLayer.BUILD,
    patterns: [
      /failed to resolve import ['"]([^'"]+)['"]/gi,
      /\[vite\].*Cannot find module ['"]([^'"]+)['"]/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match) => {
      const importPath = match[1];
      
      return {
        type: 'import_error',
        layer: ErrorLayer.BUILD,
        message: `Vite cannot resolve import: ${importPath}`,
        rootCause: 'Import path points to non-existent file or package',
        suggestedActions: [
          `If npm package: Add "${importPath}" to package.json and run npm install`,
          `If local file: Create the file or fix the import path`,
          'Check vite.config.ts alias configuration',
          'Verify file extensions (.ts, .tsx, .js, etc)'
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'major'
      };
    }
  },

  {
    layer: ErrorLayer.CONFIGURATION,
    patterns: [
      /\[vite\].*vite\.config/i,
      /Invalid vite configuration/i
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: () => ({
      type: 'config_error',
      layer: ErrorLayer.CONFIGURATION,
      message: 'Vite configuration error in vite.config.ts',
      rootCause: 'Invalid vite.config.ts syntax or settings',
      suggestedActions: [
        'Check vite.config.ts for syntax errors',
        'Verify plugin configurations',
        'Ensure all required plugins are installed',
        'Check for typos in configuration options'
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'major'
    })
  }
];


