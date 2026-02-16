import * as fs from 'fs';
import * as path from 'path';
import { ServiceConnection, ServiceCategory, ConnectionResolution } from '../../../../../../core/ports/portRegistry';
import { ProjectStructure } from '../types';
import { toUrlKey } from '../utils/serverKeyUtils';
import { logger } from '../../../../../../utils/logger';

/**
 * ConnectionDetector
 * 
 * Detects service connections from project files and constructs ServiceConnection[].
 * 
 * Detection flow:
 *   1. detectFromAnnotations()       -- @connection markers in .env.example (primary)
 *   2. detectFromKnownPatterns()     -- legacy fallback, sets missingAnnotation=true
 *   3. enrichWithCompose()           -- docker-compose.yml -> resolution upgrade
 *   4. enrichInternalConnections()   -- resolve `self` markers → ant-project with proxy path
 *   5. detect()                      -- merge + deduplicate (key: source:envVar)
 * 
 * Annotation format:
 *   # @connection {category} {name}                                → url resolution (default)
 *   # @connection {category} {name} self                           → ant-project:self (same-project internal)
 *   # @connection {category} {name} ant-project:{projectId}:{feature} → ant-project cross-project
 * 
 * Resolution type constraints (enforced at API layer):
 *   infrastructure → url | docker
 *   business       → url | ant-project
 */
export class ConnectionDetector {

  // Well-known infrastructure env var patterns (fallback only)
  private static readonly KNOWN_INFRA_PATTERNS: Array<{ pattern: RegExp; nameHint: string }> = [
    { pattern: /^DATABASE_URL$/i, nameHint: 'database' },
    { pattern: /^POSTGRES_URL$/i, nameHint: 'postgres' },
    { pattern: /^MYSQL_URL$/i, nameHint: 'mysql' },
    { pattern: /^MONGODB_URI$/i, nameHint: 'mongodb' },
    { pattern: /^MONGO_URL$/i, nameHint: 'mongodb' },
    { pattern: /^REDIS_URL$/i, nameHint: 'redis' },
    { pattern: /^REDIS_HOST$/i, nameHint: 'redis' },
    { pattern: /^AMQP_URL$/i, nameHint: 'rabbitmq' },
    { pattern: /^RABBITMQ_URL$/i, nameHint: 'rabbitmq' },
    { pattern: /^KAFKA_BROKERS?$/i, nameHint: 'kafka' },
    { pattern: /^ELASTICSEARCH_URL$/i, nameHint: 'elasticsearch' },
    { pattern: /^MEILISEARCH_URL$/i, nameHint: 'meilisearch' },
  ];

  private static readonly KNOWN_BUSINESS_PATTERNS: Array<{ pattern: RegExp; nameHint: string }> = [
    { pattern: /^(?:VITE_)?API_(?:BASE_)?URL$/i, nameHint: 'api' },
    { pattern: /_SERVICE_URL$/i, nameHint: 'service' },
    { pattern: /^AUTH_(?:SERVICE_)?URL$/i, nameHint: 'auth' },
  ];

  /**
   * Primary detection: parse @connection annotations from .env.example
   * 
   * Format:
   *   # @connection {category} {name}                                → url resolution
   *   # @connection {category} {name} self                           → ant-project:self (same-project)
   *   # @connection {category} {name} ant-project:{projectId}:{feature} → ant-project cross-project
   *   ENV_VAR=default_value
   */
  detectFromAnnotations(projectPath: string, subdir?: string): ServiceConnection[] {
    const connections: ServiceConnection[] = [];
    const envExamplePath = subdir
      ? path.join(projectPath, subdir, '.env.example')
      : path.join(projectPath, '.env.example');

    if (!fs.existsSync(envExamplePath)) {
      return connections;
    }

    const content = fs.readFileSync(envExamplePath, 'utf-8');
    const lines = content.split('\n');

    const annotationRegex = /^#\s*@connection\s+(business|infrastructure)\s+(\S+)(?:\s+(.+))?/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].trim().match(annotationRegex);
      if (!match) continue;

      const category = match[1] as ServiceCategory;
      const name = match[2];
      const modifier = match[3]?.trim();

      // Next non-empty, non-comment line should be KEY=VALUE
      const nextLine = this.findNextEnvLine(lines, i + 1);
      if (!nextLine) continue;

      const [envVar, value] = this.parseEnvLine(nextLine);
      if (!envVar) continue;

      const resolution: ConnectionResolution = this.parseResolutionModifier(modifier, value || '');

      connections.push({
        id: name,
        name: this.formatDisplayName(name),
        category,
        envVar,
        value: value || '',
        resolution,
        source: subdir || '*',
      });
    }

    // Override with actual .env values if present (only for url resolution)
    this.overrideWithEnvFile(connections, projectPath, subdir);

    return connections;
  }

  /**
   * Fallback detection: match well-known env var patterns.
   * Sets missingAnnotation=true for self-healing.
   */
  detectFromKnownPatterns(projectPath: string, alreadyDetected: Set<string>, subdir?: string): ServiceConnection[] {
    const connections: ServiceConnection[] = [];
    const envExamplePath = subdir
      ? path.join(projectPath, subdir, '.env.example')
      : path.join(projectPath, '.env.example');

    if (!fs.existsSync(envExamplePath)) {
      return connections;
    }

    const content = fs.readFileSync(envExamplePath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const [envVar, value] = this.parseEnvLine(trimmed);
      if (!envVar || alreadyDetected.has(envVar)) continue;

      // Check infrastructure patterns
      for (const { pattern, nameHint } of ConnectionDetector.KNOWN_INFRA_PATTERNS) {
        if (pattern.test(envVar)) {
          connections.push({
            id: nameHint,
            name: this.formatDisplayName(nameHint),
            category: 'infrastructure',
            envVar,
            value: value || '',
            resolution: { type: 'url', url: value || '' },
            source: subdir || '*',
            missingAnnotation: true,
          });
          alreadyDetected.add(envVar);
          break;
        }
      }

      // Check business patterns
      for (const { pattern, nameHint } of ConnectionDetector.KNOWN_BUSINESS_PATTERNS) {
        if (pattern.test(envVar) && !alreadyDetected.has(envVar)) {
          connections.push({
            id: `${nameHint}-${envVar.toLowerCase().replace(/_/g, '-')}`,
            name: this.formatDisplayName(nameHint),
            category: 'business',
            envVar,
            value: value || '',
            resolution: { type: 'url', url: value || '' },
            source: subdir || '*',
            missingAnnotation: true,
          });
          alreadyDetected.add(envVar);
          break;
        }
      }
    }

    // Override with actual .env values
    this.overrideWithEnvFile(connections, projectPath, subdir);

    return connections;
  }

  /**
   * Enrich connections with docker-compose service info.
   * Upgrades resolution to 'docker' when a matching compose service is found.
   */
  enrichWithCompose(connections: ServiceConnection[], projectPath: string): ServiceConnection[] {
    const composeServices = this.parseComposeServices(projectPath);
    if (!composeServices.length) return connections;

    for (const conn of connections) {
      if (conn.category !== 'infrastructure') continue;

      // Try to match by name or by port in the value
      const matching = composeServices.find(svc =>
        conn.id.includes(svc.name) ||
        svc.name.includes(conn.id) ||
        (svc.image && conn.id.includes(svc.image.split(':')[0]))
      );

      if (matching) {
        conn.resolution = {
          type: 'docker',
          service: matching.name,
          port: matching.port,
        };
      }
    }

    return connections;
  }

  /**
   * Resolve `self` markers in ant-project connections.
   * Replaces placeholder projectId/feature with actual values and computes proxy path.
   */
  private enrichInternalConnections(connections: ServiceConnection[], serverKey: string): void {
    const urlKeyValue = `/${toUrlKey(serverKey)}`;
    const parts = serverKey.split(':');
    const projectId = parts[2] || '';
    const feature = parts[3] || '';

    for (const conn of connections) {
      if (
        conn.resolution.type === 'ant-project' &&
        conn.resolution.projectId === 'self' &&
        conn.resolution.feature === 'self'
      ) {
        conn.resolution = {
          type: 'ant-project',
          projectId,
          feature,
          resolvedUrlKey: toUrlKey(serverKey),
        };
        conn.value = urlKeyValue;
      }
    }
  }

  /**
   * Unified detection: runs all stages and merges results.
   * 
   * @param projectPath  Absolute path to project root
   * @param structure    Detected project structure (packages, type)
   * @param serverKey    Server key (tenant:user:project:feature) for proxy path computation
   */
  detect(
    projectPath: string,
    structure: ProjectStructure,
    serverKey: string,
  ): ServiceConnection[] {
    const allConnections: ServiceConnection[] = [];

    // For each package directory (or root if single package)
    const packageDirs = structure.packages.map(p => {
      const relative = path.relative(projectPath, p.path);
      return relative || undefined;
    });

    // Also check root
    const dirsToScan = new Set<string | undefined>([undefined, ...packageDirs]);

    for (const subdir of dirsToScan) {
      // Per-subdir tracking: prevents fallback from re-detecting annotated vars within same package
      const subdirDetected = new Set<string>();

      // 1. Annotation-based detection (primary)
      const annotated = this.detectFromAnnotations(projectPath, subdir);
      for (const conn of annotated) {
        subdirDetected.add(conn.envVar);
      }
      allConnections.push(...annotated);

      // 2. Known patterns fallback
      const fallback = this.detectFromKnownPatterns(projectPath, subdirDetected, subdir);
      allConnections.push(...fallback);
    }

    // 3. Enrich with docker-compose
    this.enrichWithCompose(allConnections, projectPath);

    // 4. Resolve `self` markers → ant-project with actual project context + proxy path
    this.enrichInternalConnections(allConnections, serverKey);

    // 5. Deduplicate by source:envVar (first wins)
    // Different packages can legitimately have the same envVar name (e.g. DATABASE_URL)
    const seen = new Set<string>();
    const deduplicated: ServiceConnection[] = [];
    for (const conn of allConnections) {
      const dedupKey = `${conn.source}:${conn.envVar}`;
      if (!seen.has(dedupKey)) {
        seen.add(dedupKey);
        deduplicated.push(conn);
      }
    }

    logger.info(`[ConnectionDetector] Detected ${deduplicated.length} connections (${deduplicated.filter(c => c.missingAnnotation).length} via fallback)`, { component: 'ConnectionDetector' });

    return deduplicated;
  }

  // ========================================
  // Private helpers
  // ========================================

  /**
   * Parse the annotation modifier into a ConnectionResolution.
   *   undefined / empty  → url
   *   "self"             → ant-project with self/self
   *   "ant-project:{projectId}:{feature}" → ant-project with explicit target
   */
  private parseResolutionModifier(modifier: string | undefined, defaultValue: string): ConnectionResolution {
    if (!modifier) {
      return { type: 'url', url: defaultValue };
    }

    if (modifier === 'self') {
      return { type: 'ant-project', projectId: 'self', feature: 'self' };
    }

    const antProjectMatch = modifier.match(/^ant-project:([^:]+):(.+)$/);
    if (antProjectMatch) {
      return {
        type: 'ant-project',
        projectId: antProjectMatch[1],
        feature: antProjectMatch[2],
      };
    }

    // Unknown modifier — treat as url
    return { type: 'url', url: defaultValue };
  }

  private findNextEnvLine(lines: string[], startIndex: number): string | null {
    for (let i = startIndex; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      return trimmed;
    }
    return null;
  }

  private parseEnvLine(line: string): [string, string] | [null, null] {
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) return [null, null];
    const key = line.substring(0, eqIndex).trim();
    let value = line.substring(eqIndex + 1).trim();
    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return [key, value];
  }

  private overrideWithEnvFile(connections: ServiceConnection[], projectPath: string, subdir?: string): void {
    const envPath = subdir
      ? path.join(projectPath, subdir, '.env')
      : path.join(projectPath, '.env');

    if (!fs.existsSync(envPath)) return;

    const content = fs.readFileSync(envPath, 'utf-8');
    const envMap = new Map<string, string>();

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, value] = this.parseEnvLine(trimmed);
      if (key) envMap.set(key, value);
    }

    for (const conn of connections) {
      const actualValue = envMap.get(conn.envVar);
      if (actualValue !== undefined) {
        conn.value = actualValue;
        if (conn.resolution.type === 'url') {
          conn.resolution = { type: 'url', url: actualValue };
        }
      }
    }
  }

  private parseComposeServices(projectPath: string): Array<{ name: string; image?: string; port?: number }> {
    const composeFiles = [
      'docker-compose.yml',
      'docker-compose.yaml',
      'compose.yml',
      'compose.yaml',
    ];

    let composePath: string | null = null;
    for (const f of composeFiles) {
      const candidate = path.join(projectPath, f);
      if (fs.existsSync(candidate)) {
        composePath = candidate;
        break;
      }
    }

    if (!composePath) return [];

    try {
      const content = fs.readFileSync(composePath, 'utf-8');
      return this.parseComposeYaml(content);
    } catch (err) {
      logger.warn(`[ConnectionDetector] Failed to parse compose file: ${err}`, { component: 'ConnectionDetector' });
      return [];
    }
  }

  /**
   * Lightweight YAML parser for docker-compose services.
   * Only extracts service names, images, and port mappings.
   * No external YAML dependency required.
   */
  private parseComposeYaml(content: string): Array<{ name: string; image?: string; port?: number }> {
    const services: Array<{ name: string; image?: string; port?: number }> = [];
    const lines = content.split('\n');
    let inServices = false;
    let currentService: string | null = null;
    let serviceIndent = 0;
    let currentImage: string | undefined;
    let currentPort: number | undefined;

    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const indent = line.length - line.trimStart().length;

      // Detect 'services:' section
      if (/^services:\s*$/.test(trimmed)) {
        inServices = true;
        continue;
      }

      if (!inServices) continue;

      // Top-level key outside services ends the section
      if (indent === 0 && !trimmed.startsWith(' ') && !trimmed.startsWith('-')) {
        inServices = false;
        if (currentService) {
          services.push({ name: currentService, image: currentImage, port: currentPort });
        }
        break;
      }

      // Service name (indent level 2 typically)
      if (indent === 2 && trimmed.endsWith(':') && !trimmed.startsWith('-')) {
        // Save previous service
        if (currentService) {
          services.push({ name: currentService, image: currentImage, port: currentPort });
        }
        currentService = trimmed.replace(':', '').trim();
        serviceIndent = indent;
        currentImage = undefined;
        currentPort = undefined;
        continue;
      }

      if (!currentService) continue;

      // image: field
      const imageMatch = trimmed.match(/^\s*image:\s*["']?([^"'\s]+)/);
      if (imageMatch) {
        currentImage = imageMatch[1];
        continue;
      }

      // ports: inline or next lines
      const portMatch = trimmed.match(/["']?(\d+):(\d+)["']?/);
      if (portMatch && !currentPort) {
        currentPort = parseInt(portMatch[1], 10); // host port
        continue;
      }
    }

    // Last service
    if (currentService) {
      services.push({ name: currentService, image: currentImage, port: currentPort });
    }

    return services;
  }

  private formatDisplayName(name: string): string {
    return name
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
