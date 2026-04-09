import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { ACTION_DEFINITIONS, type ActionId, type ActionReadiness } from '@ant/shared';
import { MaterialsSection } from './MaterialsSection';
import { OutputsSection } from './OutputsSection';
import { ActionFooter } from './ActionFooter';
import { ActionModeIndicator } from './ActionModeIndicator';
import { ACTION_VISUALS } from './ActionChip';
import { ChevronLeft, AlertCircle } from 'lucide-react';

interface ActionDetailViewProps {
  actionId: ActionId;
  readiness: ActionReadiness;
  onBack: () => void;
}

export function ActionDetailView({ actionId, readiness, onBack }: ActionDetailViewProps) {
  const { i18n } = useTranslation('actions');
  const lang = i18n.language as 'en' | 'ko';
  const selectedSubModeId = useStore(s => s.selectedSubModeId);

  const def = ACTION_DEFINITIONS.find(d => d.id === actionId);
  if (!def) return null;

  const visual = ACTION_VISUALS[actionId];
  const Icon = visual.icon;
  const isComingSoon = def.status === 'coming-soon';

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Back + Title inline */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
            aria-label="Back"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${visual.bg}`}>
            <Icon className={`w-3.5 h-3.5 ${visual.text}`} />
          </div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white truncate">
            {def.label[lang] || def.label.en}
          </h2>
          {isComingSoon && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 shrink-0">
              Coming soon
            </span>
          )}
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400 -mt-2 ml-[3.25rem]">
          {def.description[lang] || def.description.en}
        </p>

        {isComingSoon ? (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
            <AlertCircle className="w-5 h-5 text-gray-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {lang === 'ko' ? '이 기능은 현재 개발 중입니다' : 'This feature is currently under development'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {lang === 'ko' ? '사용을 권장하지 않습니다. 추후 업데이트에서 제공될 예정입니다.' : 'Usage is not recommended. It will be available in a future update.'}
              </p>
            </div>
          </div>
        ) : (
          <>
            <ActionModeIndicator
              actionId={actionId}
              readiness={readiness}
              selectedSubModeId={selectedSubModeId}
            />

            {readiness.materials.length > 0 && (
              <MaterialsSection
                materials={readiness.materials}
                namingIssues={readiness.namingIssues}
              />
            )}

            <OutputsSection
              outputDir={readiness.outputDir}
              hasOutput={readiness.hasOutput}
            />
          </>
        )}
      </div>

      <ActionFooter actionId={actionId} readiness={readiness} disabled={isComingSoon} />
    </div>
  );
}
