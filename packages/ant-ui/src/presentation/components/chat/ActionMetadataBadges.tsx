import { useStore } from '@/domain/store';
import { useTranslation } from 'react-i18next';
import { INTENT_DEFINITIONS, getAvailableBases, type ActionMetadata } from '@ant/shared';
import { X, Target, Crosshair, FileText, Layers, BookOpen, Zap } from 'lucide-react';

interface BadgeProps {
  icon: any;
  label: string;
  value: string;
  color: string;
  onRemove?: () => void;
}

function Badge({ icon: Icon, label, value, color, onRemove }: BadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs font-medium border transition-colors ${color}`}>
      <Icon className="w-3 h-3 shrink-0" />
      <span className="truncate max-w-[120px]">{value}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 p-0.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
          aria-label={`Remove ${label}`}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}

interface ActionMetadataBadgesProps {
  metadata?: ActionMetadata;
  readOnly?: boolean;
}

export function ActionMetadataBadges({ metadata, readOnly = false }: ActionMetadataBadgesProps) {
  const { i18n } = useTranslation();
  const lang = i18n.language as 'en' | 'ko';
  const updateActionMetadata = useStore(s => s.updateActionMetadata);
  const resetActionMetadata = useStore(s => s.resetActionMetadata);
  const setActionsStep = useStore(s => s.setActionsStep);
  const selectedActionId = useStore(s => s.selectedActionId);
  const storeMetadata = useStore(s => s.actionMetadata);

  const meta = metadata || storeMetadata;

  const hasAnything = meta.explicit || meta.intent || meta.basis
    || (meta.target && meta.target.length > 0)
    || (meta.refs && meta.refs.length > 0)
    || (meta.context && meta.context.length > 0);
  if (!hasAnything) return null;

  const intentDef = meta.intent ? INTENT_DEFINITIONS.find(d => d.id === meta.intent) : null;
  const intentLabel = intentDef ? (intentDef.label[lang] || intentDef.label.en) : meta.intent;

  const handleRemoveExplicit = () => {
    if (readOnly) return;
    updateActionMetadata({ explicit: undefined });
  };

  const handleRemoveIntent = () => {
    if (readOnly) return;
    resetActionMetadata();
    if (selectedActionId) {
      setActionsStep('pick-intent');
    } else {
      setActionsStep('pick-action');
    }
  };

  const handleRemoveBasis = () => {
    if (readOnly) return;
    updateActionMetadata({ explicit: undefined, basis: undefined, refs: undefined, context: undefined });
  };

  const handleRemoveRef = (ref: string) => {
    if (readOnly) return;
    updateActionMetadata({ explicit: undefined, refs: meta.refs?.filter(r => r !== ref) });
  };

  const handleRemoveContext = (ctx: string) => {
    if (readOnly) return;
    updateActionMetadata({ explicit: undefined, context: meta.context?.filter(c => c !== ctx) });
  };

  const handleRemoveTarget = (tgt: string) => {
    if (readOnly) return;
    updateActionMetadata({ explicit: undefined, target: meta.target?.filter(t => t !== tgt) });
  };

  const basisLabels: Record<string, { en: string; ko: string }> = {
    prd: { en: 'PRD', ko: 'PRD' },
    directive: { en: 'Directive', ko: '지시사항' },
    'existing-doc': { en: 'Existing Doc', ko: '기존 문서' },
    figma: { en: 'Figma', ko: 'Figma' },
    references: { en: 'References', ko: '레퍼런스' },
  };

  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-2 pb-1">
      {meta.explicit && (
        <span className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs font-semibold border transition-colors
          bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300`}>
          <Zap className="w-3 h-3 shrink-0" />
          <span>Explicit</span>
          {!readOnly && (
            <button
              type="button"
              onClick={handleRemoveExplicit}
              className="ml-0.5 p-0.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
              aria-label="Remove explicit"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </span>
      )}

      {meta.intent && intentLabel && (
        <Badge
          icon={Target}
          label="intent"
          value={intentLabel}
          color="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300"
          onRemove={readOnly ? undefined : handleRemoveIntent}
        />
      )}

      {meta.target?.map(tgt => (
        <Badge
          key={tgt}
          icon={Crosshair}
          label="target"
          value={tgt.split('/').pop() || tgt}
          color="bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-300"
          onRemove={readOnly ? undefined : () => handleRemoveTarget(tgt)}
        />
      ))}

      {meta.basis && (!meta.intent || getAvailableBases(meta.intent).length > 1) && (
        <Badge
          icon={Layers}
          label="basis"
          value={basisLabels[meta.basis]?.[lang] || meta.basis}
          color="bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300"
          onRemove={readOnly ? undefined : handleRemoveBasis}
        />
      )}

      {meta.refs?.map(ref => (
        <Badge
          key={ref}
          icon={FileText}
          label="ref"
          value={ref.split('/').pop() || ref}
          color="bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
          onRemove={readOnly ? undefined : () => handleRemoveRef(ref)}
        />
      ))}

      {meta.context?.map(ctx => (
        <Badge
          key={ctx}
          icon={BookOpen}
          label="ctx"
          value={ctx.split('/').pop() || ctx}
          color="bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400"
          onRemove={readOnly ? undefined : () => handleRemoveContext(ctx)}
        />
      ))}
    </div>
  );
}
