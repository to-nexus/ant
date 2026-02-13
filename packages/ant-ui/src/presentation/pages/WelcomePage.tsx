import { useTranslation } from 'react-i18next';
import { Lightbulb, Code2, Users, ArrowRight } from 'lucide-react';
import { useStore } from '@/domain/store';

export interface WelcomePageProps {
  onSignUp: () => void;
  onSignIn: () => void;
}

export function WelcomePage({ onSignUp, onSignIn }: WelcomePageProps) {
  const { t } = useTranslation('onboarding');
  const theme = useStore((state) => state.theme);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-indigo-50 dark:from-[#0d1117] dark:via-[#161b22] dark:to-[#1a1040] transition-colors pt-16 flex flex-col">
      {/* Background decorative elements */}
      <div className="absolute inset-0 pt-16 overflow-hidden pointer-events-none">
        <div className="absolute top-32 left-1/4 w-72 h-72 bg-indigo-200/30 dark:bg-indigo-900/20 rounded-full blur-3xl" />
        <div className="absolute top-48 right-1/4 w-96 h-96 bg-purple-200/20 dark:bg-purple-900/15 rounded-full blur-3xl" />
        <div className="absolute bottom-32 left-1/3 w-80 h-80 bg-blue-200/20 dark:bg-blue-900/15 rounded-full blur-3xl" />
      </div>

      {/* Main content */}
      <div className="relative flex-1 flex flex-col items-center justify-center px-6">
        {/* Hero section */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          {/* Logo accent */}
          <div className="inline-flex items-center gap-2 px-4 py-2 mb-8 rounded-full bg-indigo-100/80 dark:bg-indigo-900/40 border border-indigo-200/60 dark:border-indigo-700/40">
            <img
              src={theme === 'dark' ? '/logo-dark.svg' : '/logo-light.svg'}
              alt="ANT"
              className="w-5 h-5"
            />
            <span className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">
              ANT Works
            </span>
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 dark:text-white leading-tight mb-6 whitespace-pre-line">
            {t('welcome.headline')}
          </h1>

          {/* Subheadline */}
          <p className="text-lg sm:text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            {t('welcome.subheadline')}
          </p>

          {/* CTA */}
          <div className="flex flex-col items-center gap-4">
            <button
              onClick={onSignUp}
              className="group inline-flex items-center gap-2 px-8 py-4 text-lg font-semibold text-white
                       bg-gradient-to-r from-indigo-600 to-purple-600
                       hover:from-indigo-700 hover:to-purple-700
                       dark:from-indigo-500 dark:to-purple-500
                       dark:hover:from-indigo-600 dark:hover:to-purple-600
                       rounded-xl shadow-lg hover:shadow-xl
                       transform hover:scale-[1.02] active:scale-[0.98]
                       transition-all duration-200"
            >
              {t('welcome.getStarted')}
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>

            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('welcome.alreadyHaveAccount')}{' '}
              <button
                onClick={onSignIn}
                className="font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 underline underline-offset-2 transition-colors"
              >
                {t('welcome.signIn')}
              </button>
            </p>
          </div>
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-4xl mx-auto w-full">
          <FeatureCard
            icon={<Lightbulb className="w-6 h-6" />}
            title={t('welcome.feature1')}
            description={t('welcome.feature1Desc')}
            accent="indigo"
          />
          <FeatureCard
            icon={<Code2 className="w-6 h-6" />}
            title={t('welcome.feature2')}
            description={t('welcome.feature2Desc')}
            accent="purple"
          />
          <FeatureCard
            icon={<Users className="w-6 h-6" />}
            title={t('welcome.feature3')}
            description={t('welcome.feature3Desc')}
            accent="blue"
          />
        </div>
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  accent: 'indigo' | 'purple' | 'blue';
}) {
  const accentStyles = {
    indigo: {
      bg: 'bg-indigo-100 dark:bg-indigo-900/40',
      text: 'text-indigo-600 dark:text-indigo-400',
      border: 'border-indigo-200/60 dark:border-indigo-700/30',
    },
    purple: {
      bg: 'bg-purple-100 dark:bg-purple-900/40',
      text: 'text-purple-600 dark:text-purple-400',
      border: 'border-purple-200/60 dark:border-purple-700/30',
    },
    blue: {
      bg: 'bg-blue-100 dark:bg-blue-900/40',
      text: 'text-blue-600 dark:text-blue-400',
      border: 'border-blue-200/60 dark:border-blue-700/30',
    },
  };

  const styles = accentStyles[accent];

  return (
    <div className={`p-6 rounded-xl bg-white/80 dark:bg-[#161b22]/80 backdrop-blur-sm border ${styles.border} shadow-sm hover:shadow-md transition-all duration-200`}>
      <div className={`inline-flex items-center justify-center w-12 h-12 rounded-lg ${styles.bg} ${styles.text} mb-4`}>
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
        {title}
      </h3>
      <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
        {description}
      </p>
    </div>
  );
}
