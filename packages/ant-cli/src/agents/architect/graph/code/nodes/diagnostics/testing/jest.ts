/**
 * Jest/Vitest 테스팅 프레임워크 에러 패턴
 */

import { ErrorPattern, ErrorLayer } from '../types';

export const JEST_PATTERNS: ErrorPattern[] = [
  // ========================================
  // CODE LAYER - Assertion 실패
  // ========================================
  {
    layer: ErrorLayer.CODE,
    patterns: [
      /Expected:.*\n.*Received:/,
      /expect.*toBe.*but received/,
      /Assertion failed/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match, context) => {
      const output = context?.output || '';
      const testName = output.match(/●.*\n.*(.+)/)?.[1] || 'unknown test';
      
      return {
        type: 'test_failure',
        layer: ErrorLayer.CODE,
        message: `Test assertion failed: ${testName}`,
        rootCause: 'Test expectation does not match actual result',
        suggestedActions: [
          'Review test expectations',
          'Check if implementation logic is correct',
          'Verify test data/fixtures are valid',
          'Update test if behavior changed intentionally',
          'Add console.log to debug actual values'
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'major'
      };
    }
  },

  // ========================================
  // CODE LAYER - Timeout 초과
  // ========================================
  {
    layer: ErrorLayer.CODE,
    patterns: [
      /Timeout - Async.*did not complete/,
      /exceeded timeout of (\d+)ms/,
      /Test timeout/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match) => {
      const timeout = match[1] || '5000';
      
      return {
        type: 'test_failure',
        layer: ErrorLayer.CODE,
        message: `Test timeout exceeded (${timeout}ms)`,
        rootCause: 'Async operation took too long or did not complete',
        suggestedActions: [
          'Increase timeout: test("name", async () => {...}, 10000)',
          'Check for missing await keywords',
          'Ensure promises are properly resolved/rejected',
          'Check for infinite loops or hanging operations',
          'Mock slow external API calls'
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'major'
      };
    }
  },

  // ========================================
  // DEPENDENCY LAYER - Module not found in test
  // ========================================
  {
    layer: ErrorLayer.DEPENDENCY,
    patterns: [
      /Cannot find module ['"](.+?)['"].*from ['"](.+?\.test|.+?\.spec)['"]/,
      /Jest.*Cannot find module/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match) => {
      const moduleName = match[1];
      const testFile = match[2];
      
      return {
        type: 'import_error',
        layer: ErrorLayer.DEPENDENCY,
        message: `Test cannot import: ${moduleName}`,
        rootCause: `Import path is incorrect in test file`,
        suggestedActions: [
          'Check import path is correct',
          'Use correct relative path (../ or ./)',
          'Verify module is exported from source file',
          'Check jest.config moduleNameMapper for path aliases',
          'Ensure file extension is included if required'
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'major'
      };
    }
  },

  // ========================================
  // CODE LAYER - Mock 에러
  // ========================================
  {
    layer: ErrorLayer.CODE,
    patterns: [
      /Expected.*to have been called/,
      /Mock function.*not called/,
      /Number of calls.*(\d+)/
    ],
    severity: 'minor',
    canLLMFix: true,
    diagnosis: () => ({
      type: 'test_failure',
      layer: ErrorLayer.CODE,
      message: 'Mock function expectation failed',
      rootCause: 'Mocked function was not called as expected',
      suggestedActions: [
        'Verify mock is properly set up with jest.fn() or vi.fn()',
        'Check mock is used in the code being tested',
        'Use mockClear() between tests',
        'Check call count: expect(mock).toHaveBeenCalledTimes(n)',
        'Debug with: console.log(mock.mock.calls)'
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'minor'
    })
  },

  // ========================================
  // CONFIGURATION LAYER - Jest config 에러
  // ========================================
  {
    layer: ErrorLayer.CONFIGURATION,
    patterns: [
      /Invalid.*jest.*config/i,
      /Configuration.*validation error/,
      /Unknown config option/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: () => ({
      type: 'config_error',
      layer: ErrorLayer.CONFIGURATION,
      message: 'Jest configuration error',
      rootCause: 'Invalid jest.config.js or vitest.config.ts',
      suggestedActions: [
        'Check jest.config.js syntax',
        'Verify all options are valid',
        'Check for typos in config keys',
        'Refer to Jest documentation for valid options',
        'Use npx jest --showConfig to debug'
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'major'
    })
  },

  // ========================================
  // CODE LAYER - Snapshot 불일치
  // ========================================
  {
    layer: ErrorLayer.CODE,
    patterns: [
      /Snapshot.*mismatch/,
      /Received.*does not match stored snapshot/,
      /(\d+) snapshot.*failed/
    ],
    severity: 'minor',
    canLLMFix: true,
    diagnosis: (match) => {
      const count = match[1] || '1';
      
      return {
        type: 'test_failure',
        layer: ErrorLayer.CODE,
        message: `${count} snapshot test(s) failed`,
        rootCause: 'Component output changed from stored snapshot',
        suggestedActions: [
          'Review snapshot diff carefully',
          'If change is intentional: jest -u (update snapshots)',
          'If change is unintentional: fix the code',
          'Check for non-deterministic output (dates, random values)',
          'Use inline snapshots for small changes'
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'minor'
      };
    }
  }
];

