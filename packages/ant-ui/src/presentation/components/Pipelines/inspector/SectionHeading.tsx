import type { ReactNode } from 'react';

/** Inspector section eyebrow — identity → wiring → work → inputs → policy. */
export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{children}</span>
      <span aria-hidden style={{ flex: 1, height: 1, background: 'var(--border-1)' }} />
    </div>
  );
}
