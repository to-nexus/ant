/**
 * Prisma ORM/Migration 에러 패턴
 */

import { ErrorPattern, ErrorLayer } from '../types';

export const PRISMA_PATTERNS: ErrorPattern[] = [
  // ========================================
  // CONFIGURATION LAYER - Schema 문법 에러
  // ========================================
  {
    layer: ErrorLayer.CONFIGURATION,
    patterns: [
      /Error validating.*schema\.prisma/,
      /Schema parsing error/,
      /Error in.*schema\.prisma/
    ],
    severity: 'critical',
    canLLMFix: true,
    diagnosis: (match, context) => {
      const output = context?.output || '';
      const lineMatch = output.match(/line (\d+)/);
      const line = lineMatch ? `at line ${lineMatch[1]}` : '';
      
      return {
        type: 'config_error',
        layer: ErrorLayer.CONFIGURATION,
        message: `Prisma schema validation failed ${line}`,
        rootCause: 'Invalid syntax or configuration in schema.prisma',
        suggestedActions: [
          'Check schema.prisma for syntax errors',
          'Ensure all model fields have valid types',
          'Check @relation directives are correct',
          'Validate datasource and generator blocks',
          'Run: npx prisma validate'
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'critical'
      };
    }
  },

  // ========================================
  // BUILD LAYER - Migration 실패
  // ========================================
  {
    layer: ErrorLayer.BUILD,
    patterns: [
      /Migration.*failed/,
      /P3006.*migration.*failed to apply/,
      /Error.*applying migration/
    ],
    severity: 'critical',
    canLLMFix: true,
    diagnosis: (match, context) => {
      const output = context?.output || '';
      const migrationName = output.match(/Migration name: (.+)/)?.[1];
      
      return {
        type: 'build_error',
        layer: ErrorLayer.BUILD,
        message: `Prisma migration failed${migrationName ? `: ${migrationName}` : ''}`,
        rootCause: 'Database migration could not be applied',
        suggestedActions: [
          'Check database is running and accessible',
          'Review migration SQL for conflicts',
          'Check for existing data that conflicts with schema changes',
          'Use: npx prisma migrate dev --create-only (to review SQL first)',
          'Or: npx prisma db push (for prototyping without migrations)'
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'critical'
      };
    }
  },

  // ========================================
  // ENVIRONMENT LAYER - Database 연결 실패
  // ========================================
  {
    layer: ErrorLayer.ENVIRONMENT,
    patterns: [
      /Can't reach database server/,
      /P1001.*Can't reach database/,
      /Connection.*timed out/,
      /ECONNREFUSED/
    ],
    severity: 'critical',
    canLLMFix: false,
    diagnosis: () => ({
      type: 'environment_issue',
      layer: ErrorLayer.ENVIRONMENT,
      message: 'Cannot connect to database',
      rootCause: 'Database server is not reachable',
      suggestedActions: [
        'Ensure database server is running',
        'Check DATABASE_URL in .env file',
        'Verify database credentials (username/password)',
        'Check firewall/network settings',
        'For Docker: ensure database container is running'
      ],
      isRetryable: false,
      canLLMFix: false,
      severity: 'critical'
    })
  },

  // ========================================
  // CONFIGURATION LAYER - 인증 실패
  // ========================================
  {
    layer: ErrorLayer.CONFIGURATION,
    patterns: [
      /P1002.*authentication failed/,
      /Access denied for user/,
      /password authentication failed/
    ],
    severity: 'critical',
    canLLMFix: false,
    diagnosis: () => ({
      type: 'config_error',
      layer: ErrorLayer.CONFIGURATION,
      message: 'Database authentication failed',
      rootCause: 'Invalid database credentials',
      suggestedActions: [
        'Check DATABASE_URL format: postgresql://USER:PASSWORD@HOST:PORT/DATABASE',
        'Verify username and password are correct',
        'Ensure database user has necessary permissions',
        'Check .env file is being loaded correctly'
      ],
      isRetryable: false,
      canLLMFix: false,
      severity: 'critical'
    })
  },

  // ========================================
  // CONFIGURATION LAYER - 모델 충돌
  // ========================================
  {
    layer: ErrorLayer.CONFIGURATION,
    patterns: [
      /Unique constraint.*violated/,
      /P2002.*Unique constraint failed/,
      /Foreign key constraint failed/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match, context) => {
      const output = context?.output || '';
      const fieldMatch = output.match(/fields?: [`'](.+?)[`']/);
      const field = fieldMatch?.[1];
      
      return {
        type: 'config_error',
        layer: ErrorLayer.CONFIGURATION,
        message: `Database constraint violation${field ? `: ${field}` : ''}`,
        rootCause: 'Schema changes conflict with existing data',
        suggestedActions: [
          'Review existing data in database',
          'Add data migration to handle constraint conflicts',
          'Use @unique or @@unique correctly in schema',
          'Consider using @default or making field optional',
          'Or clean database: npx prisma migrate reset (WARNING: deletes data)'
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'major'
      };
    }
  },

  // ========================================
  // DEPENDENCY LAYER - Prisma Client 미생성
  // ========================================
  {
    layer: ErrorLayer.DEPENDENCY,
    patterns: [
      /Cannot find module ['"]@prisma\/client['"]/,
      /Prisma Client.*not generated/,
      /Run.*prisma generate/
    ],
    severity: 'critical',
    canLLMFix: true,
    diagnosis: () => ({
      type: 'missing_dependency',
      layer: ErrorLayer.DEPENDENCY,
      message: 'Prisma Client not generated',
      rootCause: '@prisma/client is not generated from schema',
      suggestedActions: [
        'Run: npx prisma generate',
        'Ensure schema.prisma exists',
        'Add to package.json scripts: "postinstall": "prisma generate"',
        'This ensures client is generated after npm install'
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'critical'
    })
  }
];

