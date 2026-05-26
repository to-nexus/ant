import { useTranslation } from 'react-i18next';
import { Spinner } from '../../primitives';
import { Skeleton } from '../../primitives';

export type LoadingShape = 'inline' | 'spinner-center' | 'panel-skeleton' | 'region-skeleton' | 'page-skeleton';

export interface LoadingFallbackProps {
  shape: LoadingShape;
  longWait?: boolean;
  label?: string;
}

/**
 * Surface-neutral loading UI. Shape selection lives in presets.ts; this
 * component only translates a shape token into DOM.
 *
 * Design constraint: never collapse layout. Every shape keeps the
 * ready-state's footprint so transitions cause zero CLS.
 */
export function LoadingFallback({ shape, longWait, label }: LoadingFallbackProps) {
  const { t } = useTranslation('async');
  const message = label ?? (longWait ? t('loading.longWait') : t('loading.default'));

  switch (shape) {
    case 'inline':
      return <Spinner size="sm" tone="muted" label={message} />;

    case 'spinner-center':
      return (
        <div className="h-full w-full flex flex-col items-center justify-center gap-2 text-[color:var(--text-3)]">
          <Spinner size="lg" tone="muted" label={message} />
          {longWait && <div className="text-xs">{message}</div>}
        </div>
      );

    case 'panel-skeleton':
      return (
        <div className="h-full w-full p-6 space-y-3">
          <Skeleton variant="text" className="w-40" />
          <Skeleton variant="text" className="w-full" delayMs={80} />
          <Skeleton variant="text" className="w-5/6" delayMs={160} />
          <Skeleton variant="rect" className="w-full h-32 mt-4" delayMs={240} />
          {longWait && (
            <div className="pt-2 text-xs text-[color:var(--text-3)]">{message}</div>
          )}
        </div>
      );

    case 'region-skeleton':
      return (
        <div className="w-full p-3 space-y-2">
          <Skeleton variant="text" className="w-1/3" />
          <Skeleton variant="text" className="w-full" delayMs={80} />
          <Skeleton variant="text" className="w-2/3" delayMs={160} />
        </div>
      );

    case 'page-skeleton':
      return (
        <div className="h-full w-full flex items-center justify-center p-6">
          <div className="max-w-lg w-full space-y-3">
            <Skeleton variant="text" className="w-44" />
            <Skeleton variant="text" className="w-full" delayMs={80} />
            <Skeleton variant="text" className="w-5/6" delayMs={160} />
            <Skeleton variant="rect" className="w-full h-40 mt-4" delayMs={240} />
            {longWait && (
              <div className="pt-2 text-sm text-[color:var(--text-3)]">{message}</div>
            )}
          </div>
        </div>
      );
  }
}
