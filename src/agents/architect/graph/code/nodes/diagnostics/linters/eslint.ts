/**
 * ESLint 린터 에러 패턴
 */

import { ErrorPattern, ErrorLayer } from '../types';

export const ESLINT_PATTERNS: ErrorPattern[] = [
  // ========================================
  // CODE LAYER - Lint rule 위반
  // ========================================
  {
    layer: ErrorLayer.CODE,
    patterns: [
      /(\d+):(\d+)\s+error\s+(.+?)\s+([\w-]+)/,
      /✖\s+(\d+) problems?/
    ],
    severity: 'minor',
    canLLMFix: true,
    diagnosis: (match, context) => {
      const output = context?.output || '';
      const errorCount = match[1] || '1';
      
      // Extract first few errors
      const errors = output.match(/error\s+(.+?)\s+([\w/-]+)/g)?.slice(0, 3) || [];
      
      return {
        type: 'lint_error',
        layer: ErrorLayer.CODE,
        message: `ESLint found ${errorCount} error(s)`,
        rootCause: 'Code violates ESLint rules',
        suggestedActions: [
          'Fix lint errors: npx eslint --fix',
          'Review errors:\n' + errors.join('\n'),
          'Disable rule if intentional: // eslint-disable-next-line rule-name',
          'Update .eslintrc if rule is too strict',
          'Most errors can be auto-fixed with --fix flag'
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'minor'
      };
    }
  },

  // ========================================
  // CONFIGURATION LAYER - ESLint config 에러
  // ========================================
  {
    layer: ErrorLayer.CONFIGURATION,
    patterns: [
      /Error.*\.eslintrc/,
      /Invalid.*ESLint configuration/,
      /Cannot find module.*eslint-config/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: () => ({
      type: 'config_error',
      layer: ErrorLayer.CONFIGURATION,
      message: 'ESLint configuration error',
      rootCause: 'Invalid .eslintrc or missing ESLint config package',
      suggestedActions: [
        'Check .eslintrc.js/.eslintrc.json syntax',
        'Install missing config: npm install --save-dev eslint-config-*',
        'Verify extends field references valid configs',
        'Check plugins are installed',
        'Test config: npx eslint --print-config file.js'
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'major'
    })
  },

  // ========================================
  // DEPENDENCY LAYER - Plugin 누락
  // ========================================
  {
    layer: ErrorLayer.DEPENDENCY,
    patterns: [
      /Definition for rule ['"](.+?)['"] was not found/,
      /Failed to load plugin ['"](.+?)['"]/,
      /eslint-plugin-(.+?) not found/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match) => {
      const pluginName = match[1];
      const packageName = pluginName.startsWith('eslint-plugin-') 
        ? pluginName 
        : `eslint-plugin-${pluginName}`;
      
      return {
        type: 'missing_dependency',
        layer: ErrorLayer.DEPENDENCY,
        message: `ESLint plugin not found: ${pluginName}`,
        rootCause: 'ESLint plugin is not installed',
        suggestedActions: [
          `Install: npm install --save-dev ${packageName}`,
          'Add to .eslintrc plugins array if not present',
          'Verify plugin name spelling',
          'Check plugin is compatible with current ESLint version'
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'major'
      };
    }
  },

  // ========================================
  // CODE LAYER - Parsing 에러
  // ========================================
  {
    layer: ErrorLayer.CODE,
    patterns: [
      /Parsing error:/,
      /Unexpected token/,
      /ESLint.*parser.*error/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match, context) => {
      const output = context?.output || '';
      const fileMatch = output.match(/(.+?\.(ts|tsx|js|jsx))/);
      const file = fileMatch?.[1] || 'unknown file';
      
      return {
        type: 'syntax_error',
        layer: ErrorLayer.CODE,
        message: `ESLint parsing error in ${file}`,
        rootCause: 'File has syntax errors or unsupported syntax',
        suggestedActions: [
          'Check file for syntax errors',
          'Ensure correct parser is configured (@typescript-eslint/parser for TS)',
          'Verify parserOptions.ecmaVersion in .eslintrc',
          'For JSX: ensure parserOptions.ecmaFeatures.jsx is true',
          'Check file extension matches parser configuration'
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'major'
      };
    }
  }
];


