'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface Tab {
  id: string;
  label: string;
  command: string;
}

const TABS: Tab[] = [
  { id: 'pnpm', label: 'pnpm', command: 'git clone https://github.com/to-nexus/ant && cd ant && pnpm install && pnpm dev:infra && pnpm dev:all' },
  { id: 'npm', label: 'npm', command: 'git clone https://github.com/to-nexus/ant && cd ant && npm install && npm run dev:infra && npm run dev:all' },
  { id: 'docker', label: 'docker', command: 'git clone https://github.com/to-nexus/ant && cd ant && docker compose up -d' },
];

interface QuickstartTabsProps {
  title: string;
  description?: string;
}

export function QuickstartTabs({ title, description }: QuickstartTabsProps) {
  const [active, setActive] = useState<string>('pnpm');
  const [copied, setCopied] = useState(false);

  const current = TABS.find((tab) => tab.id === active) ?? TABS[0];

  const onCopy = async () => {
    await navigator.clipboard.writeText(current.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
      {(title || description) && (
        <div className="text-center mb-8">
          <h2 className="text-display" style={{ fontSize: 'clamp(24px, 3.5vw, 30px)', color: 'var(--text-1)', marginBottom: 10 }}>
            {title}
          </h2>
          {description && <p style={{ fontSize: 15, color: 'var(--text-3)' }}>{description}</p>}
        </div>
      )}

      <div
        style={{
          borderRadius: 'var(--r-2xl)',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-1)',
          boxShadow: 'var(--shadow-md)',
          overflow: 'hidden',
        }}
      >
        <div
          className="flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--border-1)', padding: '0 8px' }}
        >
          <div className="flex">
            {TABS.map((tab) => {
              const isActive = active === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActive(tab.id)}
                  className="text-mono"
                  style={{
                    padding: '12px 16px',
                    fontSize: 12,
                    fontWeight: 600,
                    color: isActive ? 'var(--violet-300)' : 'var(--text-4)',
                    borderBottom: isActive ? '2px solid var(--violet-400)' : '2px solid transparent',
                    background: 'transparent',
                    transition: 'color var(--dur-fast) var(--ease-smooth)',
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          <button
            onClick={onCopy}
            className="inline-flex items-center gap-1.5"
            style={{
              marginRight: 8,
              padding: '5px 10px',
              fontSize: 12,
              color: copied ? 'var(--violet-300)' : 'var(--text-3)',
              background: 'transparent',
              borderRadius: 'var(--r-sm)',
            }}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre
          className="text-mono"
          style={{
            padding: '18px 20px',
            fontSize: 13.5,
            color: 'var(--text-2)',
            overflowX: 'auto',
            lineHeight: 'var(--lh-relaxed)',
            margin: 0,
          }}
        >
          <span style={{ color: 'var(--text-4)', userSelect: 'none' }}>$ </span>
          {current.command}
        </pre>
      </div>
    </div>
  );
}
