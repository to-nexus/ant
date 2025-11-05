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
      className={`border-t border-gray-200 bg-gray-50 ${className}`}
      style={{ zIndex }}
    >
      {children}
    </div>
  );
}
