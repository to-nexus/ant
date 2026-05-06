import { ServiceConnection } from '../../../../../../core/ports/portRegistry';
import { PreviewIssue, PreviewIssueReasoning } from '../types';
import { logger } from '../../../../../../utils/logger';

export interface DiagnosisResult {
  issues: PreviewIssue[];
  affectedConnections: string[];  // connection IDs with problems
}

/**
 * Service-Virtualization-aware severity downgrade.
 *
 * When a connection that COULD run on a virtualized adapter fails to
 * reach its real endpoint, we downgrade `fatal` to `warning` and append
 * a suggestion prefix that names the toggle env var. This preserves the
 * Walking-Skeleton contract: the user can keep developing while real
 * backends are unavailable. `infrastructure` connections (no
 * `virtualization` field) keep the original severity — docker-compose
 * is the only legitimate provider for them.
 */
function downgradeIfVirtualizable(
  conn: ServiceConnection | undefined,
  baseSeverity: 'fatal' | 'warning',
): { severity: 'fatal' | 'warning'; suggestionPrefix: string } {
  if (!conn?.virtualization) return { severity: baseSeverity, suggestionPrefix: '' };
  if (conn.virtualization.active) {
    return {
      severity: 'warning',
      suggestionPrefix: `Service Virtualization (${conn.virtualization.toggleEnvVar}=true) 가 활성 상태인데도 real endpoint 시도가 감지되었습니다. 코드가 토글을 무시하고 있을 수 있습니다. `,
    };
  }
  return {
    severity: 'warning',
    suggestionPrefix: `${conn.virtualization.toggleEnvVar}=true 로 설정하면 real endpoint 없이 virtualized adapter 로 동작합니다 (Service Virtualization). `,
  };
}

/**
 * RuntimeDiagnostics
 * 
 * Analyzes process exit logs to diagnose startup failures.
 * Maps log patterns to PreviewIssue objects with suggested fixes.
 * 
 * Invoked when a process exits within 10 seconds of spawn (early exit = likely config issue).
 */
export class RuntimeDiagnostics {

  /**
   * Analyze recent logs against known connections to produce diagnosis.
   */
  analyze(logs: string, connections: ServiceConnection[]): DiagnosisResult {
    const issues: PreviewIssue[] = [];
    const affectedConnections: string[] = [];

    // 1. Connection refused / unreachable service.
    //    The trailing `[^\n]*` is greedy on purpose: a lazy quantifier
    //    here would stop at `ECONNREFUSED` and the optional port group
    //    would never consume `:port`, leaving every `affected` lookup
    //    null. With a greedy run we capture the rest of the line so the
    //    inner `match(/:(\d+)/)` can find the port — required for the
    //    Service Virtualization downgrade to fire.
    const connRefusedMatches = logs.match(/(?:ECONNREFUSED|connection refused|connect ECONNREFUSED)[^\n]*(?::(\d+))?/gi);
    if (connRefusedMatches) {
      for (const match of connRefusedMatches) {
        const portMatch = match.match(/:(\d+)/);
        const port = portMatch ? parseInt(portMatch[1], 10) : null;

        // Try to find matching connection by port
        const affected = port
          ? connections.find(c => c.value.includes(`:${port}`))
          : null;

        if (affected) {
          affectedConnections.push(affected.id);
          const { severity, suggestionPrefix } = downgradeIfVirtualizable(affected, 'fatal');
          const baseFix = affected.resolution.type === 'docker'
            ? `docker compose 서비스 "${affected.resolution.service}"가 실행 중인지 확인하고, 필요하면 docker compose up -d를 실행해주세요.`
            : `"${affected.name}" 서비스(${affected.envVar}=${affected.value})에 연결할 수 없습니다. 서비스가 실행 중인지 확인해주세요.`;
          issues.push({
            reasoning: 'infra-missing' as PreviewIssueReasoning,
            severity,
            reason: `Service "${affected.name}" is unreachable on port ${port}. Is the infrastructure running?`,
            suggestedFix: `${suggestionPrefix}${baseFix}`,
          });
        } else {
          issues.push({
            reasoning: 'connection-refused' as PreviewIssueReasoning,
            severity: 'fatal',
            reason: `Connection refused${port ? ` on port ${port}` : ''}. A required service may not be running.`,
            suggestedFix: `연결이 거부되었습니다${port ? ` (포트 ${port})` : ''}. docker compose up -d로 인프라 서비스를 시작해주세요.`,
          });
        }
      }
    }

    // 2. Missing environment variable
    const envMissingPatterns = [
      /(?:env(?:ironment)?\s+(?:variable\s+)?|required\s+)["']?(\w+)["']?\s+(?:is\s+)?(?:not\s+set|missing|required|undefined)/gi,
      /(\w+)\s+(?:must be|should be|needs to be)\s+(?:set|defined|configured)/gi,
      /panic:.*?["'](\w+)["'].*?(?:not set|empty|missing)/gi,
    ];

    for (const pattern of envMissingPatterns) {
      let match;
      while ((match = pattern.exec(logs)) !== null) {
        const envVar = match[1];
        const affected = connections.find(c => c.envVar === envVar);

        if (affected) {
          affectedConnections.push(affected.id);
        }

        const configRef = affected?.configSource === 'toml'
          ? 'config.example.toml'
          : '.env.example';
        const { severity, suggestionPrefix } = downgradeIfVirtualizable(affected, 'fatal');
        const baseFix = affected
          ? `.env 파일에 ${envVar}을 설정해주세요. 예: ${envVar}=${affected.value || 'YOUR_VALUE'}`
          : `.env 파일에 ${envVar}을 설정해주세요. ${configRef}을 참고하여 적절한 값을 입력해주세요.`;
        issues.push({
          reasoning: 'env-missing' as PreviewIssueReasoning,
          severity,
          reason: `Environment variable "${envVar}" is not set.`,
          suggestedFix: `${suggestionPrefix}${baseFix}`,
        });
      }
    }

    // 3. Authentication / access denied
    if (/(?:authentication failed|access denied|permission denied|auth.*fail)/i.test(logs)) {
      const affectedByAuth = connections.filter(c =>
        c.category === 'infrastructure' && logs.toLowerCase().includes(c.id)
      );

      for (const conn of affectedByAuth) {
        affectedConnections.push(conn.id);
      }

      issues.push({
        reasoning: 'connection-refused' as PreviewIssueReasoning,
        severity: 'fatal',
        reason: 'Authentication failed for a service connection. Check credentials.',
        suggestedFix: `서비스 인증에 실패했습니다. .env 파일의 접속 정보(사용자명, 비밀번호)가 올바른지 확인해주세요.`,
      });
    }

    // 4. Check for annotation-missing connections (non-log-based)
    const missingAnnotations = connections.filter(c => c.missingAnnotation);
    for (const conn of missingAnnotations) {
      const targetFile = conn.configSource === 'toml' ? 'config.example.toml' : '.env.example';
      const annotationHint = conn.configSource === 'toml'
        ? `# @connection ${conn.category} ${conn.id} env:${conn.envVar}`
        : `# @connection ${conn.category} ${conn.id}`;
      issues.push({
        reasoning: 'annotation-missing' as PreviewIssueReasoning,
        severity: 'warning',
        reason: `Connection "${conn.name}" (${conn.envVar}) was detected via fallback. Add @connection annotation to ${targetFile}.`,
        suggestedFix: `${targetFile} 파일에서 ${conn.envVar}에 대한 "${annotationHint}" 어노테이션을 추가해주세요.`,
      });
    }

    if (issues.length > 0) {
      logger.info(`[RuntimeDiagnostics] Diagnosed ${issues.length} issues (${affectedConnections.length} connections affected)`, { component: 'RuntimeDiagnostics' });
    }

    return { issues, affectedConnections: [...new Set(affectedConnections)] };
  }
}
