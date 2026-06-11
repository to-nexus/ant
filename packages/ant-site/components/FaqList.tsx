'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';

interface FaqItem {
  q: string;
  a: string;
}

interface FaqListProps {
  title: string;
  items: FaqItem[];
}

export function FaqList({ title, items }: FaqListProps) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="py-16 sm:py-24">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2
          className="text-display text-center"
          style={{ fontSize: 'clamp(26px, 3.5vw, 34px)', color: 'var(--text-1)', marginBottom: 40 }}
        >
          {title}
        </h2>
        <div className="space-y-3">
          {items.map((item, i) => {
            const isOpen = open === i;
            return (
              <div
                key={i}
                style={{
                  borderRadius: 'var(--r-lg)',
                  background: 'var(--bg-surface)',
                  border: `1px solid ${isOpen ? 'var(--border-2)' : 'var(--border-1)'}`,
                  overflow: 'hidden',
                  transition: 'border-color var(--dur-fast) var(--ease-smooth)',
                }}
              >
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full flex items-center justify-between gap-4 text-left"
                  style={{ padding: '18px 20px' }}
                  aria-expanded={isOpen}
                >
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)' }}>{item.q}</span>
                  <Plus
                    className="w-4 h-4 shrink-0"
                    style={{
                      color: 'var(--text-3)',
                      transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)',
                      transition: 'transform var(--dur-base) var(--ease-spring)',
                    }}
                  />
                </button>
                {isOpen && (
                  <p
                    style={{
                      padding: '0 20px 18px',
                      fontSize: 14,
                      color: 'var(--text-3)',
                      lineHeight: 'var(--lh-relaxed)',
                    }}
                  >
                    {item.a}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
