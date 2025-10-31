/**
 * Pytest 테스팅 프레임워크 에러 패턴
 */

import { ErrorPattern, ErrorLayer } from '../types';

export const PYTEST_PATTERNS: ErrorPattern[] = [
  // ========================================
  // CODE LAYER - Assertion 실패
  // ========================================
  {
    layer: ErrorLayer.CODE,
    patterns: [
      /AssertionError:/,
      /assert .+ == .+/,
      /Expected.*but got/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match, context) => {
      const output = context?.output || '';
      const testName = output.match(/test_(\w+)/)?.[1] || 'unknown';
      
      return {
        type: 'test_failure',
        layer: ErrorLayer.CODE,
        message: `Pytest assertion failed: test_${testName}`,
        rootCause: 'Test assertion does not match actual result',
        suggestedActions: [
          'Review assertion in test',
          'Check implementation logic',
          'Verify test fixtures and data',
          'Use pytest -vv for verbose output',
          'Add print() statements to debug'
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'major'
      };
    }
  },

  // ========================================
  // CONFIGURATION LAYER - Fixture not found
  // ========================================
  {
    layer: ErrorLayer.CONFIGURATION,
    patterns: [
      /fixture ['"](\w+)['"] not found/,
      /E\s+fixture ['"](\w+)['"].*not available/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match) => {
      const fixtureName = match[1];
      
      return {
        type: 'config_error',
        layer: ErrorLayer.CONFIGURATION,
        message: `Fixture not found: ${fixtureName}`,
        rootCause: 'Test references a fixture that is not defined',
        suggestedActions: [
          `Define fixture in conftest.py: @pytest.fixture\ndef ${fixtureName}():`,
          'Check fixture name spelling',
          'Ensure fixture is in scope (same directory or parent)',
          'Check fixture import if using pytest plugin',
          'List available fixtures: pytest --fixtures'
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'major'
      };
    }
  },

  // ========================================
  // DEPENDENCY LAYER - Import 에러
  // ========================================
  {
    layer: ErrorLayer.DEPENDENCY,
    patterns: [
      /ImportError: cannot import name ['"](\w+)['"]/,
      /ModuleNotFoundError.*in test/,
      /No module named ['"](.+?)['"].*test/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match) => {
      const moduleName = match[1];
      
      return {
        type: 'import_error',
        layer: ErrorLayer.DEPENDENCY,
        message: `Test cannot import: ${moduleName}`,
        rootCause: 'Import path is incorrect or module not installed',
        suggestedActions: [
          'Check import path is correct',
          'Verify module is installed: pip list',
          'Install if missing: pip install ' + moduleName,
          'Check PYTHONPATH includes source directory',
          'Add __init__.py files if missing'
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'major'
      };
    }
  },

  // ========================================
  // CODE LAYER - Test collection 실패
  // ========================================
  {
    layer: ErrorLayer.CODE,
    patterns: [
      /ERROR collecting test/,
      /test collection failed/,
      /SyntaxError.*test_/
    ],
    severity: 'critical',
    canLLMFix: true,
    diagnosis: () => ({
      type: 'syntax_error',
      layer: ErrorLayer.CODE,
      message: 'Pytest test collection failed',
      rootCause: 'Syntax error or import error in test file',
      suggestedActions: [
        'Check test file for syntax errors',
        'Verify all imports at top of file',
        'Check for invalid pytest fixtures',
        'Ensure test functions start with test_',
        'Run: pytest --collect-only to see collection errors'
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'critical'
    })
  }
];

