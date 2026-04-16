/**
 * Test environment (jsdom/happy-dom) error patterns.
 * These catch errors caused by missing Web APIs in simulated DOM environments,
 * guiding the LLM to fix test setup rather than modifying source code.
 */

import { ErrorPattern, ErrorLayer } from '../types';

export const TEST_ENVIRONMENT_PATTERNS: ErrorPattern[] = [
  // ========================================
  // CONFIGURATION LAYER - Missing Web API in test environment
  // ========================================
  {
    layer: ErrorLayer.CONFIGURATION,
    patterns: [
      /ReferenceError: (\w+) is not defined/,
      /ReferenceError: (\w+) is not a constructor/,
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match) => {
      const apiName = match[1] || 'unknown';
      const knownTestEnvGaps: Record<string, string> = {
        'ResizeObserver': 'Add ResizeObserver mock in test setup file',
        'IntersectionObserver': 'Add IntersectionObserver mock in test setup file',
        'MutationObserver': 'Add MutationObserver mock in test setup file',
        'matchMedia': 'Add window.matchMedia mock in test setup file',
        'TextEncoder': 'Add TextEncoder polyfill or use --experimental-vm-modules',
        'TextDecoder': 'Add TextDecoder polyfill or use --experimental-vm-modules',
        'fetch': 'Add fetch polyfill (whatwg-fetch) or use msw for API mocking',
        'Request': 'Add fetch polyfill that includes Request/Response globals',
        'Response': 'Add fetch polyfill that includes Request/Response globals',
        'structuredClone': 'Add structuredClone polyfill in test setup',
      };

      const specificFix = knownTestEnvGaps[apiName];
      return {
        type: 'test_environment_gap',
        layer: ErrorLayer.CONFIGURATION,
        message: `Test environment does not implement: ${apiName}`,
        rootCause: `${apiName} is a browser/Node API not available in the test environment (jsdom/happy-dom)`,
        suggestedActions: [
          specificFix || `Add ${apiName} mock/polyfill in the test setup file (setupFilesAfterEnv)`,
          'Do NOT modify source code to work around a missing test API',
          'Check if the test environment can be switched (e.g., jsdom → happy-dom)',
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'major'
      };
    }
  },

  // ========================================
  // CONFIGURATION LAYER - ESM/CJS module conflict in tests
  // ========================================
  {
    layer: ErrorLayer.CONFIGURATION,
    patterns: [
      /SyntaxError: Cannot use import statement outside a module/,
      /ERR_REQUIRE_ESM/,
      /Must use import to load ES Module/,
      /require\(\) of ES Module.*not supported/,
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: () => ({
      type: 'module_system_conflict',
      layer: ErrorLayer.CONFIGURATION,
      message: 'ESM/CJS module system conflict in test environment',
      rootCause: 'A dependency uses ES modules but the test runner expects CommonJS (or vice versa)',
      suggestedActions: [
        'Check transformIgnorePatterns in test config — the offending package may need transformation',
        'Verify "type": "module" in package.json matches test runner expectations',
        'For Jest: add the package to transformIgnorePatterns exclusion',
        'For Vitest: check deps.inline or deps.optimizer settings',
        'Do NOT change the dependency itself — fix the test runner configuration',
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'major'
    })
  },

  // ========================================
  // CONFIGURATION LAYER - Test environment not configured
  // ========================================
  {
    layer: ErrorLayer.CONFIGURATION,
    patterns: [
      /The error below may be caused by using the wrong test environment/,
      /Consider using the "jsdom" test environment/,
      /document is not defined/,
      /window is not defined/,
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: () => ({
      type: 'test_environment_missing',
      layer: ErrorLayer.CONFIGURATION,
      message: 'Test environment not configured for DOM testing',
      rootCause: 'Tests use browser APIs (document, window) but test environment is set to "node" instead of "jsdom"',
      suggestedActions: [
        'Set testEnvironment: "jsdom" in jest.config or vitest.config',
        'Or add /** @jest-environment jsdom */ docblock to individual test files',
        'For Vitest: set environment: "jsdom" in vitest.config.ts',
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'major'
    })
  },
];
