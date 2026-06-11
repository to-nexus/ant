'use client';

import { githubStats } from '@/lib/githubStats';
import { GITHUB_URL } from '@/lib/links';

interface ContributorsWallProps {
  title: string;
  emptyLabel: string;
  limit?: number;
}

export function ContributorsWall({ title, emptyLabel, limit = 40 }: ContributorsWallProps) {
  const visible = githubStats.contributors.slice(0, limit);
  const total = githubStats.contributorsCount;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-5">
        <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-1)' }}>{title}</h3>
        {total > 0 && <span style={{ fontSize: 14, color: 'var(--text-4)' }}>{total}</span>}
      </div>

      {visible.length === 0 ? (
        <p style={{ fontSize: 14, color: 'var(--text-4)' }}>{emptyLabel}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {visible.map((c) => (
              <a
                key={c.login}
                href={c.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={`${c.login} (${c.contributions} commits)`}
                className="block w-10 h-10 rounded-full overflow-hidden transition-colors"
                style={{ border: '1px solid var(--border-1)' }}
              >
                <img src={c.avatarUrl} alt={c.login} className="w-full h-full object-cover" loading="lazy" />
              </a>
            ))}
          </div>
          {total > limit && (
            <a
              href={`${GITHUB_URL}/graphs/contributors`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block transition-colors"
              style={{ fontSize: 14, color: 'var(--violet-300)' }}
            >
              + {total - limit} more →
            </a>
          )}
        </>
      )}
    </div>
  );
}
