
import { useMemo } from 'react';
import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface TocNavItem {
  id: string;
  label: string;
  /** lucide-react icon name (PascalCase). Falls back gracefully if missing. */
  icon: string;
  dirty?: boolean;
  count?: number;
}

export interface TocNavProps {
  items: TocNavItem[];
  active: string;
  onSelect: (id: string) => void;
}

function resolveIcon(name: string): LucideIcon | null {
  const registry = LucideIcons as unknown as Record<string, LucideIcon>;
  const icon = registry[name];
  return typeof icon === 'function' || (icon && typeof icon === 'object')
    ? icon
    : null;
}

export function TocNav({ items, active, onSelect }: TocNavProps) {
  const resolvedItems = useMemo(
    () =>
      items.map((it) => ({
        ...it,
        IconComp: resolveIcon(it.icon),
      })),
    [items],
  );

  return (
    <nav
      style={{
        position: 'sticky',
        top: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '20px 10px 20px 0',
        minWidth: 180,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 1.6,
          color: 'var(--text-4)',
          padding: '4px 10px 10px',
        }}
      >
        섹션
      </div>
      {resolvedItems.map((item) => {
        const isActive = item.id === active;
        const IconComp = item.IconComp;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 10px 8px 14px',
              border: 'none',
              background: isActive
                ? 'oklch(94% 0.06 290 / 0.5)'
                : 'transparent',
              color: isActive ? 'var(--violet-700)' : 'var(--text-3)',
              fontWeight: isActive ? 700 : 600,
              fontSize: 12.5,
              textAlign: 'left',
              borderRadius: 'var(--r-md)',
              cursor: 'pointer',
            }}
          >
            {isActive && (
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 6,
                  bottom: 6,
                  width: 2,
                  background: 'var(--gradient-violet-pink)',
                  borderRadius: 2,
                }}
              />
            )}
            {IconComp ? (
              <IconComp size={14} strokeWidth={2} />
            ) : (
              <span style={{ width: 14, display: 'inline-block' }} />
            )}
            <span style={{ flex: 1, minWidth: 0 }}>{item.label}</span>
            {item.dirty && (
              <span
                aria-label="unsaved"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--gradient-pink-orange)',
                  flexShrink: 0,
                }}
              />
            )}
            {item.count != null && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: 'var(--r-pill)',
                  background: 'var(--bg-surface-2)',
                  color: 'var(--text-3)',
                  letterSpacing: '0.02em',
                }}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
