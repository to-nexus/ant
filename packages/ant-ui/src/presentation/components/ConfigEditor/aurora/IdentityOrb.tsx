
import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface IdentityOrbProps {
  initial?: string;
  /** lucide-react icon name (PascalCase). */
  icon?: string;
  size?: number;
  gradient?: string;
  pulse?: boolean;
  ringColor?: string;
}

function resolveIcon(name: string): LucideIcon | null {
  const registry = LucideIcons as unknown as Record<string, LucideIcon>;
  const icon = registry[name];
  return typeof icon === 'function' || (icon && typeof icon === 'object')
    ? icon
    : null;
}

export function IdentityOrb({
  initial,
  icon,
  size = 64,
  gradient = 'var(--gradient-aurora)',
  pulse = false,
  ringColor,
}: IdentityOrbProps) {
  const IconComp = icon ? resolveIcon(icon) : null;
  const iconSize = Math.round(size * 0.45);

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
      }}
    >
      {pulse && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: -6,
            borderRadius: '50%',
            background: ringColor || gradient,
            opacity: 0.35,
            filter: 'blur(10px)',
            animation: 'pulse-soft 2.2s ease-in-out infinite',
            pointerEvents: 'none',
          }}
        />
      )}
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          background: gradient,
          backgroundSize: '180% 180%',
          color: 'white',
          fontWeight: 800,
          fontSize: size * 0.36,
          fontFamily: 'var(--font-display)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow:
            '0 8px 28px -6px oklch(45% 0.20 290 / 0.45), inset 0 1px 1px oklch(100% 0 0 / 0.3)',
          letterSpacing: '-0.02em',
          textTransform: 'uppercase',
        }}
      >
        {IconComp ? (
          <IconComp size={iconSize} strokeWidth={2} />
        ) : (
          initial ?? ''
        )}
      </div>
    </div>
  );
}
