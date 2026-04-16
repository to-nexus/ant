import { motion } from 'framer-motion';
import { Check, Sparkles, Sun, Moon, SunMoon } from 'lucide-react';
import { Monitor, Server, Layers } from 'lucide-react';
import type { BasisOption } from '@ant/shared';
import { TECH_ICON_COMPONENTS, AutoDetectIcon } from './icons/TechIcons';
import { VisualPreview } from './icons/VisualPreviews';
import { ACCENT_COLORS, AUTO_DETECT_OPTION } from './constants';

interface VariantCardProps {
  option: BasisOption;
  isSelected: boolean;
  onClick: () => void;
  tierKey: 'techTier' | 'visualTier';
  layerKey: string;
  index: number;
  lang: 'en' | 'ko';
}

const STACK_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  frontend: Monitor,
  backend: Server,
  fullstack: Layers,
};

function VisualTierCard({ option, isSelected, onClick, index, lang, layerKey }: Omit<VariantCardProps, 'tierKey'>) {
  const accent = ACCENT_COLORS[option.accentColor ?? 'gray'] ?? ACCENT_COLORS.gray;
  const isAuto = option.id === AUTO_DETECT_OPTION.id;

  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.25 }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      className={`
        relative w-full text-left rounded-xl overflow-hidden transition-all duration-150
        border-2 cursor-pointer flex flex-col
        ${isSelected
          ? `border-current ${accent.text} ring-2 ring-offset-2 ${accent.ring} ring-offset-white dark:ring-offset-[#161b22]`
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-lg'
        }
      `}
    >
      {isSelected && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className={`absolute top-2 right-2 z-10 w-5 h-5 rounded-full flex items-center justify-center ${accent.text} bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm`}
        >
          <Check className="w-3.5 h-3.5" strokeWidth={3} />
        </motion.div>
      )}

      <div className="relative w-full bg-gray-100 dark:bg-gray-800">
        {isAuto ? (
          <div className="w-full aspect-[2/1] flex items-center justify-center bg-gray-50 dark:bg-gray-800/80">
            <AutoDetectIcon className="w-10 h-10 text-gray-300 dark:text-gray-600" />
          </div>
        ) : (
          <VisualPreview
            layer={layerKey as 'visualLanguage' | 'surfaceSystem' | 'spatialSystem'}
            variant={option.id}
            size="full"
          />
        )}
        {layerKey === 'visualLanguage' && option.supportedModes && !isAuto && (
          <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/60 backdrop-blur-sm text-white text-[10px] font-medium">
            {option.supportedModes === 'both' && <SunMoon className="w-3 h-3" />}
            {option.supportedModes === 'dark' && <Moon className="w-3 h-3" />}
            {option.supportedModes === 'light' && <Sun className="w-3 h-3" />}
            <span>
              {option.supportedModes === 'both' ? 'Dual' : option.supportedModes === 'dark' ? 'Dark' : 'Light'}
            </span>
          </div>
        )}
      </div>

      <div className={`px-3 py-2.5 ${isSelected ? accent.bg : 'bg-white dark:bg-gray-800/50'}`}>
        <p className={`text-sm font-semibold ${
          isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'
        }`}>
          {option.label[lang] ?? option.label.en}
        </p>
        {option.description && (
          <p className={`text-[11px] mt-0.5 line-clamp-1 ${
            isSelected ? 'text-gray-600 dark:text-gray-300' : 'text-gray-500 dark:text-gray-400'
          }`}>
            {option.description[lang] ?? option.description.en}
          </p>
        )}
      </div>
    </motion.button>
  );
}

export function VariantCard({ option, isSelected, onClick, tierKey, layerKey, index, lang }: VariantCardProps) {
  if (tierKey === 'visualTier') {
    return (
      <VisualTierCard
        option={option}
        isSelected={isSelected}
        onClick={onClick}
        index={index}
        lang={lang}
        layerKey={layerKey}
      />
    );
  }

  const isAuto = option.id === AUTO_DETECT_OPTION.id;
  const accent = ACCENT_COLORS[option.accentColor ?? 'gray'] ?? ACCENT_COLORS.gray;

  const renderIcon = () => {
    if (isAuto) {
      return <AutoDetectIcon className="w-6 h-6 text-gray-400 dark:text-gray-500" />;
    }

    if (layerKey === 'stack') {
      const StackIcon = STACK_ICONS[option.id];
      if (StackIcon) return <StackIcon className={`w-6 h-6 ${accent.text}`} />;
    }

    const TechIcon = TECH_ICON_COMPONENTS[option.id];
    if (TechIcon) return <TechIcon className="w-7 h-7" />;

    return <Sparkles className={`w-6 h-6 ${accent.text}`} />;
  };

  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.2 }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={`
        relative w-full text-left rounded-xl p-4 transition-all duration-150
        border-2 cursor-pointer
        ${isSelected
          ? `${accent.bg} border-current ${accent.text} ring-2 ring-offset-2 ${accent.ring} ring-offset-white dark:ring-offset-[#161b22]`
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800/50 hover:shadow-md'
        }
      `}
    >
      {isSelected && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className={`absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center ${accent.text}`}
        >
          <Check className="w-3.5 h-3.5" strokeWidth={3} />
        </motion.div>
      )}

      <div className="flex flex-col gap-2.5">
        <div className="shrink-0">
          {renderIcon()}
        </div>
        <div className="min-w-0">
          <p className={`text-sm font-semibold ${
            isSelected
              ? 'text-gray-900 dark:text-white'
              : 'text-gray-700 dark:text-gray-300'
          }`}>
            {option.label[lang] ?? option.label.en}
          </p>
          {option.description && (
            <p className={`text-xs mt-0.5 line-clamp-2 ${
              isSelected
                ? 'text-gray-600 dark:text-gray-300'
                : 'text-gray-500 dark:text-gray-400'
            }`}>
              {option.description[lang] ?? option.description.en}
            </p>
          )}
        </div>
      </div>
    </motion.button>
  );
}
