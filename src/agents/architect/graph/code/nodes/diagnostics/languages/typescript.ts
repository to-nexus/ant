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
  {
    layer: ErrorLayer.CODE,
    patterns: [
      /error TS(\d+):.*Cannot find name ['"](\w+)['"]/,
      /\(\d+,\d+\): error TS(\d+):/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match) => {
      const errorCode = match[1];
      const name = match[2] || 'unknown';
      
      return {
        type: 'type_error',
        layer: ErrorLayer.CODE,
        message: `TypeScript error TS${errorCode}: Cannot find name '${name}'`,
        rootCause: 'Type checking failure - missing import or incorrect type',
        suggestedActions: [
          `Import '${name}' from the correct module`,
          'Fix type annotations',
          'Install @types packages if needed',
          'Check tsconfig.json compiler options'
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'major'
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

