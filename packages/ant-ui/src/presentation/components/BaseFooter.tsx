import { ReactNode } from 'react';

interface BaseFooterProps {
  children: ReactNode;
  className?: string;
  zIndex?: number;
}

/**
 * Base Footer Component
 * Common footer wrapper that can be extended for different footer types
 */
export function BaseFooter({ children, className = '', zIndex = 50 }: BaseFooterProps) {
  return (
    <div
      className={className}
      style={{
        zIndex,
        borderTop: '1px solid var(--border-1)',
        background: 'var(--bg-surface-2)',
      }}
    >
      {children}
    </div>
  );
}
