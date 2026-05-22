
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

export interface DangerZoneProps {
  title: string;
  description: string;
  buttonText: string;
  loadingText?: string;
  isLoading?: boolean;
  onAction: () => void | Promise<void>;
}

/**
 * Destructive-action card. Red palette, halo overlay, solid danger button.
 * The visual contract mirrors C3_COMMON's C3DangerZone exactly.
 */
export function DangerZone({
  title,
  description,
  buttonText,
  loadingText,
  isLoading = false,
  onAction,
}: DangerZoneProps) {
  return (
    <section
      style={{
        position: 'relative',
        padding: 20,
        background:
          'linear-gradient(135deg, oklch(96% 0.04 25 / 0.6), oklch(95% 0.05 15 / 0.4))',
        border: '1.5px solid oklch(82% 0.12 25)',
        borderRadius: 'var(--r-xl)',
        overflow: 'hidden',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at 100% 0%, oklch(85% 0.14 25 / 0.25), transparent 60%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: 'oklch(92% 0.06 25)',
            color: 'oklch(50% 0.20 25)',
            border: '1px solid oklch(85% 0.10 25)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <AlertTriangle size={18} strokeWidth={2.2} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h4
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 800,
              color: 'oklch(38% 0.20 25)',
              letterSpacing: '-0.005em',
            }}
          >
            {title}
          </h4>
          <p
            style={{
              margin: '6px 0 14px',
              fontSize: 12,
              lineHeight: 1.5,
              color: 'oklch(45% 0.16 25)',
            }}
          >
            {description}
          </p>
          <DangerSolidButton
            disabled={isLoading}
            onClick={onAction}
          >
            {isLoading ? loadingText || buttonText : buttonText}
          </DangerSolidButton>
        </div>
      </div>
    </section>
  );
}

interface DangerSolidButtonProps {
  children: React.ReactNode;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
}

function DangerSolidButton({
  children,
  onClick,
  disabled = false,
}: DangerSolidButtonProps) {
  const [hover, setHover] = useState(false);

  const background = hover && !disabled
    ? 'linear-gradient(135deg, oklch(58% 0.22 25), oklch(54% 0.20 15))'
    : 'linear-gradient(135deg, oklch(65% 0.22 25), oklch(62% 0.20 15))';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        height: 36,
        padding: '0 16px',
        background,
        color: 'white',
        border: 'none',
        borderRadius: 'var(--r-md)',
        fontSize: 12.5,
        fontWeight: 700,
        letterSpacing: '0.01em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.65 : 1,
        boxShadow: '0 4px 14px -4px oklch(60% 0.22 25 / 0.4)',
        transition: 'background 0.2s ease, box-shadow 0.2s ease, opacity 0.15s ease',
      }}
    >
      {children}
    </button>
  );
}
