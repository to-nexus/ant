import { AlertTriangle } from 'lucide-react';

interface DangerZoneSectionProps {
  title: string;
  description: string;
  buttonText: string;
  loadingText?: string;
  isLoading?: boolean;
  onAction: () => void | Promise<void>;
}

export function DangerZoneSection({
  title,
  description,
  buttonText,
  loadingText,
  isLoading = false,
  onAction,
}: DangerZoneSectionProps) {
  return (
    <div className="border-2 border-red-200 dark:border-red-900/50 rounded-lg p-6 bg-red-50/50 dark:bg-red-950/20">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
        </div>
        <div className="flex-1">
          <h4 className="text-base font-semibold text-red-900 dark:text-red-100 mb-2">
            {title}
          </h4>
          <p className="text-sm text-red-700 dark:text-red-300 mb-4">
            {description}
          </p>
          <button
            onClick={onAction}
            disabled={isLoading}
            className="px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200
                       bg-red-600 hover:bg-red-700 text-white
                       disabled:opacity-50 disabled:cursor-not-allowed
                       hover:shadow-md"
          >
            {isLoading ? (loadingText || buttonText) : buttonText}
          </button>
        </div>
      </div>
    </div>
  );
}
