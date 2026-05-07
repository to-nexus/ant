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
  const color = icon === 'pr' ? 'text-emerald-400' : 'text-amber-400';
  const ts = item.mergedAt ?? item.createdAt;

  return (
    <a
      href={item.htmlUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start gap-3 p-3 rounded-lg hover:bg-white/[0.03] transition-colors"
    >
      <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${color}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-300 group-hover:text-white truncate">{item.title}</p>
        <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
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
      <ExternalLink className="w-3.5 h-3.5 text-gray-600 group-hover:text-gray-400 shrink-0 mt-0.5" />
    </a>
  );
}

function Column({ title, items, icon, emptyLabel }: { title: string; items: ActivityItem[]; icon: 'pr' | 'issue'; emptyLabel: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-300 mb-3">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500 px-3 py-2">{emptyLabel}</p>
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
