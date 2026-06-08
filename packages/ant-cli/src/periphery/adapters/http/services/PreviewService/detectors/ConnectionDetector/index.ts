import * as path from 'path';
import { ServiceConnection } from '../../../../../../../core/ports/portRegistry';
import { ProjectStructure } from '../../types';
import { logger } from '../../../../../../../utils/logger';
import { detectFromAnnotations } from './parseEnvAnnotations';
import { detectFromTomlAnnotations } from './parseTomlAnnotations';
import { detectFromKnownPatterns } from './parseKnownPatterns';
import { enrichWithCompose } from './enrichCompose';
import { enrichInternalConnections } from './enrichAntProject';
import { formatDisplayName } from './utils';

/**
 * ConnectionDetector
 *
 * Orchestrates the multi-stage connection-discovery pipeline. The actual
 * parsing / enrichment / lookup logic lives in sibling modules; this class
 * exists so the public surface (`new ConnectionDetector().detect(...)`)
 * stays stable for legacy callers (PreviewService, PreviewServer).
 *
 * Detection flow (preserved from the pre-modularization implementation):
 *   1.  detectFromAnnotations      — `@connection` markers in `.env.example`
 *   1b. detectFromTomlAnnotations  — `@connection` markers in `config.example.toml`
 *   2.  detectFromKnownPatterns    — fallback; sets `missingAnnotation: true`
 *   3.  enrichWithCompose          — docker-compose.yml → `docker` resolution
 *   4.  enrichInternalConnections  — `self` + cross-project → proxy path
 *   5.  detect()                   — merge + dedup + id uniqueness pass
 *
 * Annotation grammar (resolution layer only — multi-token):
 *   `# @connection {category} {name} [resolution-token]`
 *
 * Resolution tokens (.env.example):
 *   (none)                                → url (default)
 *   self                                  → ant-project:self
 *   ant-project:{projectId}:{feature}     → cross-project
 *   ant-project:{p}:{f}:{serviceName}     → cross-project + service segment
 *
 * Service Virtualization is NOT a token. Every `business` connection is
 * virtualizable by definition (single-valued discriminator carries no
 * information) — `parseEnvAnnotations.ts::autoAttachVirtualization`
 * attaches `virtualization: { toggleEnvVar, active }` to every business
 * connection. Per-connection toggle (`USE_MOCK_<NAME>`) and master
 * fallback (`USE_MOCK`) live in the project `.env`.
 *
 * TOML grammar adds a REQUIRED `env:VAR_NAME` token that maps the dotted
 * TOML key onto the flat env var the platform injects.
 */
export class ConnectionDetector {
  /**
   * Unified detection: runs all stages and merges results.
   *
   * @param projectPath  Absolute path to project root
   * @param structure    Detected project structure (packages, type)
   * @param serverKey    `tenant:user:project:feature` for proxy path computation
   */
  detect(
    projectPath: string,
    structure: ProjectStructure,
    serverKey: string,
  ): ServiceConnection[] {
    const allConnections: ServiceConnection[] = [];

    const packageDirs = structure.packages.map(p => {
      const relative = path.relative(projectPath, p.path);
      return relative || undefined;
    });

    const dirsToScan = new Set<string | undefined>([undefined, ...packageDirs]);

    for (const subdir of dirsToScan) {
      const subdirDetected = new Set<string>();

      const annotated = detectFromAnnotations(projectPath, subdir);
      for (const conn of annotated) subdirDetected.add(conn.envVar);
      allConnections.push(...annotated);

      const tomlAnnotated = detectFromTomlAnnotations(projectPath, subdir);
      for (const conn of tomlAnnotated) subdirDetected.add(conn.envVar);
      allConnections.push(...tomlAnnotated);

      const fallback = detectFromKnownPatterns(projectPath, subdirDetected, subdir);
      allConnections.push(...fallback);
    }

    enrichWithCompose(allConnections, projectPath);
    enrichInternalConnections(allConnections, serverKey, structure);

    // Dedup by source:envVar (first wins). Different packages can legitimately
    // share an envVar name (e.g. DATABASE_URL appearing in two services).
    const seen = new Set<string>();
    const deduplicated: ServiceConnection[] = [];
    for (const conn of allConnections) {
      const dedupKey = `${conn.source}:${conn.envVar}`;
      if (!seen.has(dedupKey)) {
        seen.add(dedupKey);
        deduplicated.push(conn);
      }
    }

    // When annotated and fallback connections share the same id, drop the
    // fallback ones — annotated metadata always wins.
    const byId = new Map<string, ServiceConnection[]>();
    for (const conn of deduplicated) {
      const group = byId.get(conn.id) || [];
      group.push(conn);
      byId.set(conn.id, group);
    }
    const filtered: ServiceConnection[] = [];
    for (const [, group] of byId) {
      const annotated = group.filter(c => !c.missingAnnotation);
      filtered.push(...(annotated.length > 0 ? annotated : group));
    }

    // Ensure unique ids (suffix collisions with `<id>-<source>` then envVar
    // then `<id>-N`) so downstream UI / state never collapses two distinct
    // connections that happen to share the same `name` token.
    const idCounts = new Map<string, number>();
    for (const conn of filtered) {
      idCounts.set(conn.id, (idCounts.get(conn.id) || 0) + 1);
    }
    const usedIds = new Set<string>();
    for (const conn of filtered) {
      if ((idCounts.get(conn.id) || 0) > 1) {
        const source = conn.source === '*' ? 'root' : (conn.source || 'root');
        let candidateId = `${conn.id}-${source}`;
        if (usedIds.has(candidateId)) {
          candidateId = `${conn.id}-${conn.envVar.toLowerCase().replace(/_/g, '-')}`;
        }
        if (usedIds.has(candidateId)) {
          let n = 2;
          while (usedIds.has(`${conn.id}-${n}`)) n++;
          candidateId = `${conn.id}-${n}`;
        }
        conn.id = candidateId;
        conn.name = formatDisplayName(candidateId);
      }
      usedIds.add(conn.id);
    }

    logger.info(
      `[ConnectionDetector] Detected ${filtered.length} connections ` +
      `(${filtered.filter(c => c.missingAnnotation).length} via fallback, ` +
      `${deduplicated.length - filtered.length} filtered by annotation priority)`,
      { component: 'ConnectionDetector' },
    );

    return filtered;
  }
}
