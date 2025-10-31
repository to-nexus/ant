/**
 * npm 패키지 매니저 에러 패턴
 */

import { ErrorPattern, ErrorLayer } from '../types';

export const NPM_PATTERNS: ErrorPattern[] = [
  // ========================================
  // DEPENDENCY LAYER - 의존성 충돌
  // ========================================
  {
    layer: ErrorLayer.DEPENDENCY,
    patterns: [
      /ERESOLVE unable to resolve dependency tree/,
      /Could not resolve dependency:/,
      /ERESOLVE could not resolve/
    ],
    severity: 'critical',
    canLLMFix: true,
    diagnosis: (match, context) => {
      const output = context?.output || '';
      
      // Extract conflicting package info
      const conflictMatch = output.match(/npm ERR! peer ([^@]+)@"([^"]+)" from ([^\n]+)/);
      const packageName = conflictMatch?.[1] || 'unknown';
      const requiredVersion = conflictMatch?.[2];
      
      return {
        type: 'dependency_conflict',
        layer: ErrorLayer.DEPENDENCY,
        message: `Dependency resolution failed: ${packageName} version conflict`,
        rootCause: 'Multiple packages require incompatible versions of the same dependency',
        suggestedActions: [
          `Check which packages require ${packageName}: npm ls ${packageName}`,
          'Update conflicting packages to compatible versions',
          'Use package.json "overrides" field to force a specific version',
          'Or use --legacy-peer-deps flag (not recommended for new projects)'
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'critical'
      };
    }
  },

  {
    layer: ErrorLayer.DEPENDENCY,
    patterns: [
      /requires a peer of ([^@]+)@([^\s]+) but none is installed/,
      /peer ([^@]+)@"([^"]+)" from/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match) => {
      const packageName = match[1];
      const version = match[2];
      
      return {
        type: 'missing_peer_dependency',
        layer: ErrorLayer.DEPENDENCY,
        message: `Missing peer dependency: ${packageName}@${version}`,
        rootCause: 'A package requires a peer dependency that is not installed',
        suggestedActions: [
          `Add to package.json dependencies: "${packageName}": "${version}"`,
          'Run: npm install',
          'Check package documentation for correct peer dependency versions'
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'major'
      };
    }
  },

  // ========================================
  // ENVIRONMENT LAYER - 네트워크/레지스트리
  // ========================================
  {
    layer: ErrorLayer.ENVIRONMENT,
    patterns: [
      /ETIMEDOUT/,
      /ENOTFOUND registry\.npmjs\.org/,
      /network error/i,
      /ERR_SOCKET_TIMEOUT/
    ],
    severity: 'critical',
    canLLMFix: false,
    diagnosis: () => ({
      type: 'environment_issue',
      layer: ErrorLayer.ENVIRONMENT,
      message: 'npm registry network error',
      rootCause: 'Cannot reach npm registry (network, firewall, or proxy issue)',
      suggestedActions: [
        'Check internet connection',
        'Check firewall/proxy settings',
        'Try: npm config set registry https://registry.npmjs.org/',
        'Or use mirror: npm config set registry https://registry.npmmirror.com/',
        'Clear cache: npm cache clean --force'
      ],
      isRetryable: false,
      canLLMFix: false,
      severity: 'critical'
    })
  },

  // ========================================
  // TOOLCHAIN LAYER - npm/Node 버전
  // ========================================
  {
    layer: ErrorLayer.TOOLCHAIN,
    patterns: [
      /npm ERR! notsup Unsupported engine/,
      /Required: \{"node":"([^"]+)"\}/,
      /Unsupported engine/
    ],
    severity: 'critical',
    canLLMFix: false,
    diagnosis: (match, context) => {
      const output = context?.output || '';
      const nodeVersionMatch = output.match(/Required:.*"node":"([^"]+)"/);
      const requiredNode = nodeVersionMatch?.[1] || match[1] || 'unknown';
      
      return {
        type: 'toolchain_version',
        layer: ErrorLayer.TOOLCHAIN,
        message: 'Node.js version incompatibility',
        rootCause: `Project requires Node.js ${requiredNode}, but current version is ${process.version}`,
        suggestedActions: [
          `Current Node.js: ${process.version}`,
          `Required: ${requiredNode}`,
          'Install correct Node.js version',
          'Use nvm: nvm install ' + requiredNode.replace(/[^0-9.]/g, '').split('.')[0],
          'Or update package.json engines field if requirement is incorrect'
        ],
        isRetryable: false,
        canLLMFix: false,
        severity: 'critical'
      };
    }
  },

  // ========================================
  // CONFIGURATION LAYER - package.json 문제
  // ========================================
  {
    layer: ErrorLayer.CONFIGURATION,
    patterns: [
      /Invalid package\.json/,
      /JSON.*parse/i,
      /Unexpected token.*package\.json/
    ],
    severity: 'critical',
    canLLMFix: true,
    diagnosis: () => ({
      type: 'config_error',
      layer: ErrorLayer.CONFIGURATION,
      message: 'Invalid package.json syntax',
      rootCause: 'package.json contains JSON syntax errors or invalid fields',
      suggestedActions: [
        'Check package.json for syntax errors (trailing commas, missing quotes)',
        'Validate with: npx jsonlint package.json',
        'Ensure all version strings are valid semver',
        'Remove any comments (JSON does not support comments)'
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'critical'
    })
  },

  // ========================================
  // DEPENDENCY LAYER - 404 / 패키지 없음
  // ========================================
  {
    layer: ErrorLayer.DEPENDENCY,
    patterns: [
      /404.*'([^']+)' is not in this registry/,
      /ERR.*404.*Not Found.*GET.*\/([^\s]+)/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match) => {
      const packageName = match[1];
      
      return {
        type: 'missing_dependency',
        layer: ErrorLayer.DEPENDENCY,
        message: `Package not found: ${packageName}`,
        rootCause: 'Package does not exist in npm registry or name is misspelled',
        suggestedActions: [
          `Verify package name: npm search ${packageName}`,
          'Check for typos in package.json',
          'Package may have been unpublished or deprecated',
          'Use alternative package if this one is no longer available'
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'major'
      };
    }
  },

  // ========================================
  // CONFIGURATION LAYER - lockfile 충돌
  // ========================================
  {
    layer: ErrorLayer.CONFIGURATION,
    patterns: [
      /npm ERR! Lockfile is out of date/,
      /npm ERR!.*package-lock\.json/
    ],
    severity: 'minor',
    canLLMFix: true,
    diagnosis: () => ({
      type: 'config_error',
      layer: ErrorLayer.CONFIGURATION,
      message: 'package-lock.json is out of sync',
      rootCause: 'package.json was modified but lockfile was not updated',
      suggestedActions: [
        'Delete package-lock.json and node_modules',
        'Run: npm install',
        'Or update lockfile: npm install --package-lock-only',
        'Commit the updated package-lock.json'
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'minor'
    })
  }
];

