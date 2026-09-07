/**
 * Detail header — breadcrumb (Agent › Job › Intent, ancestors clickable) +
 * level badge + status pills. The single visual anchor that tells agent, job,
 * and intent detail pages apart.
 */

import { useTranslation } from 'react-i18next';
import { Bot, Briefcase, Target } from 'lucide-react';
import { Badge, type BadgeTone } from '@/presentation/components/aurora';
import { Crumb, CRUMB_SEPARATOR } from '@/presentation/components/shared/Crumb';

export type DetailLevel = 'agent' | 'job' | 'intent';

const LEVEL_TONE: Record<DetailLevel, BadgeTone> = {
  agent: 'brand',
  job: 'info',
  intent: 'success',
};

export function DetailHeader({
  level,
  agentName,
  jobName,
  intentId,
  onSelectAgent,
  onSelectJob,
  status,
}: {
  level: DetailLevel;
  agentName: string;
  jobName?: string;
  intentId?: string;
  onSelectAgent: () => void;
  onSelectJob: () => void;
  status?: React.ReactNode;
}) {
  const { t } = useTranslation('agents');
  const levelLabel = {
    agent: t('detail.levelAgent', 'Agent'),
    job: t('detail.levelJob', 'Job'),
    intent: t('detail.levelIntent', 'Intent'),
  }[level];

  return (
    <div className="flex items-center gap-2 flex-wrap" style={{ padding: '2px 2px 6px' }}>
      <Crumb icon={Bot} label={agentName} current={level === 'agent'} onClick={onSelectAgent} />
      {jobName != null && (
        <>
          {CRUMB_SEPARATOR}
          <Crumb icon={Briefcase} label={jobName} current={level === 'job'} onClick={onSelectJob} />
        </>
      )}
      {intentId != null && (
        <>
          {CRUMB_SEPARATOR}
          <Crumb icon={Target} label={intentId} current mono />
        </>
      )}
      <Badge tone={LEVEL_TONE[level]} size="sm">
        {levelLabel}
      </Badge>
      {status}
    </div>
  );
}
