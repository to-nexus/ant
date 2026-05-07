'use client';

import { GITHUB_LICENSE_URL, LICENSE_NAME } from '@/lib/links';

interface LicenseBadgeProps {
  className?: string;
}

export function LicenseBadge({ className = '' }: LicenseBadgeProps) {
  return (
    <a
      href={GITHUB_LICENSE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono font-medium text-emerald-300 bg-emerald-950/40 hover:bg-emerald-950/60 border border-emerald-800/40 rounded-md transition-colors ${className}`}
    >
      <span className="text-emerald-500">©</span>
      {LICENSE_NAME}
    </a>
  );
}
