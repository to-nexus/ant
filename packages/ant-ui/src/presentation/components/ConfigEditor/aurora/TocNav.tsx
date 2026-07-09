
import { useMemo, useState } from 'react';
import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { selectedIconTileStyle } from '../../aurora/selection';

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
  const [hovered, setHovered] = useState<string | null>(null);
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
      }}
    >
      {resolvedItems.map((item) => {
        const isActive = item.id === active;
        const isHovered = !isActive && hovered === item.id;
        const IconComp = item.IconComp;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            onMouseEnter={() => setHovered(item.id)}
            onMouseLeave={() => setHovered((h) => (h === item.id ? null : h))}
            title={item.label}
            aria-label={item.label}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              width: 64,
              minHeight: 52,
              padding: '6px 4px',
              border: 'none',
              borderRadius: 'var(--r-md)',
              cursor: 'pointer',
              transition: 'background 120ms ease, color 120ms ease',
              ...selectedIconTileStyle(isActive),
              ...(isHovered
                ? { background: 'var(--bg-surface-2)', color: 'var(--text-2)' }
                : null),
            }}
          >
            <span
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 40,
                height: 40,
              }}
            >
              {IconComp ? (
                <IconComp size={20} strokeWidth={2} />
              ) : (
                <span style={{ width: 20, display: 'inline-block' }} />
              )}
              {item.count != null ? (
                <span
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
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
                      top: 3,
                      right: 3,
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: 'var(--gradient-pink-orange)',
                    }}
                  />
                )
              )}
            </span>
            <span
              style={{
                fontSize: 10,
                lineHeight: 1.15,
                fontWeight: isActive ? 700 : 500,
                textAlign: 'center',
                wordBreak: 'keep-all',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
