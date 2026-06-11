'use client';

import { Github, Star } from 'lucide-react';
import { GITHUB_URL } from '@/lib/links';
import { githubStats } from '@/lib/githubStats';

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

interface GitHubStarsBadgeProps {
  variant?: 'compact' | 'full';
  className?: string;
}

const surfaceStyle = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-1)',
  color: 'var(--text-1)',
} as const;

export function GitHubStarsBadge({ variant = 'compact', className = '' }: GitHubStarsBadgeProps) {
  const stars = githubStats.stars;

  if (variant === 'full') {
    return (
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={`group inline-flex items-center gap-3 px-5 rounded-xl transition-all hover:-translate-y-0.5 ${className}`}
        style={{ ...surfaceStyle, height: 44, fontSize: 14, fontWeight: 600 }}
      >
        <Github className="w-4 h-4" />
        <span>Star on GitHub</span>
        <span className="flex items-center gap-1" style={{ fontSize: 12, color: 'var(--amber-500)' }}>
          <Star className="w-3.5 h-3.5" style={{ fill: 'var(--amber-500)' }} />
          {formatCount(stars)}
        </span>
      </a>
    );
  }

  return (
    <a
      href={GITHUB_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-2 px-3 rounded-lg transition-colors ${className}`}
      style={{ ...surfaceStyle, height: 34, fontSize: 12, fontWeight: 500, color: 'var(--text-2)' }}
    >
      <Github className="w-3.5 h-3.5" />
      <span className="flex items-center gap-1">
        <Star className="w-3 h-3" style={{ color: 'var(--amber-500)', fill: 'var(--amber-500)' }} />
        {formatCount(stars)}
      </span>
    </a>
  );
}
