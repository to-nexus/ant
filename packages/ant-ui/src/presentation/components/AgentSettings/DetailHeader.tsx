/**
 * Detail header — breadcrumb (Agent › Job › Intent, ancestors clickable) +
 * level badge + status pills. The single visual anchor that tells agent, job,
 * and intent detail pages apart.
 */

import { useTranslation } from 'react-i18next';
import { Bot, Briefcase, Target } from 'lucide-react';
import { Badge, type BadgeTone } from '@/presentation/components/aurora';

export type DetailLevel = 'agent' | 'job' | 'intent';

const LEVEL_TONE: Record<DetailLevel, BadgeTone> = {
  agent: 'brand',
  job: 'info',
  intent: 'success',
};

function Crumb({
  icon: Icon,
  label,
  current,
  mono,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  current: boolean;
  mono?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <span
      className="inline-flex items-center gap-1.5"
      style={{
        fontSize: 13,
        fontFamily: mono ? 'var(--font-mono)' : undefined,
        fontWeight: current ? 600 : 400,
        color: current ? 'var(--text-1)' : 'var(--text-2)',
      }}
    >
      <Icon size={14} style={{ color: current ? 'var(--text-2)' : 'var(--text-3)' }} />
      {label}
    </span>
  );
  if (current || !onClick) return content;
  return (
    <button type="button" onClick={onClick} className="hover:underline underline-offset-2">
      {content}
    </button>
  );
}

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
          <span style={{ color: 'var(--text-4)', fontSize: 13 }}>›</span>
          <Crumb icon={Briefcase} label={jobName} current={level === 'job'} onClick={onSelectJob} />
        </>
      )}
      {intentId != null && (
        <>
          <span style={{ color: 'var(--text-4)', fontSize: 13 }}>›</span>
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
