import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import {
  type BasisSlotConfig,
  type VisualTier,
  TECH_TIER_LANGUAGES,
  VALID_LANGUAGES_BY_STACK,
  SUPPORTED_STACKS,
  FRAMEWORK_NONE,
  buildBasisPreset,
  getFrameworkOptions,
  getFullstackLanguages,
  VISUAL_LANGUAGE_OPTIONS,
  SURFACE_SYSTEM_OPTIONS,
  SPATIAL_SYSTEM_OPTIONS,
  INTERACTION_GRAMMAR_OPTIONS,
  VISUAL_HIERARCHY_RULES_OPTIONS,
  deriveInteractionGrammar,
  deriveVisualHierarchyRules,
  type SupportedLanguage,
  type SupportedStack,
  type TechTierKey,
} from '@ant/shared';
import { Settings2, Palette } from 'lucide-react';

interface BasisSelectorProps {
  basisSlot: BasisSlotConfig;
  lang: 'en' | 'ko';
}

const STACK_LABELS: Record<string, { en: string; ko: string }> = {
  frontend: { en: 'Frontend', ko: 'Frontend' },
  backend: { en: 'Backend', ko: 'Backend' },
  fullstack: { en: 'Fullstack', ko: 'Fullstack' },
};

export function BasisSelector({ basisSlot, lang }: BasisSelectorProps) {
  const { t } = useTranslation('actions');
  const actionMetadata = useStore(s => s.actionMetadata);
  const updateActionMetadata = useStore(s => s.updateActionMetadata);

  const defaultStack = basisSlot.defaults?.stack;
  const currentBasis = actionMetadata.basis;
  const selectedStack = (currentBasis?.techTier?.stack ?? defaultStack ?? '') as SupportedStack | '';

  const isFullstack = selectedStack === 'fullstack';

  const selectedFeLang = currentBasis?.techTier?.frontend?.language ?? '';
  const selectedBeLang = currentBasis?.techTier?.backend?.language ?? '';
  const selectedFeFw = currentBasis?.techTier?.frontend?.framework ?? '';
  const selectedBeFw = currentBasis?.techTier?.backend?.framework ?? '';

  const selectedLanguage = isFullstack ? '' : (selectedFeLang || selectedBeLang);
  const selectedFramework = isFullstack ? '' : (selectedFeFw || selectedBeFw);

  const stackOptions = SUPPORTED_STACKS;

  const languageOptions = useMemo(() => {
    if (!selectedStack) return TECH_TIER_LANGUAGES;
    return TECH_TIER_LANGUAGES.filter(opt =>
      (VALID_LANGUAGES_BY_STACK[selectedStack as SupportedStack] as readonly string[])?.includes(opt.id),
    );
  }, [selectedStack]);

  const frameworkOptions = useMemo(() => {
    if (!selectedLanguage || !selectedStack || isFullstack) return [];
    const tierKey: TechTierKey = selectedStack === 'fullstack' ? 'frontend' : selectedStack as TechTierKey;
    return getFrameworkOptions(tierKey, selectedLanguage as SupportedLanguage);
  }, [selectedLanguage, selectedStack, isFullstack]);

  const feFrameworkOptions = useMemo(() => {
    if (!isFullstack) return [];
    return getFrameworkOptions('frontend', 'typescript');
  }, [isFullstack]);

  const beFrameworkOptions = useMemo(() => {
    if (!isFullstack) return [];
    return getFrameworkOptions('backend', 'typescript');
  }, [isFullstack]);

  const currentVisualTier: Partial<VisualTier> = currentBasis?.visualTier ?? {};

  const derivedInteractionGrammar = useMemo(() => {
    if (!currentVisualTier.visualLanguage) return undefined;
    return deriveInteractionGrammar(currentVisualTier.visualLanguage);
  }, [currentVisualTier.visualLanguage]);

  const derivedVisualHierarchy = useMemo(() => {
    if (!currentVisualTier.visualLanguage || !currentVisualTier.spatialSystem) return undefined;
    return deriveVisualHierarchyRules(currentVisualTier.visualLanguage, currentVisualTier.spatialSystem);
  }, [currentVisualTier.visualLanguage, currentVisualTier.spatialSystem]);

  const buildAndUpdate = useCallback(
    (nextStack: string, tiers: Record<string, { language?: string; framework?: string }>, designSystem?: string, visualTier?: Partial<VisualTier>) => {
      const basis = buildBasisPreset({
        stack: nextStack || undefined,
        tiers: Object.keys(tiers).length > 0 ? tiers : undefined,
        designSystem: designSystem || undefined,
        visualTier: visualTier || undefined,
      });
      const hasAnyValue = basis.techTier || basis.visualTier;
      updateActionMetadata({ basis: hasAnyValue ? basis : undefined });
    },
    [updateActionMetadata],
  );

  const updateBasis = useCallback(
    (patch: { stack?: string; language?: string; framework?: string; designSystem?: string;
              feFw?: string; beFw?: string; visualTier?: Partial<VisualTier> }) => {
      const nextStack = patch.stack ?? selectedStack;
      const ds = patch.designSystem ?? currentBasis?.visualTier?.designSystem ?? '';
      const nextVisualTier = patch.visualTier
        ? { ...currentVisualTier, ...patch.visualTier }
        : currentVisualTier;

      if (nextStack === 'fullstack') {
        const fullstackLangs = getFullstackLanguages();
        const fixedLang = fullstackLangs[0] ?? 'typescript';
        const feFw = patch.feFw ?? selectedFeFw;
        const beFw = patch.beFw ?? selectedBeFw;

        if (patch.stack !== undefined) {
          buildAndUpdate(nextStack, {
            frontend: { language: fixedLang },
            backend: { language: fixedLang },
          }, ds, nextVisualTier);
        } else {
          const feVal = feFw === FRAMEWORK_NONE ? FRAMEWORK_NONE : (feFw || undefined);
          const beVal = beFw === FRAMEWORK_NONE ? FRAMEWORK_NONE : (beFw || undefined);
          buildAndUpdate(nextStack, {
            frontend: { language: fixedLang, framework: feVal },
            backend: { language: fixedLang, framework: beVal },
          }, ds, nextVisualTier);
        }
        return;
      }

      let nextLang = patch.language ?? selectedLanguage;
      let nextFw = patch.language !== undefined
        ? ''
        : (patch.framework !== undefined ? patch.framework : selectedFramework);

      if (patch.stack !== undefined) {
        nextLang = '';
        nextFw = '';
      }

      const tierKey = (nextStack === 'frontend' || nextStack === 'backend') ? nextStack : '';
      if (!tierKey) {
        buildAndUpdate(nextStack, nextLang ? {
          frontend: { language: nextLang, framework: nextFw === FRAMEWORK_NONE ? FRAMEWORK_NONE : (nextFw || undefined) },
        } : {}, ds, nextVisualTier);
        return;
      }

      const fwValue = nextFw === FRAMEWORK_NONE ? FRAMEWORK_NONE : (nextFw || undefined);
      buildAndUpdate(nextStack, nextLang ? {
        [tierKey]: { language: nextLang, framework: fwValue },
      } : {}, ds, nextVisualTier);
    },
    [selectedStack, selectedLanguage, selectedFramework, selectedFeFw, selectedBeFw, currentBasis, currentVisualTier, buildAndUpdate],
  );

  useEffect(() => {
    if (defaultStack && !currentBasis?.techTier?.stack) {
      updateBasis({ stack: defaultStack });
    }
  }, [defaultStack]);

  const showTechTier = !!basisSlot.techTier;
  const showVisualTier = !!basisSlot.visualTier;
  const hasStackSelector = showTechTier && !defaultStack;

  if (!showTechTier && !showVisualTier) return null;

  const selectClass =
    'w-full text-xs px-2.5 py-1.5 rounded-md border bg-white dark:bg-gray-800 ' +
    'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 ' +
    'focus:outline-none focus:ring-1 focus:ring-blue-400 dark:focus:ring-blue-500';

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
        <Settings2 className="w-3.5 h-3.5 text-violet-500 dark:text-violet-400" />
        {t('basis.title')}
        <span className="text-[10px] font-normal text-gray-400 dark:text-gray-500 ml-0.5">
          {t('section.optional')}
        </span>
      </h3>

      <div className="grid grid-cols-2 gap-2">
        {showTechTier && (
          <>
            {hasStackSelector && (
              <div className="space-y-1 col-span-2">
                <label className="text-[11px] text-gray-500 dark:text-gray-400">
                  Stack
                </label>
                <select
                  className={selectClass}
                  value={selectedStack}
                  onChange={e => updateBasis({ stack: e.target.value })}
                >
                  <option value="">{t('basis.autoDetect')}</option>
                  {stackOptions.map(s => (
                    <option key={s} value={s}>
                      {STACK_LABELS[s]?.[lang] || s}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {isFullstack ? (
              <>
                <div className="space-y-1 col-span-2">
                  <label className="text-[11px] text-gray-500 dark:text-gray-400">
                    {t('basis.language')}
                  </label>
                  <select className={selectClass} value="typescript" disabled>
                    <option value="typescript">TypeScript</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-gray-500 dark:text-gray-400">
                    Frontend Framework
                    <span className="text-gray-400 dark:text-gray-500 ml-0.5">({t('section.optional')})</span>
                  </label>
                  <select
                    className={selectClass}
                    value={selectedFeFw}
                    onChange={e => updateBasis({ feFw: e.target.value })}
                  >
                    <option value="">{t('basis.autoDetect')}</option>
                    <option value={FRAMEWORK_NONE}>{t('basis.noFramework')}</option>
                    {feFrameworkOptions.map(opt => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label[lang] || opt.label.en}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-gray-500 dark:text-gray-400">
                    Backend Framework
                    <span className="text-gray-400 dark:text-gray-500 ml-0.5">({t('section.optional')})</span>
                  </label>
                  <select
                    className={selectClass}
                    value={selectedBeFw}
                    onChange={e => updateBasis({ beFw: e.target.value })}
                  >
                    <option value="">{t('basis.autoDetect')}</option>
                    <option value={FRAMEWORK_NONE}>{t('basis.noFramework')}</option>
                    {beFrameworkOptions.map(opt => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label[lang] || opt.label.en}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <label className="text-[11px] text-gray-500 dark:text-gray-400">
                    {t('basis.language')}
                  </label>
                  <select
                    className={selectClass}
                    value={selectedLanguage}
                    onChange={e => updateBasis({ language: e.target.value })}
                    disabled={!selectedStack}
                  >
                    <option value="">{t('basis.autoDetect')}</option>
                    {languageOptions.map(opt => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label[lang] || opt.label.en}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-gray-500 dark:text-gray-400">
                    {t('basis.framework')}
                    <span className="text-gray-400 dark:text-gray-500 ml-0.5">({t('section.optional')})</span>
                  </label>
                  <select
                    className={selectClass}
                    value={selectedFramework}
                    onChange={e => updateBasis({ framework: e.target.value })}
                    disabled={!selectedLanguage || frameworkOptions.length === 0}
                  >
                    <option value="">{t('basis.autoDetect')}</option>
                    <option value={FRAMEWORK_NONE}>{t('basis.noFramework')}</option>
                    {frameworkOptions.map(opt => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label[lang] || opt.label.en}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </>
        )}

        {showVisualTier && (
          <>
            <div className="col-span-2 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
              <h4 className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 flex items-center gap-1 mb-2">
                <Palette className="w-3 h-3 text-violet-400" />
                {t('basis.visualDesignPolicy', 'Visual Design Policy')}
                <span className="text-[10px] font-normal text-gray-400 dark:text-gray-500 ml-0.5">
                  ({t('section.optional')})
                </span>
              </h4>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-gray-500 dark:text-gray-400">
                {t('basis.visualLanguage', 'Visual Language')}
              </label>
              <select
                className={selectClass}
                value={currentVisualTier.visualLanguage ?? ''}
                onChange={e => updateBasis({ visualTier: { visualLanguage: (e.target.value || undefined) as any } })}
              >
                <option value="">{t('basis.autoDetect')}</option>
                {VISUAL_LANGUAGE_OPTIONS.map(opt => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label[lang] || opt.label.en}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-gray-500 dark:text-gray-400">
                {t('basis.surfaceSystem', 'Surface System')}
              </label>
              <select
                className={selectClass}
                value={currentVisualTier.surfaceSystem ?? ''}
                onChange={e => updateBasis({ visualTier: { surfaceSystem: (e.target.value || undefined) as any } })}
              >
                <option value="">{t('basis.autoDetect')}</option>
                {SURFACE_SYSTEM_OPTIONS.map(opt => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label[lang] || opt.label.en}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1 col-span-2">
              <label className="text-[11px] text-gray-500 dark:text-gray-400">
                {t('basis.spatialSystem', 'Spatial System')}
              </label>
              <select
                className={selectClass}
                value={currentVisualTier.spatialSystem ?? ''}
                onChange={e => updateBasis({ visualTier: { spatialSystem: (e.target.value || undefined) as any } })}
              >
                <option value="">{t('basis.autoDetect')}</option>
                {SPATIAL_SYSTEM_OPTIONS.map(opt => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label[lang] || opt.label.en}
                  </option>
                ))}
              </select>
            </div>

            {(derivedInteractionGrammar || derivedVisualHierarchy) && (
              <div className="col-span-2 space-y-1">
                <label className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                  {t('basis.derivedLayers', 'Derived Layers')}
                </label>
                <div className="text-[11px] text-gray-500 dark:text-gray-400 space-y-0.5">
                  {derivedInteractionGrammar && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-400">Interaction:</span>
                      <span className="text-gray-600 dark:text-gray-300">
                        {INTERACTION_GRAMMAR_OPTIONS.find(o => o.id === derivedInteractionGrammar)?.label[lang] ?? derivedInteractionGrammar}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-400">Semantics:</span>
                    <span className="text-gray-500 dark:text-gray-400 italic">
                      {t('basis.derivedAtRuntime', 'Determined at runtime')}
                    </span>
                  </div>
                  {derivedVisualHierarchy && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-400">Hierarchy:</span>
                      <span className="text-gray-600 dark:text-gray-300">
                        {VISUAL_HIERARCHY_RULES_OPTIONS.find(o => o.id === derivedVisualHierarchy)?.label[lang] ?? derivedVisualHierarchy}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
