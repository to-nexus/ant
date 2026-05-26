
import * as React from 'react';

/**
 * Aurora Card — ported from visual/ui/handoff/project/ui.jsx + §4.5 §5.5
 * (hover-lift translateY(-2px) + shadow-lg on hover when `hoverable`).
 *
 * Also exports legacy-compatible subcomponents (CardHeader, CardTitle,
 * CardDescription, CardContent, CardFooter) so existing call sites
 * (SessionView, etc.) continue to compile while still using Aurora tokens.
 */

export type CardGradient = 'aurora' | 'violet-pink' | 'pink-orange' | 'cool' | 'sunset' | 'none';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg' | 'xl';

export interface CardProps {
  glow?: boolean;
  gradient?: CardGradient;
  hoverable?: boolean;
  padding?: CardPadding;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  style?: React.CSSProperties;
  className?: string;
  children?: React.ReactNode;
}

const PAD_TABLE: Record<CardPadding, number> = {
  none: 0,
  sm: 12,
  md: 20,
  lg: 28,
  xl: 36,
};

const GRADIENT_TABLE: Record<Exclude<CardGradient, 'none'>, string> = {
  aurora: 'var(--gradient-aurora)',
  'violet-pink': 'var(--gradient-violet-pink)',
  'pink-orange': 'var(--gradient-pink-orange)',
  cool: 'var(--gradient-cool)',
  sunset: 'var(--gradient-sunset)',
};

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  props,
  ref,
) {
  const {
    glow,
    gradient,
    hoverable,
    padding = 'md',
    onClick,
    style,
    className,
    children,
  } = props;

  const [hover, setHover] = React.useState(false);

  const background =
    gradient && gradient !== 'none' ? GRADIENT_TABLE[gradient] : 'var(--bg-surface)';

  return (
    <div
      ref={ref}
      className={['aurora-card', className].filter(Boolean).join(' ')}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        background,
        borderRadius: 'var(--r-2xl)',
        padding: PAD_TABLE[padding],
        border: '1px solid var(--border-1)',
        boxShadow: hover && hoverable ? 'var(--shadow-lg)' : 'var(--shadow-sm)',
        transform: hover && hoverable ? 'translateY(-2px)' : 'none',
        transition:
          'transform var(--dur-base) var(--ease-spring), box-shadow var(--dur-base) var(--ease-smooth)',
        cursor: onClick ? 'pointer' : 'default',
        color: 'var(--text-1)',
        ...style,
      }}
    >
      {glow && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: -1,
            borderRadius: 'inherit',
            background: 'var(--gradient-aurora)',
            opacity: hover ? 0.5 : 0.25,
            filter: 'blur(20px)',
            zIndex: -1,
            transition: 'opacity var(--dur-base) var(--ease-smooth)',
          }}
        />
      )}
      {children}
    </div>
  );
});

/* ---------------------------------------------------------------------------
   Legacy-compatible subcomponents (Aurora-token styling)
   --------------------------------------------------------------------------- */

export const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function CardHeader({ className, style, ...rest }, ref) {
  return (
    <div
      ref={ref}
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '20px 20px 0',
        ...style,
      }}
      {...rest}
    />
  );
});

export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(function CardTitle({ className, style, ...rest }, ref) {
  return (
    <h3
      ref={ref}
      className={className}
      style={{
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--fs-lg)',
        fontWeight: 700,
        letterSpacing: '-0.01em',
        color: 'var(--text-1)',
        margin: 0,
        ...style,
      }}
      {...rest}
    />
  );
});

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(function CardDescription({ className, style, ...rest }, ref) {
  return (
    <p
      ref={ref}
      className={className}
      style={{
        fontSize: 'var(--fs-sm)',
        color: 'var(--text-3)',
        margin: 0,
        ...style,
      }}
      {...rest}
    />
  );
});

export const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function CardContent({ className, style, ...rest }, ref) {
  return (
    <div
      ref={ref}
      className={className}
      style={{
        padding: 20,
        ...style,
      }}
      {...rest}
    />
  );
});

export const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function CardFooter({ className, style, ...rest }, ref) {
  return (
    <div
      ref={ref}
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px 20px',
        ...style,
      }}
      {...rest}
    />
  );
});
