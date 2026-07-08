
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
        alignItems: 'center',
        gap: 4,
        padding: '20px 6px',
        minWidth: 52,
      }}
    >
      {resolvedItems.map((item) => {
        const isActive = item.id === active;
        const IconComp = item.IconComp;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            title={item.label}
            aria-label={item.label}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 10,
              border: 'none',
              background: isActive
                ? 'oklch(94% 0.06 290 / 0.5)'
                : 'transparent',
              color: isActive ? 'var(--violet-700)' : 'var(--text-3)',
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
              <IconComp size={20} strokeWidth={2} />
            ) : (
              <span style={{ width: 20, display: 'inline-block' }} />
            )}
            {item.count != null ? (
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  fontSize: 9,
                  fontWeight: 700,
                  minWidth: 14,
                  textAlign: 'center',
                  padding: '0 3px',
                  borderRadius: 'var(--r-pill)',
                  background: 'var(--bg-surface-2)',
                  color: 'var(--text-3)',
                  letterSpacing: '0.02em',
                }}
              >
                {item.count}
              </span>
            ) : (
              item.dirty && (
                <span
                  aria-label="unsaved"
                  style={{
                    position: 'absolute',
                    top: 5,
                    right: 5,
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--gradient-pink-orange)',
                  }}
                />
              )
            )}
          </button>
        );
      })}
    </nav>
  );
}
