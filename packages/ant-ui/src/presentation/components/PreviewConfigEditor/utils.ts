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

export function generateFixMessage(conn: ServiceConnection): string {
  const source = conn.source && conn.source !== '*' ? conn.source + '/' : '';
  const lines: string[] = [`[Service Connection Fix: ${conn.name}]`, ''];
  let step = 1;

  if (conn.missingAnnotation) {
    let annotationSuffix = '';
    if (conn.resolution.type === 'ant-project') {
      const pid = conn.resolution.projectId;
      const feat = conn.resolution.feature;
      const svc = conn.resolution.serviceName;
      annotationSuffix = (pid === 'self' && feat === 'self')
        ? ' self'
        : ` ant-project:${pid}:${feat}${svc ? ':' + svc : ''}`;
    }
    lines.push(
      `${step}. ${source}.env.example 파일에서 ${conn.envVar} 위에 어노테이션을 추가해주세요:`,
      `   # @connection ${conn.category} ${conn.id}${annotationSuffix}`,
      `   ${conn.envVar}=${conn.value}`,
      '',
    );
    step++;
  }

  if (conn.userModified) {
    if (conn.resolution.type === 'url') {
      lines.push(
        `${step}. ${source}.env 파일에서 ${conn.envVar}의 값을 업데이트해주세요:`,
        `   ${conn.envVar}=${conn.value}`,
        '',
      );
      step++;
      lines.push(
        `${step}. ${source}.env.example 파일에서도 ${conn.envVar}의 기본값을 업데이트해주세요:`,
        `   ${conn.envVar}=${conn.value}`,
        '',
      );
      step++;
    } else if (conn.resolution.type === 'docker') {
      const service = conn.resolution.service;
      lines.push(
        `${step}. ${source}.env 파일에서 ${conn.envVar}의 값을 업데이트해주세요:`,
        `   ${conn.envVar}=${conn.value}`,
        '',
      );
      step++;
      lines.push(
        `${step}. ${source}.env.example 파일에서도 ${conn.envVar}의 기본값을 업데이트해주세요:`,
        `   ${conn.envVar}=${conn.value}`,
        '',
      );
      step++;
      lines.push(
        `${step}. docker-compose.yml에서 ${service} 서비스가 정의되어 있는지 확인해주세요.`,
        '',
      );
      step++;
    } else if (conn.resolution.type === 'ant-project') {
      const targetProject = conn.resolution.projectId;
      const targetFeature = conn.resolution.feature;
      const targetService = conn.resolution.serviceName;
      const isSelf = targetProject === 'self' && targetFeature === 'self';
      const annotationSuffix = isSelf
        ? ' self'
        : ` ant-project:${targetProject}:${targetFeature}${targetService ? ':' + targetService : ''}`;
      lines.push(
        `${step}. ${source}.env.example 파일에서 ${conn.envVar} 위에 어노테이션을 확인/추가해주세요:`,
        `   # @connection ${conn.category} ${conn.id}${annotationSuffix}`,
        `   ${conn.envVar}=(preview 시작 시 자동 주입)`,
        '',
      );
      step++;
      lines.push(
        `${step}. ${source}.env 파일에서 ${conn.envVar}가 있는지 확인해주세요 (값은 preview 시작 시 자동 설정됩니다).`,
        '',
      );
      step++;
      if (!isSelf) {
        lines.push(
          `참고: 참조 대상 프로젝트(${targetProject}/${targetFeature})의 설정은 해당 프로젝트에서 관리됩니다.`,
          '',
        );
      }
    }
  }

  return lines.join('\n');
}
