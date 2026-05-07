'use client';

import { Check, Minus } from 'lucide-react';

const COMPETITORS = ['ANT', 'Cursor', 'Claude Code', 'Bolt / v0'] as const;

type Competitor = (typeof COMPETITORS)[number];
type Cell = boolean | string;

interface Row {
  axisKey: string;
  values: Record<Competitor, Cell>;
}

const ROWS: Row[] = [
  {
    axisKey: 'multiAgent',
    values: { ANT: true, Cursor: false, 'Claude Code': false, 'Bolt / v0': false },
  },
  {
    axisKey: 'selfHost',
    values: { ANT: true, Cursor: false, 'Claude Code': false, 'Bolt / v0': false },
  },
  {
    axisKey: 'ossLicense',
    values: { ANT: 'Apache-2.0', Cursor: '—', 'Claude Code': '—', 'Bolt / v0': '—' },
  },
  {
    axisKey: 'figma',
    values: { ANT: 'native MCP', Cursor: '—', 'Claude Code': '—', 'Bolt / v0': 'preview' },
  },
  {
    axisKey: 'parallelTasks',
    values: { ANT: true, Cursor: false, 'Claude Code': false, 'Bolt / v0': false },
  },
];

function CellView({ value }: { value: Cell }) {
  if (typeof value === 'boolean') {
    return value ? <Check className="w-4 h-4 text-emerald-400 mx-auto" /> : <Minus className="w-4 h-4 text-gray-700 mx-auto" />;
  }
  if (value === '—') return <span className="text-gray-700 text-sm">—</span>;
  return <span className="text-xs font-medium text-emerald-300">{value}</span>;
}

interface ComparisonRowProps {
  title: string;
  description?: string;
  axisLabels: Record<string, string>;
}

export function ComparisonRow({ title, description, axisLabels }: ComparisonRowProps) {
  return (
    <section className="py-20 sm:py-24">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-white mb-3">{title}</h2>
          {description && <p className="text-sm text-gray-400 max-w-xl mx-auto">{description}</p>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10">
                <th className="py-4 pr-4 text-sm font-semibold text-gray-400 w-1/4">&nbsp;</th>
                {COMPETITORS.map((c) => (
                  <th
                    key={c}
                    className={`py-4 px-3 text-sm font-semibold text-center ${
                      c === 'ANT' ? 'text-emerald-300' : 'text-gray-400'
                    }`}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.axisKey} className="border-b border-white/5">
                  <td className="py-4 pr-4 text-sm text-gray-300">{axisLabels[row.axisKey] ?? row.axisKey}</td>
                  {COMPETITORS.map((c) => (
                    <td
                      key={c}
                      className={`py-4 px-3 text-center ${c === 'ANT' ? 'bg-emerald-950/10' : ''}`}
                    >
                      <CellView value={row.values[c]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
