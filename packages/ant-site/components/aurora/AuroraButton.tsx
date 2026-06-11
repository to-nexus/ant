'use client';

import Link from 'next/link';
import type { CSSProperties, ReactNode, MouseEventHandler } from 'react';

export type AuroraButtonVariant = 'primary' | 'secondary' | 'ghost';
export type AuroraButtonSize = 'sm' | 'md' | 'lg';

interface CommonProps {
  variant?: AuroraButtonVariant;
  size?: AuroraButtonSize;
  fullWidth?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

type AsLink = CommonProps & {
  href: string;
  external?: boolean;
  onClick?: never;
};

type AsButton = CommonProps & {
  href?: undefined;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  type?: 'button' | 'submit';
};

type AuroraButtonProps = AsLink | AsButton;

const SIZE: Record<AuroraButtonSize, CSSProperties> = {
  sm: { height: 38, padding: '0 16px', fontSize: 13, borderRadius: 10 },
  md: { height: 44, padding: '0 20px', fontSize: 14, borderRadius: 12 },
  lg: { height: 52, padding: '0 26px', fontSize: 15, borderRadius: 14 },
};

const BASE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  fontFamily: 'var(--font-display)',
  fontWeight: 600,
  letterSpacing: '-0.01em',
  border: 'none',
  cursor: 'pointer',
  position: 'relative',
  whiteSpace: 'nowrap',
  textDecoration: 'none',
  userSelect: 'none',
  transition:
    'transform var(--dur-base) var(--ease-spring), box-shadow var(--dur-base) var(--ease-smooth), background var(--dur-fast) var(--ease-smooth), border-color var(--dur-fast) var(--ease-smooth)',
};

function variantStyle(variant: AuroraButtonVariant): { style: CSSProperties; className: string } {
  switch (variant) {
    case 'primary':
      return {
        className: 'gradient-flow aurora-btn aurora-btn-primary',
        style: {
          background: 'var(--gradient-aurora)',
          backgroundSize: '200% 200%',
          color: 'var(--text-on-brand)',
          boxShadow: 'var(--shadow-glow-aurora)',
          animation: 'gradient-shift 5s ease-in-out infinite',
        },
      };
    case 'secondary':
      return {
        className: 'aurora-btn aurora-btn-secondary',
        style: {
          background: 'var(--bg-surface)',
          color: 'var(--text-1)',
          border: '1px solid var(--border-2)',
          boxShadow: 'var(--shadow-xs)',
        },
      };
    case 'ghost':
    default:
      return {
        className: 'aurora-btn aurora-btn-ghost',
        style: { background: 'transparent', color: 'var(--text-2)' },
      };
  }
}

export function AuroraButton(props: AuroraButtonProps) {
  const { variant = 'primary', size = 'md', fullWidth, className, style, children } = props;
  const v = variantStyle(variant);
  const composed: CSSProperties = {
    ...BASE,
    ...SIZE[size],
    ...v.style,
    ...(fullWidth ? { width: '100%' } : null),
    ...style,
  };
  const cls = [v.className, className].filter(Boolean).join(' ');

  if (props.href !== undefined) {
    if (props.external) {
      return (
        <a href={props.href} target="_blank" rel="noopener noreferrer" className={cls} style={composed}>
          {children}
        </a>
      );
    }
    return (
      <Link href={props.href} className={cls} style={composed}>
        {children}
      </Link>
    );
  }

  return (
    <button type={props.type ?? 'button'} onClick={props.onClick} className={cls} style={composed}>
      {children}
    </button>
  );
}
