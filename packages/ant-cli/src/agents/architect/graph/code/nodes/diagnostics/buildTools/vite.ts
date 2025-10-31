/**
 * Vite 빌드 도구 특화 에러 패턴
 */

import { ErrorPattern, ErrorLayer } from '../types';

export const VITE_PATTERNS: ErrorPattern[] = [
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


