
import * as React from 'react';
import { Icon } from './Icon';
import { Badge } from './Badge';

/**
 * Aurora Tabs — `pill` (default) or `underline` variant. Prop is `items` per
 * spec §4.2 (vs ui.jsx's `tabs`).
 */

export interface TabItem {
  id: string;
  label: string;
  icon?: string;
  badge?: string | number;
}

export interface TabsProps {
  variant?: 'pill' | 'underline';
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function Tabs({
  variant = 'pill',
  items,
  activeId,
  onChange,
  className,
  style,
}: TabsProps) {
  if (variant === 'underline') {
    return (
      <div
        role="tablist"
        className={className}
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--border-1)',
          position: 'relative',
          ...style,
        }}
      >
        {items.map((t) => {
          const isActive = t.id === activeId;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(t.id)}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '12px 16px',
                fontSize: 14,
                fontWeight: 600,
                color: isActive ? 'var(--text-1)' : 'var(--text-3)',
                cursor: 'pointer',
                position: 'relative',
                fontFamily: 'inherit',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {t.icon && <Icon name={t.icon} size={14} />}
              {t.label}
              {t.badge !== undefined && t.badge !== null && (
                <Badge size="sm" tone="brand">
                  {t.badge}
                </Badge>
              )}
              {isActive && (
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    left: 12,
                    right: 12,
                    bottom: -1,
                    height: 2,
                    background: 'var(--gradient-violet-pink)',
                    borderRadius: 2,
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="tablist"
      className={className}
      style={{
        display: 'inline-flex',
        gap: 4,
        padding: 4,
        background: 'var(--bg-surface-2)',
        borderRadius: 'var(--r-pill)',
        border: '1px solid var(--border-1)',
        ...style,
      }}
    >
      {items.map((t) => {
        const isActive = t.id === activeId;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 14px',
              background: isActive ? 'var(--bg-surface)' : 'transparent',
              color: isActive ? 'var(--violet-600)' : 'var(--text-3)',
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              borderRadius: 'var(--r-pill)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              boxShadow: isActive ? 'var(--shadow-xs)' : 'none',
              transition: 'all var(--dur-base) var(--ease-spring)',
            }}
          >
            {t.icon && <Icon name={t.icon} size={14} />}
            {t.label}
            {t.badge !== undefined && t.badge !== null && (
              <Badge size="sm" tone="brand">
                {t.badge}
              </Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}
