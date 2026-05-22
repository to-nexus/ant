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

const PATHS = [
  {
    id: 'plan' as const,
    icon: Sparkles,
    gradient: 'from-emerald-50 to-teal-50',
    border: 'border-emerald-200 hover:border-emerald-300',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-600',
    hintColor: 'text-emerald-600/70',
  },
  // TEMP(action-system-compat): hide design/code entries until ProjectWizardModal is compatible with the new action system.
  // {
  //   id: 'design' as const,
  //   icon: Compass,
  //   gradient: 'from-indigo-50 to-purple-50',
  //   border: 'border-indigo-200/60 hover:border-indigo-300',
  //   iconBg: 'bg-indigo-100',
  //   iconColor: 'text-indigo-500',
  //   hintColor: 'text-indigo-500/70',
  // },
  // {
  //   id: 'code' as const,
  //   icon: Code2,
  //   gradient: 'from-amber-50 to-orange-50',
  //   border: 'border-amber-200/60 hover:border-amber-300',
  //   iconBg: 'bg-amber-100',
  //   iconColor: 'text-amber-500',
  //   hintColor: 'text-amber-500/70',
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
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3.5 text-left rounded-xl border',
                'bg-gradient-to-r transition-all duration-200 hover:shadow-sm group',
                p.gradient,
                p.border,
              )}
            >
              <div className={cn(
                'flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0',
                'group-hover:scale-105 transition-transform',
                p.iconBg,
              )}>
                <Icon className={cn('w-4.5 h-4.5', p.iconColor)} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-[color:var(--text-1)]">
                  {titleKey(p.id)}
                </div>
                <div className={cn('text-xs mt-0.5', p.hintColor)}>
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
            'hover:border-gray-300 transition-all duration-200 hover:shadow-sm group',
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
            <div className="text-xs mt-0.5 text-gray-500/70">
              {t('quickstart.creationModal.createEmptyHint')}
            </div>
          </div>
        </button>
      </div>
    </Modal>
  );
}
