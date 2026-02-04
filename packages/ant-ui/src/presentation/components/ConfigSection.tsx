import { ReactNode } from 'react';

/**
 * ConfigSection - Unified layout component for account configuration sections
 * 
 * Provides consistent layout across all config sections:
 * - Left: Icon (fixed width)
 * - Center: Title + Status badge + Description
 * - Right: Action controls
 */

interface StatusBadgeProps {
  status: 'configured' | 'not-configured' | 'checking';
  label?: string;
}

function StatusBadge({ status, label }: StatusBadgeProps) {
  if (status === 'checking') {
    return (
      <span className="text-xs text-gray-500 dark:text-gray-400">
        Checking...
      </span>
    );
  }

  const isConfigured = status === 'configured';
  
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${
      isConfigured 
        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' 
        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
    }`}>
      {label || (isConfigured ? '✓ Configured' : 'Not configured')}
    </span>
  );
}

export interface ConfigSectionProps {
  /** Icon element (SVG) */
  icon: ReactNode;
  /** Section title */
  title: string;
  /** Short description */
  description: string;
  /** Status indicator */
  status?: {
    state: 'configured' | 'not-configured' | 'checking';
    label?: string;
  };
  /** Main control area content */
  children: ReactNode;
  /** Footer hint text */
  hint?: ReactNode;
}

export function ConfigSection({
  icon,
  title,
  description,
  status,
  children,
  hint,
}: ConfigSectionProps) {
  return (
    <div className="flex gap-6">
      {/* Left: Icon - fixed width for alignment */}
      <div className="flex-shrink-0 w-20 h-20 flex items-center justify-center">
        {icon}
      </div>
      
      {/* Right: Content area */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Header: Title + Status */}
        <div className="flex items-center gap-3">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
            {title}
          </h4>
          {status && (
            <StatusBadge status={status.state} label={status.label} />
          )}
        </div>
        
        {/* Description */}
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {description}
        </p>
        
        {/* Controls area */}
        <div className="space-y-3">
          {children}
        </div>
        
        {/* Hint */}
        {hint && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================
// Pre-built Icons for common integrations
// ============================================

export const ConfigIcons = {
  /** Local Backend server icon */
  LocalBackend: () => (
    <svg className="w-16 h-16 text-gray-600 dark:text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="20" height="6" rx="1" />
      <rect x="2" y="11" width="20" height="6" rx="1" />
      <circle cx="6" cy="6" r="1" fill="currentColor" />
      <circle cx="6" cy="14" r="1" fill="currentColor" />
      <line x1="10" y1="6" x2="18" y2="6" strokeLinecap="round" />
      <line x1="10" y1="14" x2="18" y2="14" strokeLinecap="round" />
      <path d="M6 19v2M18 19v2M6 21h12" strokeLinecap="round" />
    </svg>
  ),
  
  /** GitHub icon */
  GitHub: () => (
    <svg className="w-16 h-16" viewBox="0 0 98 96" fill="none">
      <path fillRule="evenodd" clipRule="evenodd" d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z" className="fill-[#24292f] dark:fill-white"/>
    </svg>
  ),
  
  /** Figma icon */
  Figma: () => (
    <svg className="w-16 h-16" viewBox="0 0 38 57" fill="none">
      <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE"/>
      <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83"/>
      <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262"/>
      <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E"/>
      <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF"/>
    </svg>
  ),
};

// ============================================
// Common input/button styles for reuse
// ============================================

export const ConfigStyles = {
  input: "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 text-sm",
  inputDisabled: "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 text-sm",
  buttonPrimary: "px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
  buttonSecondary: "px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
  buttonDanger: "px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors disabled:opacity-50",
  buttonPurple: "px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-md transition-colors",
  code: "bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-xs",
};
