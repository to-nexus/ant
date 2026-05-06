import * as fs from 'fs';
import * as path from 'path';
import { ServiceConnection } from '../../../../../../../core/ports/portRegistry';
import { formatDisplayName, overrideWithEnvFile, parseEnvLine } from './utils';

/**
 * Well-known env var patterns used as a fallback when `.env.example`
 * lacks `@connection` annotations. Connections produced from these
 * patterns carry `missingAnnotation: true` so the self-heal layer can
 * prompt the LLM to add the missing annotation.
 */
const KNOWN_INFRA_PATTERNS: Array<{ pattern: RegExp; nameHint: string }> = [
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

const KNOWN_BUSINESS_PATTERNS: Array<{ pattern: RegExp; nameHint: string }> = [
  { pattern: /^(?:VITE_)?API_(?:BASE_)?URL$/i, nameHint: 'api' },
  { pattern: /_SERVICE_URL$/i, nameHint: 'service' },
  { pattern: /^AUTH_(?:SERVICE_)?URL$/i, nameHint: 'auth' },
];

/**
 * Fallback detection: match well-known env var patterns that are not yet
 * covered by an `@connection` annotation. Output connections are flagged
 * with `missingAnnotation: true` so the LLM self-heal pass can promote
 * them to annotated entries.
 */
export function detectFromKnownPatterns(
  projectPath: string,
  alreadyDetected: Set<string>,
  subdir?: string,
): ServiceConnection[] {
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

    const [envVar, value] = parseEnvLine(trimmed);
    if (!envVar || alreadyDetected.has(envVar)) continue;

    let matched = false;

    for (const { pattern, nameHint } of KNOWN_INFRA_PATTERNS) {
      if (pattern.test(envVar)) {
        connections.push({
          id: nameHint,
          name: formatDisplayName(nameHint),
          category: 'infrastructure',
          envVar,
          value: value || '',
          resolution: { type: 'url', url: value || '' },
          source: subdir || '*',
          missingAnnotation: true,
        });
        alreadyDetected.add(envVar);
        matched = true;
        break;
      }
    }

    if (matched) continue;

    for (const { pattern, nameHint } of KNOWN_BUSINESS_PATTERNS) {
      if (pattern.test(envVar) && !alreadyDetected.has(envVar)) {
        connections.push({
          id: `${nameHint}-${envVar.toLowerCase().replace(/_/g, '-')}`,
          name: formatDisplayName(nameHint),
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

  overrideWithEnvFile(connections, projectPath, subdir);

  return connections;
}
