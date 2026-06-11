'use client';

import { GitMerge, AlertCircle, ExternalLink } from 'lucide-react';
import type { ActivityItem } from '@/lib/githubStats';
import { githubStats } from '@/lib/githubStats';

interface RecentActivityProps {
  prTitle: string;
  issueTitle: string;
  emptyLabel: string;
}

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return '1d';
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

function ActivityRow({ icon, item }: { icon: 'pr' | 'issue'; item: ActivityItem }) {
  const Icon = icon === 'pr' ? GitMerge : AlertCircle;
  const color = icon === 'pr' ? 'var(--emerald-500)' : 'var(--orange-400)';
  const ts = item.mergedAt ?? item.createdAt;

  return (
    <a
      href={item.htmlUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start gap-3 p-3 rounded-lg transition-colors hover:bg-[var(--bg-surface)]"
    >
      <Icon className="w-4 h-4 shrink-0 mt-0.5" style={{ color }} />
      <div className="flex-1 min-w-0">
        <p className="truncate" style={{ fontSize: 14, color: 'var(--text-2)' }}>{item.title}</p>
        <div className="mt-1 flex items-center gap-2" style={{ fontSize: 12, color: 'var(--text-4)' }}>
          <span>#{item.number}</span>
          <span>·</span>
          <span>{item.author}</span>
          {ts && (
            <>
              <span>·</span>
              <span>{timeAgo(ts)}</span>
            </>
          )}
        </div>
      </div>
      <ExternalLink className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: 'var(--text-4)' }} />
    </a>
  );
}

function Column({ title, items, icon, emptyLabel }: { title: string; items: ActivityItem[]; icon: 'pr' | 'issue'; emptyLabel: string }) {
  return (
    <div>
      <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', marginBottom: 12 }}>{title}</h3>
      {items.length === 0 ? (
        <p style={{ fontSize: 14, color: 'var(--text-4)', padding: '8px 12px' }}>{emptyLabel}</p>
      ) : (
        <div className="space-y-1">
          {items.map((item) => (
            <ActivityRow key={item.htmlUrl} icon={icon} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

export function RecentActivity({ prTitle, issueTitle, emptyLabel }: RecentActivityProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <Column title={prTitle} items={githubStats.recentPRs} icon="pr" emptyLabel={emptyLabel} />
      <Column title={issueTitle} items={githubStats.recentIssues} icon="issue" emptyLabel={emptyLabel} />
    </div>
  );
}
