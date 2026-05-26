
import * as React from 'react';
import { Icon } from './Icon';

/**
 * Aurora Avatar — gradient orb with image / initials / icon.
 * `name` derives a single-letter fallback when neither `initials` nor `src` is
 * supplied.
 */

export type AvatarGradient = 'aurora' | 'violet-pink' | 'pink-orange' | 'cool';

export interface AvatarProps {
  src?: string;
  initials?: string;
  name?: string;
  icon?: string;
  size?: number;
  gradient?: AvatarGradient;
  glow?: boolean;
  style?: React.CSSProperties;
  className?: string;
  alt?: string;
}

const GRADIENT_TABLE: Record<AvatarGradient, string> = {
  aurora: 'var(--gradient-aurora)',
  'violet-pink': 'var(--gradient-violet-pink)',
  'pink-orange': 'var(--gradient-pink-orange)',
  cool: 'var(--gradient-cool)',
};

export function Avatar({
  src,
  initials,
  name,
  icon,
  size = 36,
  gradient = 'aurora',
  glow,
  style,
  className,
  alt,
}: AvatarProps) {
  const resolvedInitials = initials
    ? initials.slice(0, 2).toUpperCase()
    : name
      ? name.charAt(0).toUpperCase()
      : '';

  const baseStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    background: GRADIENT_TABLE[gradient],
    backgroundSize: '200% 200%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    fontWeight: 700,
    fontSize: Math.round(size * 0.4),
    boxShadow: glow ? 'var(--shadow-glow-aurora)' : 'var(--shadow-xs)',
    flexShrink: 0,
    overflow: 'hidden',
    ...style,
  };

  const composedClassName = ['gradient-flow', className].filter(Boolean).join(' ');

  if (src) {
    return (
      <span className={composedClassName} style={baseStyle}>
        <img
          src={src}
          alt={alt ?? name ?? ''}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </span>
    );
  }

  return (
    <div className={composedClassName} style={baseStyle} aria-label={alt ?? name}>
      {icon ? (
        <Icon name={icon} size={Math.round(size * 0.5)} />
      ) : resolvedInitials ? (
        resolvedInitials
      ) : (
        <Icon name="circle" size={Math.round(size * 0.5)} />
      )}
    </div>
  );
}
