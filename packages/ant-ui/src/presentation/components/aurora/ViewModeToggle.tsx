
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Code, Eye, LayoutList } from 'lucide-react';
import { ViewModeButton } from './ViewModeButton';

/**
 * The ONE structured/preview ⇄ raw control.
 *
 * Every surface that shows a file two ways used to build its own pair, and the
 * three that existed disagreed on all three axes: label ("YAML" / "Raw" /
 * "원본" / ko "편집"), order (raw-left in the prose editor and the file editor,
 * structured-left in the definition cards) and default (raw for prose, form
 * everywhere else). This component owns all three so a call site cannot
 * diverge again:
 *
 *   - order is fixed — LEFT is structured/preview, RIGHT is raw;
 *   - labels come from `common:viewMode.*`, read here, never injected;
 *   - the caller only picks WHICH left button applies to its content
 *     (`structured` for a real form, `preview` for markdown/text).
 */
export type ToggleLeftKind = 'structured' | 'preview';
export type ToggleValue = 'left' | 'raw';

export interface ViewModeToggleProps {
  /** A real structured form, or a rendered read of text/markdown. */
  left: ToggleLeftKind;
  value: ToggleValue;
  onChange: (next: ToggleValue) => void;
  /**
   * The left view does not apply to this content (e.g. a `.json` that cannot
   * be markdown-previewed). The button stays VISIBLE and disabled — hiding it
   * moved the control's position from section to section, which is the
   * fragmentation this component exists to end.
   */
  leftDisabled?: boolean;
  leftDisabledTitle?: string;
  /** `sm` = compact toolbar (file editor); `md` = SectionCard headerAction. */
  size?: 'sm' | 'md';
}

export function ViewModeToggle({
  left,
  value,
  onChange,
  leftDisabled = false,
  leftDisabledTitle,
  size = 'md',
}: ViewModeToggleProps): JSX.Element {
  const { t } = useTranslation('common');
  const compact = size === 'sm';
  return (
    <div
      className="inline-flex items-center gap-0.5"
      role="group"
      style={
        compact
          ? {
              height: 24,
              padding: 2,
              background: 'var(--bg-surface-2)',
              border: '1px solid var(--border-1)',
              borderRadius: 'var(--r-md)',
            }
          : undefined
      }
    >
      <ViewModeButton
        icon={left === 'structured' ? LayoutList : Eye}
        label={
          left === 'structured'
            ? t('viewMode.structured', 'Structured')
            : t('viewMode.preview', 'Preview')
        }
        active={value === 'left' && !leftDisabled}
        disabled={leftDisabled}
        title={leftDisabled ? leftDisabledTitle : undefined}
        compact={compact}
        onClick={() => onChange('left')}
      />
      <ViewModeButton
        icon={Code}
        label={t('viewMode.raw', 'Raw')}
        active={value === 'raw' || leftDisabled}
        compact={compact}
        onClick={() => onChange('raw')}
      />
    </div>
  );
}
