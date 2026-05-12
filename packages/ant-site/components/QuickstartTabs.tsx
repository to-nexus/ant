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
    <section id="quickstart" className="py-16 sm:py-24">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-white mb-3">{title}</h2>
          {description && <p className="text-sm text-gray-400">{description}</p>}
        </div>

        <div className="rounded-2xl bg-[#0d1117] border border-white/10 overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 px-2">
            <div className="flex">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActive(tab.id)}
                  className={`px-4 py-3 text-xs font-mono font-medium transition-colors ${
                    active === tab.id
                      ? 'text-emerald-400 border-b-2 border-emerald-400'
                      : 'text-gray-500 hover:text-gray-300 border-b-2 border-transparent'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              onClick={onCopy}
              className="mr-2 inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-400 hover:text-white hover:bg-white/5 rounded-md transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="px-5 py-4 text-sm text-gray-200 font-mono overflow-x-auto leading-relaxed">
            <span className="text-gray-500 select-none">$ </span>
            {current.command}
          </pre>
        </div>
      </div>
    </section>
  );
}
