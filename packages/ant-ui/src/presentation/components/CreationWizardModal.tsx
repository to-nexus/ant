import { useTranslation } from 'react-i18next';
// TEMP(action-system-compat): Compass/Code2 icons used only by hidden design/code entries; re-add when restoring.
import { Sparkles, FolderPlus } from 'lucide-react';
import { Modal } from './common/Modal';
import { useStore } from '@/domain/store';
import { cn } from '@/shared/utils/design-system';

interface CreationWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingProjectId?: string;
  onCreateEmpty: () => void;
}

// Token-driven visual config. Brand-gradient surfaces use inline CSS vars so
// the appearance follows light/dark theme switches (static Tailwind palettes
// like `emerald-50` do not — they produce white-on-white text in dark mode).
type PathVisual = {
  id: 'plan' | 'design' | 'code';
  icon: typeof Sparkles;
  surfaceStyle: React.CSSProperties;
  iconBgStyle: React.CSSProperties;
  iconColorStyle: React.CSSProperties;
  titleColorStyle: React.CSSProperties;
  hintColorStyle: React.CSSProperties;
};

const PATHS: readonly PathVisual[] = [
  {
    id: 'plan',
    icon: Sparkles,
    // Aurora brand gradient — matches QuickStart's primary CTA treatment.
    surfaceStyle: {
      background: 'var(--gradient-aurora)',
      boxShadow: 'var(--shadow-glow-aurora)',
      borderColor: 'transparent',
    },
    iconBgStyle: { background: 'rgba(255, 255, 255, 0.18)' },
    iconColorStyle: { color: 'var(--text-on-brand)' },
    titleColorStyle: { color: 'var(--text-on-brand)' },
    hintColorStyle: { color: 'var(--text-on-brand)', opacity: 0.8 },
  },
  // TEMP(action-system-compat): hide design/code entries until ProjectWizardModal is compatible with the new action system.
  // When restoring, follow the same token-driven pattern as the 'plan' entry above —
  // do NOT reintroduce static Tailwind palettes (from-indigo-50, bg-amber-100, etc.)
  // because they break dark-mode contrast against `var(--text-1)`-based content.
  // {
  //   id: 'design',
  //   icon: Compass,
  //   surfaceStyle: {
  //     background: 'var(--bg-surface-2)',
  //     borderColor: 'var(--border-1)',
  //   },
  //   iconBgStyle: { background: 'var(--bg-surface-3)' },
  //   iconColorStyle: { color: 'var(--violet-500)' },
  //   titleColorStyle: { color: 'var(--text-1)' },
  //   hintColorStyle: { color: 'var(--text-3)' },
  // },
  // {
  //   id: 'code',
  //   icon: Code2,
  //   surfaceStyle: {
  //     background: 'var(--bg-surface-2)',
  //     borderColor: 'var(--border-1)',
  //   },
  //   iconBgStyle: { background: 'var(--bg-surface-3)' },
  //   iconColorStyle: { color: 'var(--amber-500)' },
  //   titleColorStyle: { color: 'var(--text-1)' },
  //   hintColorStyle: { color: 'var(--text-3)' },
  // },
] as const;

export function CreationWizardModal({
  isOpen,
  onClose,
  existingProjectId,
  onCreateEmpty,
}: CreationWizardModalProps) {
  const { t } = useTranslation('onboarding');
  const setQuickStartProjectId = useStore((s) => s.setQuickStartProjectId);
  const setProjectSetupConfig = useStore((s) => s.setProjectSetupConfig);

  const handleSelect = (id: 'plan' | 'design' | 'code') => {
    onClose();
    if (id === 'plan') {
      setQuickStartProjectId(existingProjectId ?? '__new__');
    } else {
      setProjectSetupConfig({
        mode: id,
        existingProjectId,
      });
    }
  };

  const titleKey = (id: 'plan' | 'design' | 'code') => {
    const map = { plan: 'fleshOutIdea', design: 'designSystem', code: 'codeFromDesign' } as const;
    return t(`quickstart.${map[id]}`);
  };

  const hintKey = (id: 'plan' | 'design' | 'code') => {
    const map = { plan: 'fleshOutIdeaHint', design: 'designSystemHint', code: 'codeFromDesignHint' } as const;
    return t(`quickstart.${map[id]}`);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('quickstart.creationModal.title')} size="md">
      <div className="space-y-3">
        {PATHS.map((p) => {
          const Icon = p.icon;
          return (
            <button
              key={p.id}
              onClick={() => handleSelect(p.id)}
              style={p.surfaceStyle}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3.5 text-left rounded-xl border',
                'transition-all duration-200 hover:shadow-md group',
              )}
            >
              <div
                style={p.iconBgStyle}
                className={cn(
                  'flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0',
                  'group-hover:scale-105 transition-transform',
                )}
              >
                <Icon className="w-4.5 h-4.5" style={p.iconColorStyle} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm" style={p.titleColorStyle}>
                  {titleKey(p.id)}
                </div>
                <div className="text-xs mt-0.5" style={p.hintColorStyle}>
                  {hintKey(p.id)}
                </div>
              </div>
            </button>
          );
        })}

        {/* Empty creation */}
        <button
          onClick={() => {
            onClose();
            onCreateEmpty();
          }}
          className={cn(
            'w-full flex items-center gap-3 px-4 py-3.5 text-left rounded-xl border',
            'bg-[color:var(--bg-canvas)]/50 border-[color:var(--border-1)]',
            'hover:border-[color:var(--border-2)] transition-all duration-200 hover:shadow-sm group',
          )}
        >
          <div className={cn(
            'flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0',
            'group-hover:scale-105 transition-transform',
            'bg-[color:var(--bg-surface-2)]/50',
          )}>
            <FolderPlus className="w-4.5 h-4.5 text-[color:var(--text-3)]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm text-[color:var(--text-2)]">
              {t('quickstart.creationModal.createEmpty')}
            </div>
            <div className="text-xs mt-0.5 text-[color:var(--text-4)]">
              {t('quickstart.creationModal.createEmptyHint')}
            </div>
          </div>
        </button>
      </div>
    </Modal>
  );
}
