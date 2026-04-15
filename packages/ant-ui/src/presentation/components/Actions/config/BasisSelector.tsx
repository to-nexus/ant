import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import {
  type BasisSlotConfig,
  TECH_TIER_LANGUAGES,
  VISUAL_TIER_DESIGN_SYSTEMS,
  VALID_LANGUAGES_BY_STACK,
  SUPPORTED_STACKS,
  FRAMEWORK_NONE,
  buildBasisPreset,
  getFrameworkOptions,
  getFullstackLanguages,
  type SupportedLanguage,
  type SupportedStack,
  type TechTierKey,
} from '@ant/shared';
import { Settings2 } from 'lucide-react';

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

  const buildAndUpdate = useCallback(
    (nextStack: string, tiers: Record<string, { language?: string; framework?: string }>, designSystem?: string) => {
      const basis = buildBasisPreset({
        stack: nextStack || undefined,
        tiers: Object.keys(tiers).length > 0 ? tiers : undefined,
        designSystem: designSystem || undefined,
      });
      const hasAnyValue = basis.techTier || basis.visualTier;
      updateActionMetadata({ basis: hasAnyValue ? basis : undefined });
    },
    [updateActionMetadata],
  );

  const updateBasis = useCallback(
    (patch: { stack?: string; language?: string; framework?: string; designSystem?: string;
              feFw?: string; beFw?: string }) => {
      const nextStack = patch.stack ?? selectedStack;
      const ds = patch.designSystem ?? currentBasis?.visualTier?.designSystem ?? '';

      if (nextStack === 'fullstack') {
        const fullstackLangs = getFullstackLanguages();
        const fixedLang = fullstackLangs[0] ?? 'typescript';
        const feFw = patch.feFw ?? selectedFeFw;
        const beFw = patch.beFw ?? selectedBeFw;

        if (patch.stack !== undefined) {
          buildAndUpdate(nextStack, {
            frontend: { language: fixedLang },
            backend: { language: fixedLang },
          }, ds);
        } else {
          const feVal = feFw === FRAMEWORK_NONE ? FRAMEWORK_NONE : (feFw || undefined);
          const beVal = beFw === FRAMEWORK_NONE ? FRAMEWORK_NONE : (beFw || undefined);
          buildAndUpdate(nextStack, {
            frontend: { language: fixedLang, framework: feVal },
            backend: { language: fixedLang, framework: beVal },
          }, ds);
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
        } : {}, ds);
        return;
      }

      const fwValue = nextFw === FRAMEWORK_NONE ? FRAMEWORK_NONE : (nextFw || undefined);
      buildAndUpdate(nextStack, nextLang ? {
        [tierKey]: { language: nextLang, framework: fwValue },
      } : {}, ds);
    },
    [selectedStack, selectedLanguage, selectedFramework, selectedFeFw, selectedBeFw, currentBasis, buildAndUpdate],
  );

  useEffect(() => {
    if (defaultStack && !currentBasis?.techTier?.stack) {
      updateBasis({ stack: defaultStack });
    }
  }, [defaultStack]);

  const showTechTier = !!basisSlot.techTier;
  const showVisualTier = !!basisSlot.visualTier && VISUAL_TIER_DESIGN_SYSTEMS.length > 0;
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
          <div className="space-y-1 col-span-2">
            <label className="text-[11px] text-gray-500 dark:text-gray-400">
              {t('basis.designSystem')}
            </label>
            <select
              className={selectClass}
              value={currentBasis?.visualTier?.designSystem ?? ''}
              onChange={e => updateBasis({ designSystem: e.target.value })}
            >
              <option value="">{t('basis.autoDetect')}</option>
              {VISUAL_TIER_DESIGN_SYSTEMS.map(opt => (
                <option key={opt.id} value={opt.id}>
                  {opt.label[lang] || opt.label.en}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
