
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AvailableModel } from '../hooks/useAvailableModels';

const PROVIDER_ICON: Record<string, string> = {
  anthropic: '⬡',
  google: '◈',
  openai: '◉',
};

interface ProviderAccent {
  fg: string;
  bg: string;
  ring: string;
}

const PROVIDER_ACCENT: Record<string, ProviderAccent> = {
  anthropic: {
    fg: 'oklch(48% 0.18 35)',
    bg: 'oklch(94% 0.06 40 / 0.9)',
    ring: 'oklch(72% 0.16 40)',
  },
  google: {
    fg: 'oklch(45% 0.18 250)',
    bg: 'oklch(94% 0.06 250 / 0.9)',
    ring: 'oklch(72% 0.14 250)',
  },
  openai: {
    fg: 'oklch(45% 0.16 155)',
    bg: 'oklch(94% 0.05 155 / 0.9)',
    ring: 'oklch(72% 0.14 155)',
  },
};

const FALLBACK_ACCENT: ProviderAccent = {
  fg: 'var(--text-1)',
  bg: 'var(--bg-surface)',
  ring: 'var(--border-2)',
};

interface ModelSelectChipProps {
  value: string;
  models: AvailableModel[];
  onChange: (modelId: string) => void;
  placeholder?: string;
  inheritedModel?: {
    id: string;
    displayName: string;
    provider: string;
  };
  showAsCustom?: boolean;
  /** When true, the trigger fills its container width. */
  fill?: boolean;
  /** When true, the trigger uses compact (26px) height. */
  compact?: boolean;
}

interface DropdownPosition {
  top: number;
  left: number;
  width: number;
  direction: 'down' | 'up';
}

export function ModelSelectChip({
  value,
  models,
  onChange,
  placeholder,
  inheritedModel,
  showAsCustom,
  fill = false,
  compact = false,
}: ModelSelectChipProps) {
  const { t } = useTranslation('config');
  const [isOpen, setIsOpen] = useState(false);
  const [hoverRow, setHoverRow] = useState<string | null>(null);
  const [position, setPosition] = useState<DropdownPosition>({
    top: 0,
    left: 0,
    width: 240,
    direction: 'down',
  });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const direction = spaceBelow < 340 ? 'up' : 'down';
    setPosition({
      top: direction === 'down' ? rect.bottom + 4 : rect.top - 4,
      left: rect.left,
      width: Math.max(rect.width, 240),
      direction,
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) updatePosition();
  }, [isOpen, updatePosition]);

  const selected = models.find((m) => m.id === value);
  const isInherited = !value && !!inheritedModel;
  const displayModel = selected || (isInherited ? inheritedModel : null);
  const providerIcon = displayModel ? PROVIDER_ICON[displayModel.provider] || '' : '';
  const triggerAccent = displayModel
    ? PROVIDER_ACCENT[displayModel.provider] || FALLBACK_ACCENT
    : null;

  const grouped = models.reduce<Record<string, AvailableModel[]>>((acc, m) => {
    if (!acc[m.provider]) acc[m.provider] = [];
    acc[m.provider].push(m);
    return acc;
  }, {});
  const providerOrder = ['anthropic', 'google', 'openai'].filter((p) => grouped[p]);

  const handleSelect = (modelId: string) => {
    onChange(modelId);
    setIsOpen(false);
  };

  const triggerHeight = compact ? 26 : 30;
  const triggerPad = compact ? '0 8px' : '0 10px';

  const triggerStyle: React.CSSProperties = displayModel
    ? {
        background: triggerAccent!.bg,
        color: triggerAccent!.fg,
        border: `1px solid ${triggerAccent!.ring}`,
      }
    : {
        background: 'var(--bg-surface-2)',
        color: 'var(--text-4)',
        border: '1px dashed var(--border-2)',
      };

  const dropdown =
    isOpen &&
    createPortal(
      <div
        ref={dropdownRef}
        style={{
          position: 'fixed',
          zIndex: 9999,
          left: position.left,
          minWidth: Math.max(position.width, 224),
          maxWidth: 320,
          ...(position.direction === 'down'
            ? { top: position.top }
            : { bottom: window.innerHeight - position.top }),
          background: 'oklch(from var(--bg-surface) l c h / 0.98)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid var(--border-2)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
          fontFamily: 'var(--font-display)',
        }}
      >
        {inheritedModel && (
          <button
            type="button"
            onClick={() => handleSelect('')}
            onMouseEnter={() => setHoverRow('__inherited__')}
            onMouseLeave={() => setHoverRow(null)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              border: 'none',
              borderBottom: '1px solid var(--border-1)',
              background: !value
                ? 'oklch(94% 0.06 290 / 0.6)'
                : hoverRow === '__inherited__'
                  ? 'var(--bg-hover)'
                  : 'transparent',
              color: !value ? 'var(--violet-700)' : 'var(--text-3)',
              fontSize: 12.5,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.12s ease',
            }}
          >
            <span style={{ fontSize: 11, opacity: 0.6 }}>
              {PROVIDER_ICON[inheritedModel.provider] || ''}
            </span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {inheritedModel.displayName}
            </span>
            <span style={{ fontSize: 10, opacity: 0.55, flexShrink: 0 }}>
              ({t('projectEditor.jobDefault')})
            </span>
            {!value && (
              <CheckGlyph color="var(--violet-700)" />
            )}
          </button>
        )}

        <div style={{ maxHeight: 300, overflowY: 'auto', padding: '4px 0' }}>
          {providerOrder.map((provider, groupIdx) => {
            const accent = PROVIDER_ACCENT[provider] || FALLBACK_ACCENT;
            return (
              <div key={provider}>
                {groupIdx > 0 && (
                  <div
                    aria-hidden
                    style={{
                      height: 1,
                      background: 'var(--border-1)',
                      margin: '4px 0',
                    }}
                  />
                )}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px 4px',
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: accent.fg,
                  }}
                >
                  <span aria-hidden style={{ fontSize: 11 }}>
                    {PROVIDER_ICON[provider] || ''}
                  </span>
                  <span>{provider}</span>
                </div>
                {grouped[provider].map((model) => {
                  const isSelected = model.id === value;
                  const rowKey = `${provider}:${model.id}`;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => handleSelect(model.id)}
                      onMouseEnter={() => setHoverRow(rowKey)}
                      onMouseLeave={() => setHoverRow(null)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 12px',
                        border: 'none',
                        background: isSelected
                          ? 'oklch(94% 0.06 290 / 0.6)'
                          : hoverRow === rowKey
                            ? 'var(--bg-hover)'
                            : 'transparent',
                        color: isSelected ? 'var(--violet-700)' : 'var(--text-2)',
                        fontSize: 12.5,
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background 0.12s ease',
                      }}
                    >
                      <span style={{ fontSize: 11, opacity: 0.5 }}>
                        {PROVIDER_ICON[model.provider] || ''}
                      </span>
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {model.displayName}
                      </span>
                      {model.recommended && (
                        <span
                          aria-label="recommended"
                          style={{ fontSize: 11, color: 'oklch(70% 0.18 80)', flexShrink: 0 }}
                        >
                          ★
                        </span>
                      )}
                      {isSelected && <CheckGlyph color="var(--violet-700)" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: triggerHeight,
          padding: triggerPad,
          width: fill ? '100%' : undefined,
          maxWidth: fill ? '100%' : 220,
          minWidth: 0,
          borderRadius: 'var(--r-md)',
          fontSize: 12,
          fontWeight: 700,
          fontFamily: 'var(--font-display)',
          cursor: 'pointer',
          transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease',
          ...triggerStyle,
        }}
      >
        {!showAsCustom && providerIcon && (
          <span style={{ flexShrink: 0, fontSize: 12, opacity: 0.75 }}>{providerIcon}</span>
        )}
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 12.5,
            textAlign: 'left',
          }}
        >
          {showAsCustom
            ? t('projectEditor.custom')
            : displayModel
              ? `${displayModel.displayName}${isInherited ? ` (${t('projectEditor.jobDefault')})` : ''}`
              : placeholder || t('projectEditor.selectModel')}
        </span>
        <ChevronGlyph open={isOpen} />
      </button>
      {dropdown}
    </>
  );
}

function ChevronGlyph({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      width="10"
      height="10"
      viewBox="0 0 12 12"
      style={{
        flexShrink: 0,
        opacity: 0.6,
        transform: open ? 'rotate(180deg)' : 'none',
        transition: 'transform 0.15s ease',
      }}
    >
      <path
        d="M2.5 4.5 L6 8 L9.5 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckGlyph({ color }: { color: string }) {
  return (
    <svg
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 12 12"
      style={{ flexShrink: 0, marginLeft: 'auto' }}
    >
      <path
        d="M2.5 6.5 L5 9 L9.5 3.5"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
