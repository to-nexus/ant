/**
 * TypeScript/JavaScript 에러 패턴
 */

import { ErrorPattern, ErrorLayer, DiagnosisResult } from '../types';

export const TYPESCRIPT_PATTERNS: ErrorPattern[] = [
  // ========================================
  // ENVIRONMENT LAYER - 사용자 액션 필요
  // ========================================
  {
    layer: ErrorLayer.ENVIRONMENT,
    patterns: [
      /NODE_ENV.*production/i,
      /skipping.*devDependencies/i,
      /production.*mode.*skip/i
    ],
    severity: 'critical',
    canLLMFix: false,
    diagnosis: () => ({
      type: 'environment_issue',
      layer: ErrorLayer.ENVIRONMENT,
      message: 'NODE_ENV=production is preventing devDependencies installation',
      rootCause: 'Environment variable NODE_ENV is set to production, causing npm to skip devDependencies',
      suggestedActions: [
        'npm install --include=dev',
        'unset NODE_ENV && npm install',
        'npm config set production false && npm install'
      ],
      isRetryable: false,
      canLLMFix: false,
      severity: 'critical'
    })
  },

  // ========================================
  // TOOLCHAIN LAYER - 도구 설치 문제
  // ========================================
  {
    layer: ErrorLayer.TOOLCHAIN,
    patterns: [
      /This is not the tsc command/,
      /command not found: tsc/,
      /tsc: command not found/,
      /'tsc' is not recognized/
    ],
    severity: 'critical',
    canLLMFix: false,
    diagnosis: () => ({
      type: 'missing_build_tool',
      layer: ErrorLayer.TOOLCHAIN,
      message: 'TypeScript compiler (tsc) is not installed or not in PATH',
      rootCause: 'typescript package is missing from node_modules (likely due to NODE_ENV=production)',
      suggestedActions: [
        `Check NODE_ENV: ${process.env.NODE_ENV || 'not set'}`,
        'npm install --include=dev',
        'npx tsc --version (to verify installation)'
      ],
      isRetryable: false,
      canLLMFix: false,
      severity: 'critical'
    })
  },

  {
    layer: ErrorLayer.TOOLCHAIN,
    patterns: [
      /command not found: node/,
      /node: command not found/,
      /'node' is not recognized/
    ],
    severity: 'critical',
    canLLMFix: false,
    diagnosis: () => ({
      type: 'missing_build_tool',
      layer: ErrorLayer.TOOLCHAIN,
      message: 'Node.js is not installed or not in PATH',
      rootCause: 'Node.js runtime is not available',
      suggestedActions: [
        'Install Node.js: https://nodejs.org/',
        'Add Node.js to PATH',
        'Verify: node --version'
      ],
      isRetryable: false,
      canLLMFix: false,
      severity: 'critical'
    })
  },

  // ========================================
  // DEPENDENCY LAYER - LLM이 수정 가능
  // ========================================
  
  // MISSING TYPE DECLARATIONS (@types/xxx)
  {
    layer: ErrorLayer.DEPENDENCY,
    patterns: [
      /Could not find a declaration file for module ['"]([^'"]+)['"]/,
      /Try `npm i --save-dev @types\/([^`]+)`/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match) => {
      const moduleName = match[1];
      const typesPackage = `@types/${moduleName.replace(/[\/\\]/g, '__')}`;
      
      return {
        type: 'missing_dependency',
        layer: ErrorLayer.DEPENDENCY,
        message: `Missing type declarations: ${typesPackage}`,
        rootCause: `TypeScript declaration file for "${moduleName}" is not installed`,
        suggestedActions: [
          `Install type declarations: npm install -D ${typesPackage}`,
          `Add to package.json devDependencies: "${typesPackage}": "latest"`,
          `Run: npm install`
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'major'
      };
    }
  },
  
  // TYPESCRIPT MODULE RESOLUTION CONFIG ERROR
  {
    layer: ErrorLayer.CONFIGURATION,
    patterns: [
      /Cannot find module ['"]([^'"]+)['"].*Did you mean to set the 'moduleResolution' option to ['"]?(\w+)['"]?/,
      /Did you mean to set the 'moduleResolution' option/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match) => {
      const moduleName = match[1] || 'modules';
      const suggestedResolution = match[2] || 'node';
      
      return {
        type: 'config_error',
        layer: ErrorLayer.CONFIGURATION,
        message: `TypeScript moduleResolution not configured`,
        rootCause: `tsconfig.json is missing "moduleResolution" setting, preventing module imports from being resolved`,
        suggestedActions: [
          `Add to tsconfig.json compilerOptions: "moduleResolution": "node"`,
          `Or use: "moduleResolution": "${suggestedResolution}"`,
          `Ensure @types packages are installed if needed`,
          `Common fix: Set both "module": "ESNext" and "moduleResolution": "node"`
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'major'
      };
    }
  },
  
  // LOCAL FILE IMPORTS (./path or ../path)
  {
    layer: ErrorLayer.CODE,
    patterns: [
      /Cannot find module ['"](\.\.[\/\\][\w\-/@.\\\/]+)['"]/,
      /Cannot find module ['"](\.[\/\\][\w\-/@.\\\/]+)['"]/,
      /Module not found.*['"](\.\.[\/\\][\w\-/@.\\\/]+)['"]/,
      /Module not found.*['"](\.[\/\\][\w\-/@.\\\/]+)['"]/,
      /Could not resolve ['"](\.\.[\/\\][\w\-/@.\\\/]+)['"]/,
      /Could not resolve ['"](\.[\/\\][\w\-/@.\\\/]+)['"]/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match) => {
      const filePath = match[1];
      const fileName = filePath.split(/[\/\\]/).pop() || filePath;
      
      return {
        type: 'missing_file',
        layer: ErrorLayer.CODE,
        message: `Cannot find local file: ${filePath}`,
        rootCause: `Local file or module does not exist at the specified path`,
        suggestedActions: [
          `Create the missing file: ${filePath}`,
          `Check if the import path is correct`,
          `Verify the file extension (.ts, .tsx, .js, .jsx)`,
          `If using path alias (@/), check tsconfig.json paths configuration`
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'major'
      };
    }
  },
  
  // NPM PACKAGE DEPENDENCIES (no ./ or ../)
  {
    layer: ErrorLayer.DEPENDENCY,
    patterns: [
      /Cannot find module ['"]([^.][^'"]*)['"]/,
      /Module not found.*['"]([^.][^'"]*)['"]/,
      /Error: Cannot find package ['"]([^.][^'"]*)['"]/,
      /Could not resolve ['"]([^.][^'"]*)['"]/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match) => {
      const moduleName = match[1];
      
      // Skip if it's a path alias starting with @ but followed by /
      const isPathAlias = moduleName.startsWith('@/');
      if (isPathAlias) {
        const aliasPath = moduleName.substring(2); // Remove @/
        return {
          type: 'missing_file',
          layer: ErrorLayer.CODE,
          message: `Cannot find file via path alias: ${moduleName}`,
          rootCause: `File does not exist or tsconfig.json path alias is not configured correctly`,
          suggestedActions: [
            `Create the missing file at: src/${aliasPath}`,
            `Check tsconfig.json: "paths": { "@/*": ["./src/*"] }`,
            `Verify vite.config.ts has matching alias: '@': '/src'`,
            `Ensure the file has correct extension (.ts, .tsx)`
          ],
          isRetryable: true,
          canLLMFix: true,
          severity: 'major'
        };
      }
      
      const isTypesPackage = moduleName.startsWith('@types/');
      const baseModule = moduleName.replace('@types/', '');
      
      return {
        type: 'missing_dependency',
        layer: ErrorLayer.DEPENDENCY,
        message: `Missing npm package: ${moduleName}`,
        rootCause: `Package "${moduleName}" is not in package.json or not installed`,
        suggestedActions: isTypesPackage ? [
          `Add to package.json devDependencies: "${moduleName}": "latest"`,
          'npm install'
        ] : [
          `Add to package.json dependencies: "${moduleName}": "latest"`,
          'npm install',
          `If types needed: npm install -D @types/${baseModule}`
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'major'
      };
    }
  },

  // ========================================
  // CODE LAYER - TypeScript 타입 에러
  // ========================================
  
  // ✅ CATCH-ALL: 모든 TypeScript 에러 - 전체 메시지를 그대로 추출
  {
    layer: ErrorLayer.CODE,
    patterns: [
      // Multiline pattern to capture full error message
      /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+?)(?=\n(?:\S|$))/ms
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match, context) => {
      const file = match[1]?.trim() || 'unknown';
      const line = match[2] || '?';
      const col = match[3] || '?';
      const code = match[4] || 'TS????';
      let fullMessage = match[5]?.trim() || 'Unknown TypeScript error';
      
      // ✅ Capture continuation lines (indented)
      const lines = fullMessage.split('\n');
      const mainMessage = lines[0];
      const details = lines.slice(1)
        .filter(l => l.trim().length > 0)
        .map(l => '  ' + l.trim())
        .join('\n');
      
      const completeMessage = details 
        ? `${mainMessage}\n${details}` 
        : mainMessage;
      
      // ✅ Extract specific hints based on error code
      const hints: string[] = [];
      
      // Common TS error codes with specific guidance
      if (code === 'TS2322') {
        hints.push('Type assignment error - check interface properties and types');
        if (completeMessage.includes('does not exist')) {
          const propMatch = completeMessage.match(/Property ['"](\w+)['"]/);
          if (propMatch) {
            hints.push(`Add missing property '${propMatch[1]}' to the interface`);
          }
        }
      } else if (code === 'TS6133') {
        const varMatch = completeMessage.match(/['"](\w+)['"]/);
        hints.push(varMatch 
          ? `Remove unused variable '${varMatch[1]}' or prefix with underscore` 
          : 'Remove unused variable declarations');
      } else if (code === 'TS7016') {
        hints.push('Missing TypeScript declarations - convert .jsx to .tsx or install @types');
      } else if (code === 'TS2304') {
        const nameMatch = completeMessage.match(/Cannot find name ['"](\w+)['"]/);
        hints.push(nameMatch 
          ? `Import '${nameMatch[1]}' or check for typos` 
          : 'Check imports and type definitions');
      } else if (code === 'TS6192') {
        hints.push('Remove unused import statement');
      } else if (code === 'TS2339') {
        hints.push('Property does not exist - check type definition or add property');
      } else if (code === 'TS2345') {
        hints.push('Function argument type mismatch - check function signature');
      }
      
      // Fallback hints
      if (hints.length === 0) {
        hints.push('Read the full error message carefully');
        hints.push('Fix the specific type issue described');
      }
      
      return {
        type: 'type_error',
        layer: ErrorLayer.CODE,
        message: `${file}(${line},${col}): ${code}\n${completeMessage}`,
        rootCause: 'TypeScript type checking failure',
        suggestedActions: [
          ...hints,
          'Do NOT guess - follow the error message exactly',
          'Read related type definitions and interfaces'
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: code.includes('6133') || code.includes('6192') ? 'minor' : 'major'
      };
    }
  },

  {
    layer: ErrorLayer.CODE,
    patterns: [
      /Type ['"](.+)['"] is not assignable to type ['"](.+)['"]/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match) => ({
      type: 'type_error',
      layer: ErrorLayer.CODE,
      message: `Type mismatch: '${match[1]}' cannot be assigned to '${match[2]}'`,
      rootCause: 'TypeScript type incompatibility',
      suggestedActions: [
        'Fix type annotations to match expected types',
        'Use type assertion if intentional: value as ExpectedType',
        'Update interface/type definitions'
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'major'
    })
  },

  // ========================================
  // CONFIGURATION LAYER
  // ========================================
  {
    layer: ErrorLayer.CONFIGURATION,
    patterns: [
      /Cannot find a valid TypeScript configuration/,
      /error TS5023.*Unknown compiler option/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match) => ({
      type: 'config_error',
      layer: ErrorLayer.CONFIGURATION,
      message: 'TypeScript configuration error',
      rootCause: 'Invalid or missing tsconfig.json',
      suggestedActions: [
        'Create or fix tsconfig.json',
        'Verify compiler options are valid',
        'Check for typos in option names'
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'major'
    })
  }
];

