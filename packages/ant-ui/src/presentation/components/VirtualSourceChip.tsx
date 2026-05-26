
import type { EditorSource } from './FileEditorPanel/types';

interface VirtualSourceChipProps {
  source: EditorSource;
}

const GRADIENT_BY_SOURCE: Record<EditorSource, string> = {
  // Design — full Aurora gradient (violet → pink → amber)
  design: 'var(--gradient-aurora)',
  // Plan — blue → violet
  plan: 'linear-gradient(135deg, oklch(64% 0.20 240), oklch(60% 0.22 285))',
  // Code — cyan → teal
  code: 'linear-gradient(135deg, oklch(58% 0.20 200), oklch(62% 0.18 160))',
  // Chat — amber → orange
  chat: 'linear-gradient(135deg, oklch(70% 0.20 50), oklch(68% 0.22 30))',
};

const LABEL_BY_SOURCE: Record<EditorSource, string> = {
  design: 'design',
  plan: 'plan',
  code: 'code',
  chat: 'chat',
};

/**
 * Aurora pill showing the editor-tab source with a per-source gradient
 * swatch. Used by VirtualDocumentViewer (spec §5.8 — source chip 신규).
 */
export function VirtualSourceChip({ source }: VirtualSourceChipProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 9px',
        borderRadius: 'var(--r-pill)',
        background: 'var(--bg-surface-2)',
        border: '1px solid var(--border-1)',
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: 'var(--text-2)',
        lineHeight: 1,
      }}
      title={`source: ${LABEL_BY_SOURCE[source]}`}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: GRADIENT_BY_SOURCE[source],
          flexShrink: 0,
        }}
      />
      {LABEL_BY_SOURCE[source]}
    </span>
  );
}
