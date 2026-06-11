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
      className={`text-mono inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md transition-colors ${className}`}
      style={{
        fontSize: 10,
        fontWeight: 500,
        color: 'var(--violet-300)',
        background: 'oklch(26% 0.09 290)',
        border: '1px solid oklch(40% 0.10 290 / 0.6)',
      }}
    >
      <span style={{ color: 'var(--violet-400)' }}>©</span>
      {LICENSE_NAME}
    </a>
  );
}
