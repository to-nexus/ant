import Convert from 'ansi-to-html';
import type { ServiceConnection } from '@/infrastructure/http/api';

export const ansiConverter = new Convert({
  fg: '#d4d4d4',
  bg: 'transparent',
  newline: false,
  escapeXML: true,
});

export function getResolutionLabel(conn: ServiceConnection): string {
  if (conn.resolution.type === 'docker') {
    return `docker://${conn.resolution.service}${conn.resolution.port ? ':' + conn.resolution.port : ''}`;
  }
  if (conn.resolution.type === 'ant-project') {
    const pid = conn.resolution.projectId === 'self' ? 'self' : conn.resolution.projectId;
    const feat = conn.resolution.feature === 'self' ? 'self' : conn.resolution.feature;
    const svc = conn.resolution.serviceName;
    return svc ? `ant://${pid}/${feat}/${svc}` : `ant://${pid}/${feat}`;
  }
  if (conn.resolution.type === 'url') {
    return conn.value || conn.resolution.url || '';
  }
  return conn.value || '';
}
