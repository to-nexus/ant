import * as fs from 'fs';
import * as path from 'path';
import { ServiceConnection } from '../../../../../../../core/ports/portRegistry';
import { logger } from '../../../../../../../utils/logger';

const COMPOSE_FILES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
];

/**
 * Upgrade `infrastructure` connections from `url` to `docker` resolution
 * when a matching service is declared in the project's docker-compose
 * file. Match rule: connection id ⇔ service name (substring either way),
 * or service image base name appears in the connection id.
 */
export function enrichWithCompose(connections: ServiceConnection[], projectPath: string): ServiceConnection[] {
  const composeServices = parseComposeServices(projectPath);
  if (!composeServices.length) return connections;

  for (const conn of connections) {
    if (conn.category !== 'infrastructure') continue;

    const matching = composeServices.find(svc =>
      conn.id.includes(svc.name) ||
      svc.name.includes(conn.id) ||
      (svc.image && conn.id.includes(svc.image.split(':')[0])),
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

function parseComposeServices(projectPath: string): Array<{ name: string; image?: string; port?: number }> {
  let composePath: string | null = null;
  for (const f of COMPOSE_FILES) {
    const candidate = path.join(projectPath, f);
    if (fs.existsSync(candidate)) {
      composePath = candidate;
      break;
    }
  }

  if (!composePath) return [];

  try {
    const content = fs.readFileSync(composePath, 'utf-8');
    return parseComposeYaml(content);
  } catch (err) {
    logger.warn(`[ConnectionDetector] Failed to parse compose file: ${err}`, { component: 'ConnectionDetector' });
    return [];
  }
}

/**
 * Lightweight YAML parser for docker-compose `services:` block.
 * Extracts service names, images, and host port from the first port mapping.
 * No external YAML dependency required — full YAML parsing isn't needed
 * for connection enrichment.
 */
function parseComposeYaml(content: string): Array<{ name: string; image?: string; port?: number }> {
  const services: Array<{ name: string; image?: string; port?: number }> = [];
  const lines = content.split('\n');
  let inServices = false;
  let currentService: string | null = null;
  let currentImage: string | undefined;
  let currentPort: number | undefined;

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;

    if (/^services:\s*$/.test(trimmed)) {
      inServices = true;
      continue;
    }

    if (!inServices) continue;

    if (indent === 0 && !trimmed.startsWith(' ') && !trimmed.startsWith('-')) {
      inServices = false;
      if (currentService) {
        services.push({ name: currentService, image: currentImage, port: currentPort });
      }
      break;
    }

    if (indent === 2 && trimmed.endsWith(':') && !trimmed.startsWith('-')) {
      if (currentService) {
        services.push({ name: currentService, image: currentImage, port: currentPort });
      }
      currentService = trimmed.replace(':', '').trim();
      currentImage = undefined;
      currentPort = undefined;
      continue;
    }

    if (!currentService) continue;

    const imageMatch = trimmed.match(/^\s*image:\s*["']?([^"'\s]+)/);
    if (imageMatch) {
      currentImage = imageMatch[1];
      continue;
    }

    const portMatch = trimmed.match(/["']?(\d+):(\d+)["']?/);
    if (portMatch && !currentPort) {
      currentPort = parseInt(portMatch[1], 10);
      continue;
    }
  }

  if (currentService) {
    services.push({ name: currentService, image: currentImage, port: currentPort });
  }

  return services;
}
