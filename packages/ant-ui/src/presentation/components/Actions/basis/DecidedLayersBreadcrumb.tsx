import { motion, AnimatePresence } from 'framer-motion';
import type { BasisWizardState, WizardStepDef } from './types';

interface DecidedLayersBreadcrumbProps {
  steps: WizardStepDef[];
  state: BasisWizardState;
  // Only interactionGrammar is a pure function of visualLanguage and can be
  // previewed in the wizard. visualHierarchyRules depends on spatialSystem,
  // which is decided at decompose time — so it is not shown here.
  derivedLayers?: {
    interactionGrammar?: string;
  };
  lang: 'en' | 'ko';
}

function getLayerValue(state: BasisWizardState, layerKey: string): string | undefined {
  const sel = state.selections;
  if (state.activeTier === 'techTier') {
    switch (layerKey) {
      case 'stack': return sel.techTier.stack;
      case 'language': return sel.techTier.language;
      case 'framework':
        if (sel.techTier.stack === 'fullstack') {
          const parts: string[] = [];
          if (sel.techTier.feFramework) parts.push(sel.techTier.feFramework);
          if (sel.techTier.beFramework) parts.push(sel.techTier.beFramework);
          return parts.length > 0 ? parts.join(' + ') : undefined;
        }
        return sel.techTier.framework;
    }
  }
  return (sel.visualTier as any)[layerKey];
}

export function DecidedLayersBreadcrumb({ steps, state, derivedLayers, lang }: DecidedLayersBreadcrumbProps) {
  const pills: { key: string; label: string; stepLabel?: string; isAuto?: boolean }[] = [];

  for (const step of steps) {
    const val = getLayerValue(state, step.layerKey);
    if (val) {
      pills.push({ key: step.id, label: val, stepLabel: step.title[lang] ?? step.title.en });
    }
  }

  if (state.activeTier === 'visualTier' && derivedLayers) {
    if (derivedLayers.interactionGrammar) {
      pills.push({ key: 'ig', label: derivedLayers.interactionGrammar, isAuto: true });
    }
  }

  if (pills.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 px-1 py-1.5 overflow-x-auto scrollbar-hide">
      <AnimatePresence mode="popLayout">
        {pills.map(pill => (
          <motion.span
            key={pill.key}
            initial={{ opacity: 0, x: -8, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.2 }}
            className={`
              inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0
              ${pill.isAuto
                ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
                : 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400'
              }
            `}
          >
            {pill.stepLabel && <span className="text-[10px] opacity-60">{pill.stepLabel}:</span>}
            <span className="capitalize">{pill.label}</span>
            {pill.isAuto && (
              <span className="text-[9px] text-gray-400 dark:text-gray-600 uppercase">auto</span>
            )}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
