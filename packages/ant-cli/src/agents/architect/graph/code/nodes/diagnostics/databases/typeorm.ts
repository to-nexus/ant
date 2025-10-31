/**
 * TypeORM 에러 패턴
 */

import { ErrorPattern, ErrorLayer } from '../types';

export const TYPEORM_PATTERNS: ErrorPattern[] = [
  // ========================================
  // ENVIRONMENT LAYER - Database 연결 실패
  // ========================================
  {
    layer: ErrorLayer.ENVIRONMENT,
    patterns: [
      /ECONNREFUSED.*\d+/,
      /connect ETIMEDOUT/,
      /ER_ACCESS_DENIED_ERROR/,
      /Connection.*refused/
    ],
    severity: 'critical',
    canLLMFix: false,
    diagnosis: () => ({
      type: 'environment_issue',
      layer: ErrorLayer.ENVIRONMENT,
      message: 'TypeORM database connection failed',
      rootCause: 'Cannot connect to database server',
      suggestedActions: [
        'Check database server is running',
        'Verify connection options in ormconfig or DataSource',
        'Check host, port, username, password',
        'Ensure database exists',
        'Check firewall/network settings'
      ],
      isRetryable: false,
      canLLMFix: false,
      severity: 'critical'
    })
  },

  // ========================================
  // CODE LAYER - Entity 정의 에러
  // ========================================
  {
    layer: ErrorLayer.CODE,
    patterns: [
      /Entity.*not found/,
      /No metadata for.*was found/,
      /Cannot find name ['"](\w+)['"] in entity/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match) => {
      const entityName = match[1] || 'unknown';
      
      return {
        type: 'code_error',
        layer: ErrorLayer.CODE,
        message: `TypeORM entity error: ${entityName}`,
        rootCause: 'Entity class is not properly decorated or not registered',
        suggestedActions: [
          `Ensure ${entityName} has @Entity() decorator`,
          'Check entity is exported from file',
          'Add entity to DataSource entities array',
          'Verify all @Column() decorators are correct',
          'Check for circular dependencies between entities'
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'major'
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
      /Error during migration/,
      /QueryFailedError/
    ],
    severity: 'critical',
    canLLMFix: true,
    diagnosis: () => ({
      type: 'build_error',
      layer: ErrorLayer.BUILD,
      message: 'TypeORM migration failed',
      rootCause: 'Migration could not be applied to database',
      suggestedActions: [
        'Check migration SQL syntax',
        'Verify migration order is correct',
        'Look for constraint violations',
        'Review existing data conflicts',
        'Use typeorm migration:show to see status',
        'Revert if needed: typeorm migration:revert'
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'critical'
    })
  },

  // ========================================
  // CONFIGURATION LAYER - 컬럼 타입 불일치
  // ========================================
  {
    layer: ErrorLayer.CONFIGURATION,
    patterns: [
      /Column type.*not supported/,
      /Data type.*does not match/,
      /Invalid column type/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: () => ({
      type: 'config_error',
      layer: ErrorLayer.CONFIGURATION,
      message: 'TypeORM column type mismatch',
      rootCause: 'Entity column type is not compatible with database',
      suggestedActions: [
        'Check @Column({ type: "..." }) matches database type',
        'TypeScript type should match column type',
        'Use correct type for your database (postgres, mysql, etc)',
        'Refer to TypeORM documentation for supported types',
        'Generate new migration: typeorm migration:generate'
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'major'
    })
  }
];

