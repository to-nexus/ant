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

export function GitHubStarsBadge({ variant = 'compact', className = '' }: GitHubStarsBadgeProps) {
  const stars = githubStats.stars;

  if (variant === 'full') {
    return (
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={`group inline-flex items-center gap-3 px-5 py-2.5 text-sm font-medium text-white bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl transition-all ${className}`}
      >
        <Github className="w-4 h-4" />
        <span>Star on GitHub</span>
        <span className="flex items-center gap-1 text-xs text-amber-300">
          <Star className="w-3.5 h-3.5 fill-amber-300" />
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
      className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-lg transition-colors ${className}`}
    >
      <Github className="w-3.5 h-3.5" />
      <span className="flex items-center gap-1">
        <Star className="w-3 h-3 text-amber-300 fill-amber-300" />
        {formatCount(stars)}
      </span>
    </a>
  );
}
